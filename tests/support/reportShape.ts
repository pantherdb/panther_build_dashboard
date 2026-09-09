/**
 * The "is this a usable report at all" shape check, shared by the two suites that need it.
 *
 * `parse.totality.test.ts` applies it to deliberately malformed inputs; `liveReport.contract.test.ts`
 * applies it to the live `docs/build_state.json`. Both are asking the same question - did the parser
 * produce something every view can render without null-checking a summary - so the answer lives in
 * one place rather than being restated and drifting.
 */

import { expect } from 'vitest'
import type { BuildReport } from '@/features/build/model'

/** Every sub-summary `parseBuildState` promises to return, present or absent. */
export const SUMMARY_KEYS = [
  'schema',
  'identity',
  'health',
  'freshness',
  'timing',
  'pipeline',
  'mapping',
  'nodeTracking',
  'library',
  'trees',
  'config',
  'comparison',
  'species',
  'otherReports',
  'consistency',
] as const

export function expectWellFormed(report: BuildReport): void {
  for (const key of SUMMARY_KEYS) {
    // Absence is a value: every sub-summary is an object, so no view null-checks one.
    expect(report[key], `report.${key}`).toBeTypeOf('object')
    expect(report[key], `report.${key}`).not.toBeNull()
  }
  expect(Array.isArray(report.ingestNotes)).toBe(true)
  expect(Array.isArray(report.reports)).toBe(true)
  expect(Array.isArray(report.generatorWarnings)).toBe(true)
}
