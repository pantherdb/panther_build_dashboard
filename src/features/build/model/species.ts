/**
 * The species cross-section: one record per oscode, joined across every source that mentions it.
 *
 * This is the join that makes the raw numbers interpretable. A species at 0 % node forward
 * tracking looks catastrophic alone; joined with a `prev_count` of 0 and a UniProt table saying
 * every one of its sequences has no previous match, 0 % is exactly what should happen.
 *
 * The rule that matters most: coverage differs between sources - 131 species in node tracking,
 * 50 of 147 in the count table, 20 of 132 in the UniProt table - so a species missing from a
 * truncated table is UNKNOWN, never zero. Reading absence as zero would manufacture roughly 97
 * phantom "new species" on this fixture.
 *
 * Rename detection requires an EXACT count match. A 10 % tolerance yields 7 pairs on this fixture
 * of which 5 are nonsense, so replacement is kept as a separate, lower-confidence category.
 */

import { isAggregateOscode } from './sections/otherReports'
import type { NoteSink } from './notes'
import { makeMeta } from './notes'
import type {
  Availability,
  DerivedTable,
  FieldOrigin,
  NodeTrackingSummary,
  SpeciesCountChange,
  SpeciesCrossSection,
  SpeciesField,
  SpeciesLink,
  SpeciesRecord,
  SpeciesTracking,
  UniprotMatchRow,
  UnplacedSpeciesRow,
} from './types'

/** A rename is only claimed on an exact count match; anything looser produces false pairs. */
export const RENAME_REQUIRES_EXACT_COUNT = true

/** Oscode prefix length used as a weak genus signal for replacement candidates. */
export const REPLACEMENT_PREFIX_LENGTH = 3

/** A replacement may differ in size; a rename may not. */
export const REPLACEMENT_COUNT_TOLERANCE = 0.25

function absentField<TValue>(origin: FieldOrigin): SpeciesField<TValue> {
  return { value: null, present: false, origin }
}

function presentField<TValue>(value: TValue, origin: FieldOrigin): SpeciesField<TValue> {
  return { value, present: true, origin: { ...origin, present: true } }
}

export interface SpeciesLinkResult {
  renames: SpeciesLink[]
  replacements: SpeciesLink[]
}

/**
 * Pairs removals with additions.
 *
 * Exact-count pairs are renames, and only when the count identifies exactly one removal and one
 * addition - an ambiguous count is left unpaired rather than guessed. Remaining pairs sharing an
 * oscode prefix and within tolerance are replacements, marked `likely`, greedily matched
 * closest-first so one addition cannot absorb several removals.
 */
