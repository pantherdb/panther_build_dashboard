import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MetricDefinitionsProvider } from '@/@panther.core/components'
import { metricRegistry } from '@/app/metricRegistry'
import type { FixtureStateKey } from '@/features/build/fixtures'
import { initialBuildUiState } from '@/features/build/slices/buildSlice'
import NodeTrackingReport from '@/features/nodes/components/NodeTrackingReport'
import { renderWithProviders } from '@tests/test-utils'

const renderReport = (fixtureStateKey: FixtureStateKey = 'real') =>
  renderWithProviders(
    <MetricDefinitionsProvider registry={metricRegistry}>
      <NodeTrackingReport />
    </MetricDefinitionsProvider>,
    { preloadedState: { build: { ...initialBuildUiState, fixtureStateKey } } }
  )

const markCount = () => document.querySelectorAll('[data-pb-swarm] circle').length

/**
 * The section as a reviewer meets it. The load-bearing assertions are that the distribution is the
 * default reading rather than the table, that the two legitimate percentages in this section are
 * distinguished in words, and that the low tail is not uniformly excused.
 */
describe('NodeTrackingReport', () => {
  it('leads with the distribution, not with the 131-row table', () => {
    renderReport()

    expect(markCount()).toBe(131)

    // The table is present for print but collapsed: its panel carries the hidden class.
    const toggle = screen.getByRole('button', { name: /Full species table/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    const panelId = toggle.getAttribute('aria-controls') as string
    expect(document.getElementById(panelId)).toHaveClass('hidden')
    // Generous: this mounts 131 marks, two charts and a 131-row table into jsdom.
  }, 20000)

  it('shows the overall rate with a label that is not just “Sequences” or “Nodes”', () => {
    renderReport()

    // Appendix A.6: 92.7 % of 3,031,716 nodes; 2,810,967 mapped; 131 species reported.
    expect(screen.getByText('Node forward-tracking rate')).toBeInTheDocument()
    expect(screen.getByText('92.7')).toBeInTheDocument()
    expect(screen.getByText('3,031,716')).toBeInTheDocument()
    expect(screen.getByText('2,810,967')).toBeInTheDocument()
    expect(screen.getByText('Species in node forward tracking')).toBeInTheDocument()
    expect(screen.queryByText(/no definition registered/)).toBeNull()
  })

  it('says which nodes the headline covers and which the species rows cover', () => {
    renderReport()

    expect(screen.getByText(/131 species rows sum to 1,742,145 nodes/)).toBeInTheDocument()
    expect(screen.getByText(/exactly the LEAF total/)).toBeInTheDocument()
    expect(screen.getByText(/Two different denominators, not a contradiction/)).toBeInTheDocument()
  })

  it('surfaces UNKNOWN at 0 % of 347 nodes, which no bar can draw', () => {
    renderReport()

    expect(screen.getByText('0 % of 347 nodes')).toBeInTheDocument()
    expect(screen.getByText(/UNKNOWN: 0 of 347 nodes tracked forward/)).toBeInTheDocument()
    expect(screen.getByText(/measured zero, not a missing measurement/)).toBeInTheDocument()
  })

  it('reads the low tail one species at a time rather than flagging them all alike', () => {
    renderReport()

    const table = screen.getByRole('table', {
      name: /Species below 90 % node forward tracking/,
    })

    // DAPMA is explained; FELCA is not. Both words are on screen, in the same table.
    expect(
      within(table).getByText('New in this build — no previous nodes to track')
    ).toBeInTheDocument()
    expect(
      within(table).getAllByText('Established previous proteome — not explained')
    ).toHaveLength(13)
    expect(within(table).getAllByText('Explained').length).toBe(1)
    expect(within(table).getAllByText('Not explained').length).toBe(13)
  })

  it('orders the low tail by nodes lost rather than by rate, and says so', () => {
    renderReport()

    const table = screen.getByRole('table', {
      name: /Species below 90 % node forward tracking/,
    })
    const first = table.querySelectorAll('tbody tr')[0]

    // IXOSC loses 14,932 nodes at 17.1 %; DAPMA loses 10,544 at 0 %.
    expect(first).toHaveTextContent('IXOSC')
    expect(first).toHaveTextContent('14,932')
    expect(
      screen.getByText(/ordered by nodes not tracked forward rather than by rate/)
    ).toBeInTheDocument()
  })

  it('presents the one rename and the two replacements as different categories', () => {
    renderReport()

    expect(screen.getByText('Renames — exact count match')).toBeInTheDocument()
    expect(screen.getByText('Candidate replacements — counts do not match')).toBeInTheDocument()
    expect(screen.getByText(/USTMA → MYCMD, 6,788 sequences on both sides/)).toBeInTheDocument()
    expect(
      screen.getByText(/CRYNJ → CRYD1, 6,604 to 6,603 - 0 % apart, so a replacement/)
    ).toBeInTheDocument()
    expect(
      screen.getByText(/DAPPU → DAPMA, 30,118 to 26,600 - 12 % apart, so a replacement/)
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Exact-count pairing finds 1 rename and 2 candidate replacements/)
    ).toBeInTheDocument()
  })

  it('scopes the rename inference to the rows the report includes', () => {
    renderReport()

    expect(screen.getByText(/not a count of renames in the release/)).toBeInTheDocument()
    expect(screen.getAllByText(/50 of 147 rows included in report/).length).toBeGreaterThan(0)
  })

  it('opens a species from the low tail', async () => {
    const { user, store } = renderReport()

    const table = screen.getByRole('table', {
      name: /Species below 90 % node forward tracking/,
    })
    await user.click(within(table).getByRole('button', { name: 'DAPMA' }))

    expect(store.getState().build.selectedOscode).toBe('DAPMA')
  })

  it('shows unknown, not zero, for a species missing from the truncated table', async () => {
    const { user } = renderReport()

    await user.click(screen.getByRole('button', { name: /Full species table/ }))
    await user.type(screen.getByLabelText('Filter species by oscode'), 'ECOLI')

    const table = screen.getByRole('table', {
      name: /Species node forward tracking, joined with the previous-library comparison/,
    })
    const row = table.querySelector('[data-row-key="ECOLI"]') as HTMLElement

    expect(row).toHaveTextContent('3,421')
    expect(within(row).getAllByTitle(/unknown, not zero/).length).toBe(4)
    expect(row).not.toHaveTextContent('New in this build')
  }, 20000)

  it('degrades to a stated absence when the section is not in the report', () => {
    // The section is stripped, so the report registry would not mount this view at all; rendering
    // it anyway proves it states the absence rather than drawing zeros.
    renderReport('missingNodeTracking')

    expect(markCount()).toBe(0)
    expect(screen.getAllByText(/Not in this report/).length).toBeGreaterThan(0)
    expect(screen.queryByText('93.5')).toBeNull()
  })
})
