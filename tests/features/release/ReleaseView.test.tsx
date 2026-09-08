import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FIXTURE_STATE_KEYS } from '@/features/build/fixtures'
import type { FixtureStateKey } from '@/features/build/fixtures'
import { RELEASE_ROUTE } from '@/features/build/model'
import { initialBuildUiState } from '@/features/build/slices/buildSlice'
import ReleaseView from '@/features/release/components/ReleaseView'
import { renderWithProviders } from '@tests/test-utils'

/**
 * The release view is a lens for a reader who does not run the pipeline, so most of what is
 * asserted here is about what must NOT appear, and about the honesty rules surviving the
 * translation. A friendlier page that is also vaguer would be a downgrade; one that is quietly
 * less honest would be a defect.
 */

const preloaded = (fixtureStateKey: FixtureStateKey) => ({
  build: { ...initialBuildUiState, fixtureStateKey },
})

const render = (key: FixtureStateKey = 'real') =>
  renderWithProviders(<ReleaseView />, { route: RELEASE_ROUTE, preloadedState: preloaded(key) })

describe('ReleaseView translation', () => {
  it('states readiness in plain language, without the record vocabulary', () => {
    render()

    expect(screen.getByText('This library is still being built.')).toBeInTheDocument()
    expect(screen.getByText(/6 steps remain, all in packaging and export/)).toBeInTheDocument()
  })

  it('translates a skipped validation step rather than dropping it', () => {
    render()

    // The record calls this a hole behind the frontier. A skipped validation step has release
    // consequences - the figures were produced without it - so it is reworded, never omitted.
    expect(screen.getByText('Not fully validated')).toBeInTheDocument()
    expect(
      screen.getByText(/2 validation checks earlier in the build never ran/)
    ).toBeInTheDocument()
  })

  it('names the reference proteomes the build actually read, and flags the declared release', () => {
    render()

    // The captured report declares QfO 2026_02 and reads ref_prot_2026_01. Showing the declared
    // value here would tell a reader the library was built from proteomes it never saw.
    expect(screen.getByText(/ref_prot_2026_01/)).toBeInTheDocument()
    expect(screen.getByText('declared 2026_02')).toBeInTheDocument()
  })

  it('distinguishes a rename from a replacement', () => {
    render()

    expect(screen.getByText('USTMA → MYCMD')).toBeInTheDocument()
    expect(screen.getByText('CRYNJ → CRYD1')).toBeInTheDocument()
    expect(screen.getByText('DAPPU → DAPMA')).toBeInTheDocument()

    // Two exact-count reclassifications, and one genus-level substitution. Conflating them would
    // misreport the release.
    expect(screen.getAllByText('Renamed')).toHaveLength(2)
    expect(screen.getAllByText('Replaced')).toHaveLength(1)
  })

  it('keeps the exact renames out of the gain and loss rankings', () => {
    render()

    // USTMA and MYCMD are the same genome, so either appearing in a ranking would read as
    // change. Each ranking row renders its oscode as its own element, while a rename renders as
    // the single string `USTMA → MYCMD` - so a standalone match means a ranking row, and there
    // should be none.
    for (const oscode of ['USTMA', 'MYCMD', 'CRYNJ', 'CRYD1']) {
      expect(screen.queryAllByText(oscode), `${oscode} appears in a ranking`).toHaveLength(0)
    }

    // DAPPU and DAPMA are a replacement, not a rename, so they DO belong in the rankings - one
    // as a loss and one as a gain.
    expect(screen.queryAllByText('DAPPU').length).toBeGreaterThan(0)
    expect(screen.queryAllByText('DAPMA').length).toBeGreaterThan(0)
  })

  it('still declares that the rankings come from a partial table', () => {
    render()

    // The audience most likely to quote "the largest decrease in the release" is this one.
    expect(screen.getAllByText(/50 of 147 species included in report/).length).toBeGreaterThan(0)
  })

  it('labels the previous-library comparison as assembled rather than complete', () => {
    render()

    expect(
      screen.getByText(/assembled from the figures this report happens to carry/)
    ).toBeInTheDocument()
  })

  it('reads a finished build as finished', () => {
    render('completed')

    expect(screen.getByText('This library finished building.')).toBeInTheDocument()
    expect(screen.queryByText(/steps remain/)).toBeNull()
  })
})

describe.each(FIXTURE_STATE_KEYS)('ReleaseView on %s', (key: FixtureStateKey) => {
  it('leaks no build-record vocabulary and no non-values', async () => {
    render(key)
    await screen.findByLabelText('Release header')

    const text = document.body.textContent ?? ''

    // Terms belonging to the build record. `vocabulary.ts` exists so none of these can reach a
    // reader who does not run the pipeline.
    for (const term of [
      'frontier',
      'Frontier',
      'mtime',
      'schema',
      'post_giga',
      'pass1_',
      'refProteomePANTHER',
      'config.mk',
      '.touch',
    ]) {
      expect(text, `${key} leaked "${term}"`).not.toContain(term)
    }

    for (const token of ['NaN', 'Infinity', '[object Object]']) {
      expect(text, `${key} leaked ${token}`).not.toContain(token)
    }
  })
})

/**
 * What the library was built from, for a reader who will cite it in a release note.
 *
 * This audience is the one most likely to write "built from QfO 2026_02" somewhere permanent. The
 * header used to offer a single path to copy, which invites exactly that sentence; the roster says
 * three releases were used at once. The composition is the honest version of the same line, and it
 * belongs here even though the 131-row roster does not.
 */
describe('the release header names every proteome release', () => {
  it('lists each source and release rather than a single one', () => {
    render()

    expect(screen.getByText(/QfO 2026_02 \(67\)/)).toBeInTheDocument()
    expect(screen.getByText(/RefProt 2026_02 \(40\)/)).toBeInTheDocument()
    expect(screen.getByText(/RefProt 2026_01 \(24\)/)).toBeInTheDocument()
  })

  it('keeps the pipeline vocabulary out of the line', () => {
    render()

    expect(screen.queryByText(/majority/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/roster/i)).not.toBeInTheDocument()
  })
})