export function detectSpeciesLinks(
  changes: readonly SpeciesCountChange[],
  sink?: NoteSink
): SpeciesLinkResult {
  const removals = changes.filter(
    change => change.isRemoval && change.previousCount !== null && change.previousCount > 0
  )
  const additions = changes.filter(
    change => change.isAddition && change.currentCount !== null && change.currentCount > 0
  )

  const renames: SpeciesLink[] = []
  const usedRemoved = new Set<string>()
  const usedAdded = new Set<string>()

  const removalsByCount = new Map<number, SpeciesCountChange[]>()
  for (const removal of removals) {
    const count = removal.previousCount as number
    removalsByCount.set(count, [...(removalsByCount.get(count) ?? []), removal])
  }
  const additionsByCount = new Map<number, SpeciesCountChange[]>()
  for (const addition of additions) {
    const count = addition.currentCount as number
    additionsByCount.set(count, [...(additionsByCount.get(count) ?? []), addition])
  }

  for (const [count, matchedRemovals] of [...removalsByCount].sort((a, b) => b[0] - a[0])) {
    const matchedAdditions = additionsByCount.get(count)
    if (matchedAdditions === undefined) continue
    if (matchedRemovals.length !== 1 || matchedAdditions.length !== 1) {
      sink?.add(
        'info',
        'join:species',
        `Count ${count} matches ${matchedRemovals.length} removals and ` +
          `${matchedAdditions.length} additions; the pairing is ambiguous and no rename is claimed.`
      )
      continue
    }
    const removed = matchedRemovals[0]
    const added = matchedAdditions[0]
    usedRemoved.add(removed.oscode)
    usedAdded.add(added.oscode)
    renames.push({
      kind: 'rename',
      removed: removed.oscode,
      added: added.oscode,
      removedCount: count,
      addedCount: count,
      countDelta: 0,
      confidence: 'exact',
      evidence: [
        `${removed.oscode} drops ${count.toLocaleString('en-US')} to 0 and ${added.oscode} ` +
          `appears with exactly ${count.toLocaleString('en-US')}.`,
        'Exact count match; no other species in the table shares this count.',
      ],
    })
  }

  /* Replacement candidates: same oscode prefix, sizes within tolerance, closest pair first. */
  interface Candidate {
    removed: SpeciesCountChange
    added: SpeciesCountChange
    relative: number
  }
  const candidates: Candidate[] = []
  for (const removed of removals) {
    if (usedRemoved.has(removed.oscode)) continue
    for (const added of additions) {
      if (usedAdded.has(added.oscode)) continue
      const previous = removed.previousCount as number
      const current = added.currentCount as number
      const prefixA = removed.oscode.slice(0, REPLACEMENT_PREFIX_LENGTH).toUpperCase()
      const prefixB = added.oscode.slice(0, REPLACEMENT_PREFIX_LENGTH).toUpperCase()
      if (prefixA !== prefixB) continue
      const relative = Math.abs(previous - current) / Math.max(previous, current)
      if (relative > REPLACEMENT_COUNT_TOLERANCE) continue
      candidates.push({ removed, added, relative })
    }
  }

  const replacements: SpeciesLink[] = []
  for (const candidate of candidates.sort((a, b) => a.relative - b.relative)) {
    if (usedRemoved.has(candidate.removed.oscode) || usedAdded.has(candidate.added.oscode)) continue
    usedRemoved.add(candidate.removed.oscode)
    usedAdded.add(candidate.added.oscode)
    const previous = candidate.removed.previousCount as number
    const current = candidate.added.currentCount as number
    replacements.push({
      kind: 'replacement',
      removed: candidate.removed.oscode,
      added: candidate.added.oscode,
      removedCount: previous,
      addedCount: current,
      countDelta: current - previous,
      confidence: 'likely',
      evidence: [
        `${candidate.removed.oscode} drops ${previous.toLocaleString('en-US')} to 0 while ` +
          `${candidate.added.oscode} appears with ${current.toLocaleString('en-US')} - ` +
          `${Math.round(candidate.relative * 100)} % apart.`,
        `Oscodes share the prefix ${candidate.removed.oscode
          .slice(0, REPLACEMENT_PREFIX_LENGTH)
          .toUpperCase()}, which suggests the same genus.`,
        'Counts do not match exactly, so this is a replacement rather than a rename.',
      ],
    })
  }

  return { renames, replacements }
}

export interface SpeciesJoinInput {
  nodeTracking: NodeTrackingSummary
  speciesCounts: DerivedTable<SpeciesCountChange>
  uniprotMatch: DerivedTable<UniprotMatchRow>
  /** `giga_usf`'s per-species table. Empty when that section is absent - every species then joins to `null`, not zero. */
  unplacedFragments: readonly UnplacedSpeciesRow[]
  /**
   * Availability of the `giga_usf` section itself. Its by-species table lists every species with
   * at least one unplaced sequence, across every surviving book, untruncated - so when this is
   * `'available'`, a species absent from `unplacedFragments` is a MEASURED zero, not an unknown.
   * Any other availability (absent, partial, error, unknown) means the section did not fully run,
   * so absence stays `null`.
   */
  unplacedFragmentsAvailability: Availability
  sink: NoteSink
}

