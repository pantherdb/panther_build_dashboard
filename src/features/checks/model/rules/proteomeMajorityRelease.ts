/**
 * Proteomes not on their source's majority release.
 *
 * The rule this replaces compared a single build-wide `QFO_RELEASE_VERSION` declaration against
 * `QFO_DATA_DIR`. Pipeline issue #65 retired that declaration - the release is now read per
 * proteome from `RP_taxonomy_organism_lib.txt` column 8, because QfO and Reference Proteome each
 * run their own release cycle and a hand-swapped species can come from a third - so there is no
 * longer a single declared release to compare against a single active path. See
 * `panther_build/.specs/2026-08-27-proteome-version-provenance-design.md` §8.
 *
 * The comparable fact the report carries now is the one the `proteomes` section computes for
 * exactly this reason: a proteome whose (source, release) is not the largest release for its
 * source is either a deliberate hand-swap or a stamping error, and only a human can tell which -
 * the same "explain, don't judge" shape as the old mismatch, on the data that replaced it.
 *
 * The majority per source, and the roster off it, are read from the roster rows (`tables[0]` on
 * the wire), never from the generator's own warning string - that string names only the first
 * eight strays and is corroboration, not the source of the finding. `evidenceTokens` lets a
 * generator warning that already names this source and its majority release stand this finding
 * down, the same dedup every other derived-vs-generator finding in this registry uses.
 *
 * A source with a single stamped proteome is its own majority by definition, so it can never be
 * off it - warning on it would fire on every build that sources one species from a second release.
 * A source whose releases tie has no majority at all, so nothing of its is off one either.
 */

import { count, sectionTarget } from '../context'
import { passing, unevaluated, warned } from '../finding'
import type { ProteomeRosterRow } from '@/features/build/model'
import type { CheckRule } from '../types'

const RULE_ID = 'consistency.proteome-majority-release'

/** Named in full in the evidence; capped in the sentence so 24-of-131 still reads as a sentence. */
const MAX_NAMED_IN_EXPLANATION = 8

interface Bucket {
  source: string
  release: string
  count: number
}

function stampedRows(rows: readonly ProteomeRosterRow[]): (ProteomeRosterRow & {
  source: string
  version: string
})[] {
  return rows.filter(
    (row): row is ProteomeRosterRow & { source: string; version: string } =>
      row.source !== null && row.version !== null
  )
}

function bucketsOf(rows: readonly { source: string; version: string }[]): Bucket[] {
  const byKey = new Map<string, Bucket>()
  for (const row of rows) {
    const key = `${row.source}\u0000${row.version}`
    const existing = byKey.get(key)
    if (existing === undefined) byKey.set(key, { source: row.source, release: row.version, count: 1 })
    else existing.count += 1
  }
  return [...byKey.values()]
}

/** The release with the most proteomes for each source. A tied source names no majority. */
function majorityBySource(buckets: readonly Bucket[]): {
  majority: Map<string, string>
  tiedSources: string[]
} {
  const bySource = new Map<string, Bucket[]>()
  for (const bucket of buckets) {
    bySource.set(bucket.source, [...(bySource.get(bucket.source) ?? []), bucket])
  }

  const majority = new Map<string, string>()
  const tiedSources: string[] = []
  for (const [source, sourceBuckets] of bySource) {
    const top = Math.max(...sourceBuckets.map(bucket => bucket.count))
    const leaders = sourceBuckets.filter(bucket => bucket.count === top)
    if (leaders.length === 1) majority.set(source, leaders[0].release)
    else tiedSources.push(source)
  }
  return { majority, tiedSources }
}

function identify(row: ProteomeRosterRow): string {
  return row.oscode ?? row.up ?? row.taxid ?? 'an unidentified proteome'
}

