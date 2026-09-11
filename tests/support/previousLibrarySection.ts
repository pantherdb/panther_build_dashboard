/**
 * A `prev_lib` section in the shape the generator writes it, for the suites that need one present.
 *
 * No fixture carries a populated `prev_lib`: the section needs `reports/prev_lib_baseline.json`,
 * which is built by a Makefile rule nothing depends on, so the frozen reference reports it
 * `absent`. Two suites need the other case - the extractor's own tests, and the comparison's, which
 * cannot reach its second `partial` branch until the direct totals are present - so the payload
 * lives here rather than being restated in both and drifting.
 *
 * Totals live on `rows[].prev`; `headline` carries the *deltas* as preformatted strings. That is
 * the generator's layout, not a convenience shape - see `extractPreviousLibrary`.
 */

import { cloneJson } from '@/features/build/model'
import type { BuildState, RawSection } from '@/features/build/model'

export const PREVIOUS_LIBRARY_TOTALS = {
  genomes: 144,
  sequences: 2017964,
  families: 15683,
  subfamilies: 128012,
} as const

const CURRENT_TOTALS = {
  genomes: 131,
  sequences: 1742145,
  families: 15795,
  subfamilies: 117592,
} as const

type Metric = keyof typeof PREVIOUS_LIBRARY_TOTALS

/** `+n` / `-n`, the way the collector's `_delta` formats it. */
function delta(metric: Metric): string {
  const value = CURRENT_TOTALS[metric] - PREVIOUS_LIBRARY_TOTALS[metric]
  return value > 0 ? `+${value}` : String(value)
}

export function previousLibraryPayload(
  overrides: Partial<Record<Metric, Record<string, unknown>>> = {}
): Record<string, unknown> {
  const rows = (Object.keys(PREVIOUS_LIBRARY_TOTALS) as Metric[]).map(metric => ({
    metric,
    prev: PREVIOUS_LIBRARY_TOTALS[metric],
    rebuilt: null,
    new: CURRENT_TOTALS[metric],
    delta: delta(metric),
    ...(overrides[metric] ?? {}),
  }))

  return {
    text: 'Previous version: **PANTHER19.0**.',
    rows,
    headline: Object.fromEntries(rows.map(row => [`delta_${row.metric}`, row.delta])),
  }
}

/** The given state with its `prev_lib` section reported `ok` and fully populated. */
export function withPreviousLibrary(state: BuildState): BuildState {
  const next = cloneJson(state)
  const sections = next.sections as RawSection[]
  const index = sections.findIndex(section => section.id === 'prev_lib')
  sections[index] = {
    id: 'prev_lib',
    title: 'Comparison to previous library',
    status: 'ok',
    data: previousLibraryPayload(),
  } as RawSection
  return next
}