export function buildSpeciesCrossSection(input: SpeciesJoinInput): SpeciesCrossSection {
  const {
    nodeTracking,
    speciesCounts,
    uniprotMatch,
    unplacedFragments,
    unplacedFragmentsAvailability,
    sink,
  } = input

  const trackingOrigin: FieldOrigin = {
    sectionId: nodeTracking.sectionId ?? 'node_tracking',
    tableName: 'by_species',
    present: false,
    truncated: false,
  }
  const countsOrigin: FieldOrigin = {
    sectionId: speciesCounts.sectionId ?? 'other_reports',
    tableName: speciesCounts.name,
    present: false,
    truncated: speciesCounts.truncation.truncated,
  }
  const uniprotOrigin: FieldOrigin = {
    sectionId: uniprotMatch.sectionId ?? 'other_reports',
    tableName: uniprotMatch.name,
    present: false,
    truncated: uniprotMatch.truncation.truncated,
  }

  const trackingByOscode = new Map<string, SpeciesTracking>()
  for (const entry of nodeTracking.bySpecies) trackingByOscode.set(entry.oscode, entry)

  const countsByOscode = new Map<string, SpeciesCountChange>()
  for (const entry of speciesCounts.rows) {
    if (isAggregateOscode(entry.oscode)) continue
    countsByOscode.set(entry.oscode, entry)
  }

  const unplacedByOscode = new Map<string, UnplacedSpeciesRow>()
  for (const entry of unplacedFragments) unplacedByOscode.set(entry.oscode, entry)

  const uniprotByOscode = new Map<string, UniprotMatchRow>()
  let aggregates = 0
  for (const entry of uniprotMatch.rows) {
    if (isAggregateOscode(entry.oscode)) {
      aggregates += 1
      continue
    }
    uniprotByOscode.set(entry.oscode, entry)
  }
  if (aggregates > 0) {
    sink.add(
      'info',
      'join:species',
      `The UniProt match table carries ${aggregates} aggregate row(s); they are excluded from the ` +
        'species join because they are totals, not species.'
    )
  }

  const { renames, replacements } = detectSpeciesLinks(speciesCounts.rows, sink)
  const renameByAdded = new Map(renames.map(link => [link.added, link]))
  const renameByRemoved = new Map(renames.map(link => [link.removed, link]))
  const replacementByAdded = new Map(replacements.map(link => [link.added, link]))
  const replacementByRemoved = new Map(replacements.map(link => [link.removed, link]))

  const oscodes = [
    ...new Set([...trackingByOscode.keys(), ...countsByOscode.keys(), ...uniprotByOscode.keys()]),
  ].sort()

  const records: SpeciesRecord[] = oscodes.map(oscode => {
    const tracking = trackingByOscode.get(oscode)
    const counts = countsByOscode.get(oscode)
    const uniprot = uniprotByOscode.get(oscode)
    const unplaced = unplacedByOscode.get(oscode)

    const evidence: string[] = []
    let newFromCounts = false
    let newFromUniprot = false

    if (counts !== undefined && counts.previousCount === 0 && (counts.currentCount ?? 0) > 0) {
      newFromCounts = true
      evidence.push(
        `Previous count is 0 and current count is ${(counts.currentCount ?? 0).toLocaleString(
          'en-US'
        )} in "${speciesCounts.name}".`
      )
    }
    if (uniprot !== undefined && uniprot.allUnmatched) {
      newFromUniprot = true
      evidence.push(
        `No previous UniProt match for any of its ${(uniprot.totalSequences ?? 0).toLocaleString(
          'en-US'
        )} sequences in "${uniprotMatch.name}".`
      )
    }

    const isNewInBuild = newFromCounts || newFromUniprot
    const newInBuildConfidence: SpeciesRecord['newInBuildConfidence'] =
      newFromCounts && newFromUniprot ? 'confirmed' : isNewInBuild ? 'reported' : 'unknown'

    const trackingPct = tracking?.pct ?? tracking?.recomputedPct ?? null
    if (isNewInBuild && trackingPct === 0) {
      evidence.push(
        'Node forward tracking is 0 % because a species new to this build has no previous nodes ' +
          'to map forward.'
      )
    }

    const missingFrom: string[] = []
    if (tracking === undefined) missingFrom.push('node_tracking.by_species')
    if (counts === undefined) {
      missingFrom.push(
        speciesCounts.truncation.truncated
          ? `${speciesCounts.name} (truncated, so absence means unknown)`
          : speciesCounts.name
      )
    }
    if (uniprot === undefined) {
      missingFrom.push(
        uniprotMatch.truncation.truncated
          ? `${uniprotMatch.name} (truncated, so absence means unknown)`
          : uniprotMatch.name
      )
    }

    const rename = renameByAdded.get(oscode) ?? renameByRemoved.get(oscode) ?? null
    const replacement = replacementByAdded.get(oscode) ?? replacementByRemoved.get(oscode) ?? null
    if (rename !== null && rename.added === oscode) {
      evidence.push(
        `An exact-count rename link to ${rename.removed} suggests the same organism under a new ` +
          'oscode rather than a genuinely new species.'
      )
    }

    return {
      oscode,
      nodeTracking:
        tracking === undefined
          ? absentField<SpeciesTracking>(trackingOrigin)
          : presentField(tracking, trackingOrigin),
      counts:
        counts === undefined
          ? absentField<SpeciesCountChange>(countsOrigin)
          : presentField(counts, countsOrigin),
      uniprot:
        uniprot === undefined
          ? absentField<UniprotMatchRow>(uniprotOrigin)
          : presentField(uniprot, uniprotOrigin),
      isNewInBuild,
      isRemoved: counts?.isRemoval === true,
      newInBuildConfidence,
      evidence,
      renameOf: rename !== null && rename.added === oscode ? rename.removed : null,
      renamedTo: rename !== null && rename.removed === oscode ? rename.added : null,
      replacementOf:
        replacement !== null && replacement.added === oscode ? replacement.removed : null,
      replacedBy: replacement !== null && replacement.removed === oscode ? replacement.added : null,
      links: [rename, replacement].filter((link): link is SpeciesLink => link !== null),
      missingFrom,
      unplacedFragments:
        unplaced !== undefined
          ? { unplaced: unplaced.unplaced, families: unplaced.families }
          : unplacedFragmentsAvailability === 'available'
            ? { unplaced: 0, families: 0 }
            : null,
    }
  })

  const byOscode: Record<string, SpeciesRecord> = {}
  for (const record of records) byOscode[record.oscode] = record

  const availability =
    nodeTracking.availability === 'available' &&
    speciesCounts.availability === 'available' &&
    uniprotMatch.availability === 'available'
      ? speciesCounts.truncation.truncated || uniprotMatch.truncation.truncated
        ? 'partial'
        : 'available'
      : records.length > 0
        ? 'partial'
        : 'absent'

  const notes: string[] = []
  if (speciesCounts.truncation.truncated || uniprotMatch.truncation.truncated) {
    notes.push(
      'Coverage differs between sources and two of them are truncated, so a species absent from ' +
        'one table is unknown there, not zero.'
    )
  }

  return {
    ...makeMeta({ availability, sectionId: null, notes }),
    records,
    byOscode,
    oscodeCount: records.length,
    coverage: {
      nodeTracking: trackingByOscode.size,
      counts: countsByOscode.size,
      uniprot: uniprotByOscode.size,
      countsTotalRows: speciesCounts.truncation.totalRows,
      uniprotTotalRows: uniprotMatch.truncation.totalRows,
    },
    newOscodes: records.filter(record => record.isNewInBuild).map(record => record.oscode),
    removedOscodes: records.filter(record => record.isRemoved).map(record => record.oscode),
    renames,
    replacements,
  }
}
