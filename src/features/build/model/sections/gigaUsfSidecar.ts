/**
 * Parsing the `giga_usf` sidecar file - `docs/build_state.giga_usf.json`.
 *
 * The main report keeps only a small `{file, bytes, sha256}` reference (`extractUnplacedFragments`
 * in `./gigaUsf.ts`); this is what turns the fetched file into the same `UnplacedFamilyRow[]` shape
 * the old in-report path produced. It is untrusted `unknown` input exactly like the main report -
 * fetched lazily in production, so it can be anything - and it is trusted only when its own
 * envelope names the SAME report the caller already parsed: same `section_id`, `target` and
 * `generated_at`. A well-formed sidecar for a different report is not this report's data, no
 * matter how well-formed, and is treated as `mismatched`; a payload that is not even readable as
 * that envelope is `parse-error`. Both leave `families` empty rather than guessing.
 *
 * `useUnplacedFamilies` (`src/features/trees/hooks.ts`) is the only caller. `parseBuildState`
 * itself never touches this - it stays synchronous, and the sidecar may not even be on disk.
 */

import { asArray, asNonEmptyString, asRecord, asStringArray } from '../primitives'
import { parseUnplacedFamilyBase } from './gigaUsf'
import type { BuildReport, UnplacedFamilyRow } from '../types'

export type UsfSidecarStatus = 'ready' | 'mismatched' | 'parse-error'

export interface UsfSidecarResult {
  status: UsfSidecarStatus
  families: UnplacedFamilyRow[]
}

const PARSE_ERROR: UsfSidecarResult = { status: 'parse-error', families: [] }
const MISMATCHED: UsfSidecarResult = { status: 'mismatched', families: [] }

/** The identity fields of the report the caller already has, read the same defensive way. */
function reportEnvelope(report: BuildReport): {
  target: string | null
  generatedAt: string | null
} {
  const raw = asRecord(report.raw)
  return {
    target: asNonEmptyString(raw?.target),
    generatedAt: asNonEmptyString(raw?.generated_at),
  }
}

/**
 * @param raw - the fetched sidecar file's parsed JSON, `unknown` until proven otherwise.
 * @param report - the main report already on screen, whose identity the sidecar must match.
 */
export function parseUsfSidecar(raw: unknown, report: BuildReport): UsfSidecarResult {
  const record = asRecord(raw)
  if (record === null) return PARSE_ERROR

  const sectionId = asNonEmptyString(record.section_id)
  const target = asNonEmptyString(record.target)
  const generatedAt = asNonEmptyString(record.generated_at)
  if (sectionId === null || target === null || generatedAt === null) return PARSE_ERROR

  const expected = reportEnvelope(report)
  const identityMatches =
    sectionId === 'giga_usf' && target === expected.target && generatedAt === expected.generatedAt
  if (!identityMatches) return MISMATCHED

  const data = asRecord(record.data)
  if (data === null) return PARSE_ERROR

  const families: UnplacedFamilyRow[] = []
  for (const entry of asArray(data.families)) {
    const entryRecord = asRecord(entry)
    if (entryRecord === null) continue
    const base = parseUnplacedFamilyBase(entryRecord)
    if (base === null) continue
    families.push({ ...base, members: asStringArray(entryRecord.members) })
  }
  return { status: 'ready', families }
}
