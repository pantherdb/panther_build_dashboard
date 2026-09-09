import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { initialBuildUiState } from '@/features/build/slices/buildSlice'
import type { FixtureStateKey } from '@/features/build/fixtures'
import { FrontierSummary } from '@/features/pipeline/components/FrontierSummary'
import { renderWithProviders } from '@tests/test-utils'

/**
 * Acceptance questions 1 and 2.
 *
 * Every assertion here is on VISIBLE TEXT rather than on a class or a data attribute, because the
 * failure this guards against is not a styling regression - it is the dashboard telling a reviewer
 * that the build stopped at the earliest incomplete phase. That mistake reads perfectly well in the
 * markup and only shows up in the words.
 */

const preloaded = (fixtureStateKey: FixtureStateKey) => ({
  build: { ...initialBuildUiState, fixtureStateKey },
})

describe('FrontierSummary on the captured report', () => {
  it('puts the frontier at Final packaging, not at the earliest incomplete phase', () => {
    // Library export products finished (12/12) since the fixture was captured, and Final
    // packaging - the last phase - now has its first completed step, so the frontier moved there.
    renderWithProviders(<FrontierSummary />, { preloadedState: preloaded('real') })

    const frontier = screen.getByText(/^The build frontier is Final packaging/)
    expect(frontier).toHaveTextContent('incomplete at 1 of 2 steps')

    // Final packaging is the last declared phase, so there is no later phase left to say "has
    // not started" about.
    expect(frontier.textContent).not.toContain('has not started')

    // Phase 2 is the earliest incomplete phase and must not be named as the frontier.
    expect(frontier.textContent).not.toContain('Sequence-to-family mapping')
  })

  it('states that a phase behind the frontier is incomplete, and calls it a hole', () => {
    renderWithProviders(<FrontierSummary />, { preloadedState: preloaded('real') })

    const holes = screen.getByText(/^1 phase behind the frontier is incomplete/)
    expect(holes).toHaveTextContent(/while 11 later phases carried on past it/)
    expect(holes).toHaveTextContent('This is a hole, not where the build stopped.')
  })

  it('names both remaining validation steps rather than counting them', () => {
    renderWithProviders(<FrontierSummary />, { preloadedState: preloaded('real') })

    const detail = screen.getByText(/^3 of 5 steps done\./)
    expect(detail).toHaveTextContent('Incomplete: validate_idmapping_step, validate_blast_step')
    expect(detail).toHaveTextContent('11 later phases carried on past it')
    expect(screen.getByRole('link', { name: 'Sequence-to-family mapping' })).toBeInTheDocument()
  })
})

describe('FrontierSummary across the derived states', () => {
  it('toEarly() moves the frontier back and leaves no holes', () => {
    renderWithProviders(<FrontierSummary />, { preloadedState: preloaded('early') })

    const frontier = screen.getByText(/^The build frontier is Sequence-to-family mapping/)
    expect(frontier).toHaveTextContent('incomplete at 1 of 5 steps')
    expect(frontier).toHaveTextContent('11 later phases have not started')

    expect(screen.getByText(/^Nothing behind the frontier is incomplete/)).toBeInTheDocument()
    expect(screen.queryByText(/is a hole, not where the build stopped/)).toBeNull()
  })

  it('toCompleted() leaves neither a frontier gap nor a hole', () => {
    renderWithProviders(<FrontierSummary />, { preloadedState: preloaded('completed') })

    const frontier = screen.getByText(/^All 14 phases are complete/)
    expect(frontier).toHaveTextContent('The frontier is the last phase, Final packaging')
    expect(screen.getByText(/^Nothing behind the frontier is incomplete/)).toBeInTheDocument()
  })

  it('toFailed() reports the failure and the phase it blocks, separately from the hole', () => {
    renderWithProviders(<FrontierSummary />, { preloadedState: preloaded('failed') })

    // toFailed() now retracts every phase after the failure, so the frontier lands back on the
    // failing phase (Library export products) instead of Final packaging, which is blocked again.
    expect(
      screen.getByText('node_closure_files.touch failed in Library export products after 3 attempts.')
    ).toBeInTheDocument()
    expect(
      screen.getByText('1 phase is blocked behind that failure: Final packaging.')
    ).toBeInTheDocument()

    // The hole is still reported, and it is a different finding with a different word.
    expect(screen.getByText(/^1 phase behind the frontier is incomplete/)).toBeInTheDocument()
    expect(screen.getByText('Blocked')).toBeInTheDocument()
    expect(screen.getByText('Hole')).toBeInTheDocument()
  })
})