export const proteomeMajorityReleaseRule: CheckRule = {
  id: RULE_ID,
  label: 'Proteome release against its source majority',
  category: 'consistency',
  run: report => {
    const rows = stampedRows(report.proteomes.roster.rows)
    const truncated = report.proteomes.roster.truncation.truncated

    const seed = {
      id: RULE_ID,
      ruleId: RULE_ID,
      category: 'consistency' as const,
      label: 'Proteome release against its source majority',
      explanation: '',
      source: 'proteomes.roster[].source, proteomes.roster[].version',
      ...sectionTarget(report, 'proteomes'),
    }

    if (rows.length === 0 || truncated) {
      return [
        unevaluated({
          ...seed,
          label: 'Proteome release provenance not available',
          explanation: truncated
            ? 'The reference-proteome roster in this report is a truncated sample, so counting ' +
              'it would report the sample size as though it were the library, not which release ' +
              'is actually the majority for each source. Nothing is compared.'
            : 'This report carries no per-proteome source/release stamp (columns 7-8 of ' +
              'RP_taxonomy_organism_lib.txt), so no proteome can be compared against its ' +
              "source's majority release. A report from before issue #65, or a roster " +
              'create_taxonomy.pl wrote without the stamping step, genuinely lacks this - it is ' +
              'a gap in the record, not a clean bill of health.',
          reason: 'inputs-missing',
        }),
      ]
    }

    const buckets = bucketsOf(rows)
    const { majority, tiedSources } = majorityBySource(buckets)

    const compositionEvidence = [...buckets]
      .sort((a, b) => a.source.localeCompare(b.source) || b.count - a.count)
      .map(bucket => {
        const status =
          majority.get(bucket.source) === bucket.release
            ? ' (majority)'
            : majority.has(bucket.source)
              ? ' (off majority)'
              : ' (tied, no majority)'
        return `${bucket.source} ${bucket.release}: ${count(bucket.count)}${status}`
      })

    const tiedNote =
      tiedSources.length === 0
        ? ''
        : ` ${tiedSources.join(', ')} ${tiedSources.length === 1 ? 'has' : 'have'} no single ` +
          'largest release, so nothing from ' +
          `${tiedSources.length === 1 ? 'it' : 'them'} counts as off one either.`

    const offMajority = rows.filter(row => {
      const sourceMajority = majority.get(row.source)
      return sourceMajority !== undefined && sourceMajority !== row.version
    })

    if (offMajority.length === 0) {
      return [
        passing({
          ...seed,
          label: "Every proteome is on its source's majority release",
          explanation:
            `${count(rows.length)} proteomes carry a source and release, and every one of them ` +
            "is on the release most of its source's roster came from" +
            (majority.size > 0
              ? `: ${[...majority.entries()]
                  .map(([source, release]) => `${source} ${release}`)
                  .join(', ')}`
              : '') +
            `.${tiedNote}`,
          evidence: compositionEvidence,
        }),
      ]
    }

    const named = offMajority.slice(0, MAX_NAMED_IN_EXPLANATION)
    const remainder = offMajority.length - named.length
    const detail = named
      .map(row => `${identify(row)} (${row.source} ${row.version}, majority ${majority.get(row.source)})`)
      .join('; ')

    return [
      warned({
        ...seed,
        label:
          `${count(offMajority.length)} ` +
          `${offMajority.length === 1 ? 'proteome is' : 'proteomes are'} off their source's ` +
          'majority release',
        explanation:
          `${count(offMajority.length)} of ${count(rows.length)} stamped proteomes are not on ` +
          `the release most of their source's roster came from: ${detail}` +
          (remainder > 0 ? `, and ${count(remainder)} more` : '') +
          `.${tiedNote} Deliberate for a hand-swapped proteome; otherwise a stamping error - only ` +
          're-stamping or a human comparing the two tells you which.',
        evidence: [
          ...compositionEvidence,
          ...offMajority.map(
            row => `${identify(row)}: ${row.source} ${row.version} (majority ${majority.get(row.source)})`
          ),
        ],
        evidenceTokens: [...new Set(offMajority.map(row => `${row.source} ${row.version}`))],
      }),
    ]
  },
}
