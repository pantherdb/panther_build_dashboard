import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { initialBuildUiState } from '@/features/build/slices/buildSlice'
import type { FixtureStateKey } from '@/features/build/fixtures'
import { PipelineSpine } from '@/features/pipeline/components/PipelineSpine'
import { UnattachedReports } from '@/features/pipeline/components/UnattachedReports'
import { renderWithProviders } from '@tests/test-utils'

const preloaded = (fixtureStateKey: FixtureStateKey) => ({
  build: { ...initialBuildUiState, fixtureStateKey },
})

/**
 * The spine has to make the frontier, the holes and the blocked phases distinguishable by WORD,
 * because colour and texture are the redundant cues, not the primary ones. So every assertion asks
 * a node what it says about itself.
 */
describe('PipelineSpine', () => {
  it('lists the declared phases and ends with the unattached node', () => {
    renderWithProviders(<PipelineSpine />, { preloadedState: preloaded('real') })

    const nav = screen.getByRole('navigation', { name: 'Build pipeline phases' })
    expect(nav).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Setup & resource download/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Final packaging/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Unattached reports/ })).toBeInTheDocument()
  })

  it('marks Final packaging as the frontier and Sequence-to-family mapping as a hole', () => {
    // Library export products finished (12/12) since the fixture was captured; the frontier is
    // now Final packaging, the last phase, at its first completed step.
    renderWithProviders(<PipelineSpine />, { preloadedState: preloaded('real') })

    const frontier = screen.getByRole('button', { name: /Final packaging/ })
    expect(frontier).toHaveTextContent('Frontier')
    expect(frontier).toHaveTextContent('1/2')
    expect(frontier).not.toHaveTextContent('Hole')

    const hole = screen.getByRole('button', { name: /Sequence-to-family mapping/ })
    expect(hole).toHaveTextContent('Hole')
    expect(hole).toHaveTextContent('3/5')
    expect(hole).not.toHaveTextContent('Frontier')
  })

  it('does not mark the earliest incomplete phase as active or as the frontier', () => {
    renderWithProviders(<PipelineSpine />, { preloadedState: preloaded('real') })

    const hole = screen.getByRole('button', { name: /Sequence-to-family mapping/ })
    expect(hole).not.toHaveTextContent('Active')

    // Exactly one node in the spine claims the frontier. (The state legend below the list carries
    // the word too, which is why the count is scoped to the phase list.)
    const nav = screen.getByRole('navigation', { name: 'Build pipeline phases' })
    expect(within(nav).getAllByText('Frontier')).toHaveLength(1)
  })

  it('reveals the hole’s incomplete step goals on demand', async () => {
    const { user } = renderWithProviders(<PipelineSpine />, {
      preloadedState: preloaded('real'),
    })

    expect(screen.queryByText('validate_blast_step')).toBeNull()

    // Three phases have two incomplete steps each, so the toggle is scoped to the hole's node.
    const holeNode = document.querySelector('[data-phase-index="2"]') as HTMLElement
    await user.click(within(holeNode).getByRole('button', { name: '2 incomplete steps' }))

    expect(within(holeNode).getByText('validate_idmapping_step')).toBeInTheDocument()
    expect(within(holeNode).getByText('validate_blast_step')).toBeInTheDocument()
  })

  it('toFailed() produces a Blocked phase that is worded differently from the hole', () => {
    renderWithProviders(<PipelineSpine />, { preloadedState: preloaded('failed') })

    const blocked = screen.getByRole('button', { name: /Final packaging/ })
    expect(blocked).toHaveTextContent('Blocked')
    expect(blocked).not.toHaveTextContent('Hole')

    const hole = screen.getByRole('button', { name: /Sequence-to-family mapping/ })
    expect(hole).toHaveTextContent('Hole')
    expect(hole).not.toHaveTextContent('Blocked')
  })

  it('toEarly() moves the frontier to Sequence-to-family mapping and leaves no hole', () => {
    renderWithProviders(<PipelineSpine />, { preloadedState: preloaded('early') })

    expect(screen.getByRole('button', { name: /Sequence-to-family mapping/ })).toHaveTextContent(
      'Frontier'
    )
    expect(screen.queryByText('Hole')).toBeNull()
  })

  it('toCompleted() leaves no frontier gap, no hole and no pending phase', () => {
    renderWithProviders(<PipelineSpine />, { preloadedState: preloaded('completed') })

    expect(screen.queryByText('Hole')).toBeNull()
    expect(screen.queryByText('Pending')).toBeNull()
    expect(screen.getAllByText('Complete').length).toBeGreaterThan(1)
  })

  it('reports how many sections are bound to no phase', () => {
    renderWithProviders(<PipelineSpine />, { preloadedState: preloaded('unknownSection') })

    expect(
      screen.getByText(/1 section bound to no phase — surfaced here, not hidden\./)
    ).toBeInTheDocument()
  })

  it('says so explicitly when every section is bound', () => {
    renderWithProviders(<PipelineSpine />, { preloadedState: preloaded('real') })

    expect(
      screen.getByText('Every section in this report is bound to a phase.')
    ).toBeInTheDocument()
  })
})

describe('UnattachedReports', () => {
  it('withUnknownSection() collects the unknown section here rather than dropping it', async () => {
    renderWithProviders(<UnattachedReports />, {
      preloadedState: preloaded('unknownSection'),
    })

    // Named in the list of unattached sections, and again as the mounted report's own subtitle.
    expect(screen.getAllByText('pfam_coverage')).toHaveLength(2)
    expect(screen.getByText('no specialised renderer registered')).toBeInTheDocument()
    // And it is actually rendered, through the generic fallback: this is the section's own text,
    // which no code in the application names.
    expect(
      await screen.findByText('Pfam 36.0 domains matched against library sequences.')
    ).toBeInTheDocument()
  })

  it('does not put a hinted section here: the phase hint binds it to a phase', () => {
    renderWithProviders(<UnattachedReports />, {
      preloadedState: preloaded('unknownSection'),
    })

    expect(screen.queryByText('tree_quality')).toBeNull()
  })

  it('states that nothing was left out when every section is bound', () => {
    renderWithProviders(<UnattachedReports />, { preloadedState: preloaded('real') })

    expect(screen.getByText('Every section is bound to a phase')).toBeInTheDocument()
  })
})
