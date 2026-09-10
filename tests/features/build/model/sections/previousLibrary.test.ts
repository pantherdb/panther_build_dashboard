import { describe, expect, it } from 'vitest'
import {
  createNoteSink,
  extractPreviousLibrary,
  parseBuildState,
  toSectionInput,
} from '@/features/build/model'
import type { RawSection } from '@/features/build/model'
import { getFixtureState } from '@/features/build/fixtures'
import {
  PREVIOUS_LIBRARY_TOTALS,
  previousLibraryPayload,
  withPreviousLibrary,
} from '@tests/support/previousLibrarySection'

/**
 * `prev_lib`, read the way the generator actually writes it.
 *
 * The collector (panther_build `scripts/build_state_collectors/prev_lib.py`) puts the four
 * previous-library totals in the `prev` column of `data.rows`, alongside `rebuilt` and `new`.
 * Its `data.headline` carries the *deltas* instead - `delta_genomes`, `delta_sequences`, ... -
 * as preformatted strings like `"+177"`. There is no `headline.genomes`, and there never has
 * been: both revisions of that collector build the headline as `delta_<metric>`.
 *
 * No fixture exercises a *present* `prev_lib`, which is why the mismatch went unseen. The section
 * needs `reports/prev_lib_baseline.json`, and that file is built by a Makefile rule nothing
 * depends on, so every report produced so far reports the section `absent` and the transforms only
 * ever strip it. These tests supply the shape the generator emits, so a build that does carry a
 * baseline lands with its numbers wired into the comparison instead of silently blank.
 *
 * The generator's own suite pins the same row layout from the other side (panther_build
 * `tests/test_build_state.py`, which asserts on `rows["families"]["prev"]`).
 */

function sectionOf(data: unknown, overrides: Record<string, unknown> = {}) {
  return toSectionInput(
    {
      id: 'prev_lib',
      title: 'Comparison to previous library',
      status: 'ok',
      data,
      ...overrides,
    } as RawSection,
    9
  )
}

describe('extractPreviousLibrary', () => {
  it('reads the four totals from the prev column of the generated rows', () => {
    const summary = extractPreviousLibrary(sectionOf(previousLibraryPayload()), createNoteSink())

    expect(summary.availability).toBe('available')
    expect({
      genomes: summary.genomes,
      sequences: summary.sequences,
      families: summary.families,
      subfamilies: summary.subfamilies,
    }).toEqual(PREVIOUS_LIBRARY_TOTALS)
  })

  it('leaves a total null when the generator could not compute it', () => {
    // `subfamilies` is null on a build whose config.mk does not set PREV_SF_NAMES: the baseline
    // reports null rather than a fabricated 0, and so must the model.
    const summary = extractPreviousLibrary(
      sectionOf(previousLibraryPayload({ subfamilies: { prev: null } })),
      createNoteSink()
    )

    expect(summary.subfamilies).toBeNull()
    expect(summary.families).toBe(PREVIOUS_LIBRARY_TOTALS.families)
  })

  it('takes the rows over anything the headline claims', () => {
    const payload = previousLibraryPayload()
    payload.headline = { ...(payload.headline as Record<string, unknown>), genomes: 999 }

    const summary = extractPreviousLibrary(sectionOf(payload), createNoteSink())

    expect(summary.genomes).toBe(PREVIOUS_LIBRARY_TOTALS.genomes)
  })

  it('reports no totals when the section carries no rows', () => {
    const summary = extractPreviousLibrary(
      sectionOf({ text: 'Previous version: **PANTHER19.0**.' }),
      createNoteSink()
    )

    expect(summary.genomes).toBeNull()
    expect(summary.sequences).toBeNull()
  })
})

describe('the assembled comparison, once a baseline exists', () => {
  it('fills the previous side of every direct metric', () => {
    const { comparison } = parseBuildState(withPreviousLibrary(getFixtureState('real')))
    const by = Object.fromEntries(comparison.metrics.map(entry => [entry.metricId, entry]))

    expect(comparison.previousLibrary.availability).toBe('available')
    expect(by.families).toMatchObject({
      previous: PREVIOUS_LIBRARY_TOTALS.families,
      current: 15795,
      delta: 15795 - PREVIOUS_LIBRARY_TOTALS.families,
      previousSource: 'prev_lib.families',
    })
    expect(by.genomes).toMatchObject({ previous: PREVIOUS_LIBRARY_TOTALS.genomes, current: 131 })
    expect(by.subfamilies).toMatchObject({
      previous: PREVIOUS_LIBRARY_TOTALS.subfamilies,
      current: 117592,
    })
    expect(by.librarySequences).toMatchObject({
      previous: PREVIOUS_LIBRARY_TOTALS.sequences,
      current: 1742145,
    })
  })
})
