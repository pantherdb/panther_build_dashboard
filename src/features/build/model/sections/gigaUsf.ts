/**
 * The `giga_usf` section: the sequences GIGA removed from each tree as unplaced fragments.
 *
 * Two report shapes exist and both are read here:
 *
 *  - THE OLD IN-REPORT SHAPE (no cap on how large a real build's report can be, until it was found
 *    to be one - kept for old live files and the `gigaUsf` fixture): a `Families with unplaced
 *    fragments` table is the navigation, and a `members` map is capped by the generator to keep the
 *    bundled report small. A family whose ids were left out keeps its count and gets
 *    `members: null` - "not in this report", which the view must not render as "none".
 *  - THE SIDECAR SHAPE (current contract): the family table and `unplaced_members` are gone from
 *    `data` entirely, replaced by a small `sidecar: {file, bytes, sha256}` reference. This
 *    extractor only reads that reference into `UnplacedFragmentsSummary.sidecar`; the per-family
 *    rows it points at are parsed by `./gigaUsfSidecar.ts`, loaded lazily by
 *    `useUnplacedFamilies` (`src/features/trees/hooks.ts`), never by `parseBuildState` itself -
 *    `parseBuildState` stays synchronous and pure, and the sidecar file may not even be on disk
 *    yet (see the workspace CLAUDE.md, "`msa` is registered ahead of its data" for the analogous
 *    situation, and the `giga_usf` row for this one).
 */

import {
  asArray,
  asBoolean,
  asInteger,
  asNonEmptyString,
  asNumber,
  asRecord,
  asStringArray,
} from '../primitives'
import { makeMeta } from '../notes'
import { availabilityFor } from '../status'
import type { NoteSink } from '../notes'
import type {
  UnplacedFamilyRow,
  UnplacedFragmentsSidecarRef,
  UnplacedFragmentsSummary,
  UnplacedSpeciesRow,
} from '../types'
import { sectionBaseNotes } from './input'
import type { SectionInput } from './input'

export const FAMILY_TABLE = 'Families with unplaced fragments'
export const SPECIES_TABLE = 'Unplaced fragments by species'
/**
 * The current contract's by-proteome table. Replaces `SPECIES_TABLE` on a report that carries it;
 * `SPECIES_TABLE` stays readable as the fallback for an older report that does not.
 */
export const PROTEOME_TABLE = 'Unplaced fragments by proteome'

function findTable(tables: unknown, name: string): Record<string, unknown> | null {
  return (
    asArray(tables)
      .map(entry => asRecord(entry))
      .find(record => asNonEmptyString(record?.name) === name) ?? null
  )
}

function rowsOf(table: Record<string, unknown> | null): Record<string, unknown>[] {
  return asArray(table?.rows)
    .map(entry => asRecord(entry))
    .filter((record): record is Record<string, unknown> => record !== null)
}

function tableRows(tables: unknown, name: string): Record<string, unknown>[] {
  return rowsOf(findTable(tables, name))
}

/**
 * The fields common to every unplaced-family row, whichever shape it came from. `null` when the
 * row has no usable family id or count - the one thing both shapes require to mean anything.
 * Exported so `./gigaUsfSidecar.ts` parses sidecar rows with the exact same rules, rather than a
 * second, driftable copy of them.
 */
export function parseUnplacedFamilyBase(
  record: Record<string, unknown>
): Omit<UnplacedFamilyRow, 'members'> | null {
  const family = asNonEmptyString(record.family)
  const unplaced = asInteger(record.unplaced)
  if (family === null || unplaced === null) return null
  return {
    family,
    unplaced,
    treeLeaves: asInteger(record.tree_leaves),
    unplacedFraction: asNumber(record.unplaced_fraction),
    inputSeqs: asInteger(record.input_seqs),
  }
}

/**
 * The main report's `data.sidecar` reference. `null` for a payload with no such key (the old
 * in-report shape) and for one with a key that has no usable `file` name - a reference with no
 * file is not a reference to anything.
 */
function asSidecarRef(raw: unknown): UnplacedFragmentsSidecarRef | null {
  const record = asRecord(raw)
  if (record === null) return null
  const file = asNonEmptyString(record.file)
  if (file === null) return null
  return {
    file,
    bytes: asInteger(record.bytes),
    sha256: asNonEmptyString(record.sha256),
  }
}

export function extractUnplacedFragments(
  section: SectionInput,
  sink: NoteSink
): UnplacedFragmentsSummary {
  const scope = `section:${section.sectionId}`
  const data = section.dataRecord
  const notes = sectionBaseNotes(section, sink, 'unplaced fragments')
  const meta = makeMeta({
    availability: availabilityFor(section.status, data !== null),
    sectionId: section.sectionId,
    message: section.message,
    status: section.status,
    notes,
  })
  const headline = asRecord(data?.headline)
  const members = asRecord(data?.unplaced_members) ?? {}

  const families: UnplacedFamilyRow[] = []
  for (const record of tableRows(data?.tables, FAMILY_TABLE)) {
    const base = parseUnplacedFamilyBase(record)
    if (base === null) {
      sink.add('warning', scope, 'A family row has no family id or count; skipped.')
      continue
    }
    families.push({
      ...base,
      members: Object.hasOwn(members, base.family) ? asStringArray(members[base.family]) : null,
    })
  }

  // The current contract's by-proteome table wins when the report carries it; an older report
  // falls back to the three-column species table, with every new field left `null` - there is
  // nothing there to read them from.
  const proteomeTable = findTable(data?.tables, PROTEOME_TABLE)
  const bySpecies: UnplacedSpeciesRow[] =
    proteomeTable !== null
      ? rowsOf(proteomeTable).flatMap(record => {
          const oscode = asNonEmptyString(record.oscode)
          const unplaced = asInteger(record.unplaced)
          return oscode === null || unplaced === null
            ? []
            : [
                {
                  oscode,
                  unplaced,
                  families: asInteger(record.families) ?? 0,
                  proteomeSeqs: asInteger(record.proteome_seqs),
                  gigaInputSeqs: asInteger(record.giga_input_seqs),
                  unplacedPctOfProteome: asNumber(record.unplaced_pct_of_proteome),
                  unplacedPctOfGigaInput: asNumber(record.unplaced_pct_of_giga_input),
                },
              ]
        })
      : tableRows(data?.tables, SPECIES_TABLE).flatMap(record => {
          const oscode = asNonEmptyString(record.oscode)
          const unplaced = asInteger(record.unplaced)
          return oscode === null || unplaced === null
            ? []
            : [
                {
                  oscode,
                  unplaced,
                  families: asInteger(record.families) ?? 0,
                  proteomeSeqs: null,
                  gigaInputSeqs: null,
                  unplacedPctOfProteome: null,
                  unplacedPctOfGigaInput: null,
                },
              ]
        })

  return {
    ...meta,
    booksScanned: asInteger(headline?.books_scanned),
    familiesWithUnplaced: asInteger(headline?.families_with_unplaced),
    unplacedTotal: asInteger(headline?.unplaced_total),
    unassignedInMapping: asInteger(headline?.unassigned_in_mapping),
    inputMismatchFamilies: asInteger(headline?.input_mismatch_families),
    membersTruncated: asBoolean(headline?.members_truncated) ?? false,
    families,
    bySpecies,
    sidecar: asSidecarRef(data?.sidecar),
    warnings: asStringArray(data?.warnings),
  }
}
