import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@tests/test-utils'
import { MetricDefinitionsProvider } from '@/@panther.core/components'
import { buildMetricRegistry } from '@/app/metricRegistry'
import { getFixtureReport } from '@/features/build/fixtures'
import { UnplacedFragmentsReportView } from '@/features/trees/components/UnplacedFragmentsReport'
import { getReportRenderer } from '@/features/reports/registry'
import type { BuildReport } from '@/features/build/model'

/**
 * Who GIGA left out of each tree.
 *
 * The family table is the navigation; the member table is the answer. `members === null` is a
 * family whose ids the report dropped to stay small - it must read as "left out", never as "none".
 */

const report = getFixtureReport('gigaUsf')

const renderView = (r: BuildReport = report) =>
  renderWithProviders(<UnplacedFragmentsReportView report={r} />)

describe('UnplacedFragmentsReport', () => {
  it('is the renderer for giga_usf', () => {
    expect(getReportRenderer('giga_usf')?.key).toBe('giga-usf')
  })

  it('lists every family with unplaced sequences', () => {
    renderView()
    const table = screen.getByRole('table', { name: /families with unplaced fragments/i })
    expect(within(table).getByText('PTHR10000')).toBeInTheDocument()
    expect(within(table).getByText('PTHR10001')).toBeInTheDocument()
    expect(within(table).getByText('PTHR10002')).toBeInTheDocument()
  })

  it('shows the long IDs of the family you pick, split into species, gene and accession', async () => {
    renderView()
    await userEvent.click(screen.getByText('PTHR10002'))
    const members = screen.getByRole('table', { name: /unplaced in PTHR10002/i })
    expect(within(members).getByText('MOUSE|MGI=MGI=9|UniProtKB=Q00009')).toBeInTheDocument()
    expect(within(members).getByRole('link', { name: 'Q00009' })).toHaveAttribute(
      'href',
      'https://www.uniprot.org/uniprotkb/Q00009/entry'
    )
  })

  it('finds a family by the accession of a kicked-out sequence', async () => {
    renderView()
    await userEvent.type(screen.getByLabelText(/filter families/i), 'P00008')
    const table = screen.getByRole('table', { name: /families with unplaced fragments/i })
    expect(within(table).getByText('PTHR10002')).toBeInTheDocument()
    expect(within(table).queryByText('PTHR10001')).not.toBeInTheDocument()
    expect(screen.getByText(/1 of 3 families/)).toBeInTheDocument()
  })

  it('says whether the post-GIGA mapping has unassigned them', () => {
    renderView()
    expect(screen.getByText(/9 unassigned in the post-GIGA mapping/i)).toBeInTheDocument()
  })

  it('warns when the mapping was never checked, rather than implying it was', () => {
    const unchecked = getFixtureReport('gigaUsf')
    renderView({
      ...unchecked,
      unplacedFragments: { ...unchecked.unplacedFragments, unassignedInMapping: null },
    })
    expect(screen.getByText(/post-GIGA mapping not checked/i)).toBeInTheDocument()
  })

  it('says where the IDs are when the report left them out, instead of showing none', async () => {
    renderView()
    await userEvent.click(screen.getByText('PTHR10000'))
    expect(screen.getByText(/left these IDs out/i)).toBeInTheDocument()
    expect(screen.getByText(/PTHR10000\.orig\.usf/)).toBeInTheDocument()
    expect(screen.queryByRole('table', { name: /unplaced in PTHR10000/i })).not.toBeInTheDocument()
  })

  it('warns that some families are unsearchable by member id while a filter is active', async () => {
    renderView()
    await userEvent.type(screen.getByLabelText(/filter families/i), 'P00008')
    expect(
      screen.getByText(/ids for 1 family are not in this report; this search covers the rest/i)
    ).toBeInTheDocument()
  })

  it('does not show the unsearchable-families note when the filter is empty', () => {
    renderView()
    expect(screen.queryByText(/are not in this report/i)).not.toBeInTheDocument()
  })

  it('does not claim zero families on a report without the section', () => {
    renderView(getFixtureReport('real'))
    expect(screen.queryByRole('table', { name: /families with unplaced fragments/i })).toBeNull()
    expect(screen.queryByText(/^0 of/)).toBeNull()
  })

  describe('the sidecar contract (Task 2)', () => {
    it('loads families from the real frozen sidecar fixture via the test-alias wiring, no mocking', async () => {
      const sidecarReport = getFixtureReport('gigaUsfSidecar')
      renderView(sidecarReport)
      // Synchronously: still loading, headline already visible from the main report alone.
      expect(screen.getByText(/loading families/i)).toBeInTheDocument()
      expect(screen.getByText(/2 of 15,790 books had sequences/i)).toBeInTheDocument()

      const table = await screen.findByRole('table', { name: /families with unplaced fragments/i })
      expect(within(table).getByText('PTHR10000')).toBeInTheDocument()
      expect(within(table).getByText('PTHR10001')).toBeInTheDocument()
      expect(screen.queryByText(/loading families/i)).not.toBeInTheDocument()

      await userEvent.click(screen.getByText('PTHR10000'))
      const members = await screen.findByRole('table', { name: /unplaced in PTHR10000/i })
      expect(within(members).getByText('MOUSE|MGI=MGI=4|UniProtKB=Q00004')).toBeInTheDocument()
    })
  })

  it('no longer renders the giga section family-id lists - they moved to the generic giga report', () => {
    // "Families with an empty tree" and "Families removed after GIGA (single genome)" are the
    // `giga` section's own tables, not `giga_usf`'s. They now render wherever `giga` itself does
    // (`GenericReport.test.tsx`'s "the giga section family-id lists" suite covers them there).
    renderView()
    expect(screen.queryByText(/families with an empty tree/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/removed after giga/i)).not.toBeInTheDocument()
  })

  describe('family table columns (Input seqs / Unplaced / In final tree / Share unplaced)', () => {
    it('orders the columns Family, Input seqs, Unplaced, In final tree, Share unplaced', () => {
      renderView()
      const table = screen.getByRole('table', { name: /families with unplaced fragments/i })
      const headers = within(table)
        .getAllByRole('columnheader')
        .map(header => header.textContent)
      expect(headers[0]).toMatch(/^family/i)
      expect(headers[1]).toMatch(/input seqs/i)
      expect(headers[2]).toMatch(/^unplaced/i)
      expect(headers[3]).toMatch(/in final tree/i)
      expect(headers[4]).toMatch(/share unplaced/i)
    })

    it('shows a null input_seqs (old in-report shape never carries it) as the absent mark', () => {
      renderView()
      const table = screen.getByRole('table', { name: /families with unplaced fragments/i })
      const row = within(table).getByText('PTHR10000').closest('tr')
      expect(row).not.toBeNull()
      expect(within(row as HTMLElement).getByText('—')).toBeInTheDocument()
    })

    it('shows the generator definition as a tooltip on a header that has one', async () => {
      // `renderView` (via `renderWithProviders`) carries no metric-definitions registry by
      // default, same as every other test here - the app only wires one up at the `App` root
      // (`buildMetricRegistry`), so this is the one test that opts in explicitly to prove the
      // header actually resolves the generator's own definition, not a hardcoded string.
      const sidecarReport = getFixtureReport('gigaUsfSidecar')
      renderWithProviders(
        <MetricDefinitionsProvider registry={buildMetricRegistry(sidecarReport)}>
          <UnplacedFragmentsReportView report={sidecarReport} />
        </MetricDefinitionsProvider>
      )
      await screen.findByRole('table', { name: /families with unplaced fragments/i })
      await userEvent.hover(screen.getByText('Input seqs'))
      expect(await screen.findByText(/rows assigned to this family/i)).toBeInTheDocument()
    })
  })

  describe('the input_mismatch_families note', () => {
    it('says nothing when the count is zero', async () => {
      renderView(getFixtureReport('gigaUsfSidecar'))
      await screen.findByRole('table', { name: /families with unplaced fragments/i })
      expect(screen.queryByText(/input ≠ unplaced/i)).not.toBeInTheDocument()
    })

    it('shows a one-line note above the family table when the count is greater than zero', () => {
      // The old-shape fixture's family table is available synchronously (`not-referenced`), so
      // this test does not also need to await the sidecar's async load.
      const base = getFixtureReport('gigaUsf')
      renderView({
        ...base,
        unplacedFragments: { ...base.unplacedFragments, inputMismatchFamilies: 3 },
      })
      expect(screen.getByText(/3 families: input ≠ unplaced \+ in final tree/i)).toBeInTheDocument()
    })
  })

  describe('the by-proteome table', () => {
    // The by-proteome table reads straight off the main report and needs no sidecar fetch, but
    // `gigaUsfSidecar` still starts one for the family table underneath it. Awaiting that settle
    // (rather than leaving it pending past the end of the test) keeps every state update here
    // inside `act`.
    const renderSidecarReport = async () => {
      renderView(getFixtureReport('gigaUsfSidecar'))
      await screen.findByRole('table', { name: /families with unplaced fragments/i })
    }

    it('lists every oscode from the report’s by-proteome table, including one with zero unplaced', async () => {
      await renderSidecarReport()
      const table = screen.getByRole('table', { name: /unplaced fragments by proteome/i })
      expect(within(table).getByText('HUMAN')).toBeInTheDocument()
      expect(within(table).getByText('MOUSE')).toBeInTheDocument()
      expect(within(table).getByText('DANRE')).toBeInTheDocument()
    })

    it('shows the taxonomic name, humanised, next to the oscode', async () => {
      await renderSidecarReport()
      const table = screen.getByRole('table', { name: /unplaced fragments by proteome/i })
      expect(within(table).getByText('Homo sapiens')).toBeInTheDocument()
      expect(within(table).getByText('Mus musculus')).toBeInTheDocument()
      expect(within(table).getByText('Danio rerio')).toBeInTheDocument()
    })

    it('sorts by unplaced, descending, by default - not just the report’s own row order', async () => {
      await renderSidecarReport()
      const table = screen.getByRole('table', { name: /unplaced fragments by proteome/i })
      const rows = within(table).getAllByRole('row').slice(1)
      expect(within(rows[0]).getByText('HUMAN')).toBeInTheDocument()
      expect(within(rows[1]).getByText('MOUSE')).toBeInTheDocument()
      expect(within(rows[2]).getByText('DANRE')).toBeInTheDocument()
    })

    it('shows the zero-unplaced proteome as a measured zero, not blank', async () => {
      await renderSidecarReport()
      const table = screen.getByRole('table', { name: /unplaced fragments by proteome/i })
      const row = within(table).getByText('DANRE').closest('tr')
      // Both `unplaced` and `families` are a measured zero on this row - two "0" cells, not one
      // hidden behind the absent mark.
      expect(within(row as HTMLElement).getAllByText('0')).toHaveLength(2)
    })

    it('formats the percentage columns to two decimals with a % suffix', async () => {
      await renderSidecarReport()
      const table = screen.getByRole('table', { name: /unplaced fragments by proteome/i })
      expect(within(table).getByText('0.02%')).toBeInTheDocument()
    })

    it('falls back to the old "Unplaced fragments by species" table on an older report, with the new columns absent', () => {
      renderView(getFixtureReport('gigaUsf'))
      const table = screen.getByRole('table', { name: /unplaced fragments by proteome/i })
      expect(within(table).getByText('HUMAN')).toBeInTheDocument()
      expect(within(table).getByText('MOUSE')).toBeInTheDocument()
      const humanRow = within(table).getByText('HUMAN').closest('tr')
      expect(within(humanRow as HTMLElement).getAllByText('—').length).toBeGreaterThan(0)
    })

    it('says so instead of rendering an empty table when there are no per-proteome counts', () => {
      renderView({ ...report, unplacedFragments: { ...report.unplacedFragments, bySpecies: [] } })
      expect(screen.getByText('No per-proteome counts in this report.')).toBeInTheDocument()
      expect(
        screen.queryByRole('table', { name: /unplaced fragments by proteome/i })
      ).not.toBeInTheDocument()
    })
  })

  describe('the member table (Species · Taxonomic name · UniProt · Long ID)', () => {
    it('has no Gene column and orders Species, Taxonomic name, UniProt, Long ID', async () => {
      renderView()
      await userEvent.click(screen.getByText('PTHR10002'))
      const members = screen.getByRole('table', { name: /unplaced in PTHR10002/i })
      const headers = within(members)
        .getAllByRole('columnheader')
        .map(header => header.textContent)
      expect(headers).toEqual(['Species', 'Taxonomic name', 'UniProt', 'Long ID'])
      expect(within(members).queryByText(/^HGNC=/)).not.toBeInTheDocument()
    })

    it('shows the humanised taxonomic name for each member', async () => {
      renderView()
      await userEvent.click(screen.getByText('PTHR10002'))
      const members = screen.getByRole('table', { name: /unplaced in PTHR10002/i })
      expect(within(members).getByText('Homo sapiens')).toBeInTheDocument()
      expect(within(members).getByText('Mus musculus')).toBeInTheDocument()
    })
  })
})
