import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MetricDefinitionsProvider } from '@/@panther.core/components'
import { curatedRegistry } from '@/app/metricRegistry'
import type { FixtureStateKey } from '@/features/build/fixtures'
import { initialBuildUiState } from '@/features/build/slices/buildSlice'
import { ReportsIndex } from '@/features/reports/components/ReportsIndex'
import { renderWithProviders } from '@tests/test-utils'

/**
 * The report's own table of contents.
 *
 * Its job is to answer "what is in this report, and how much of it does this dashboard understand?"
 * - which is where the schema contract and the extensibility claim become visible at once. An
 * unrecognised section has to be listed, marked, and rendered; a status the dashboard does not know
 * has to survive as a literal; a newer schema has to say so without refusing to render.
 */

const renderIndex = (fixtureStateKey: FixtureStateKey) =>
  renderWithProviders(
    <MetricDefinitionsProvider registry={curatedRegistry}>
      <ReportsIndex />
    </MetricDefinitionsProvider>,
    { preloadedState: { build: { ...initialBuildUiState, fixtureStateKey } } }
  )

describe('ReportsIndex on the captured report', () => {
  it('lists all nine sections, grouped by where they belong', () => {
    renderIndex('real')

    // Appendix A.1: nine sections - `proteomes` joined the report between config_ledger and progress.
    expect(screen.getByText('9 in this report')).toBeInTheDocument()
    expect(screen.getByText('Build preamble')).toBeInTheDocument()
    expect(screen.getByText('The pipeline spine')).toBeInTheDocument()
    expect(screen.getByText('Bound to a pipeline phase')).toBeInTheDocument()

    for (const sectionId of [
      'config_ledger',
      'proteomes',
      'progress',
      'mapping',
      'node_tracking',
      'library',
      'prev_lib',
      'giga',
      'other_reports',
    ]) {
      expect(screen.getAllByText(sectionId).length).toBeGreaterThan(0)
    }
  })

  it('says every section is recognised and the schema is supported', () => {
    renderIndex('real')

    expect(screen.getByText('Every section recognised')).toBeInTheDocument()
    expect(screen.getByText('Schema 1 supported')).toBeInTheDocument()
  })

  it('names the view each section gets, and marks the ones the fallback renders', () => {
    renderIndex('real')

    expect(screen.getByText('Sequence mapping statistics')).toBeInTheDocument()
    // The section title, the renderer's name and the phase it binds to all read the same here.
    expect(screen.getAllByText('Node forward tracking')).toHaveLength(3)
    // One renderer serves prev_lib AND other_reports, which is why both rows name it.
    expect(screen.getAllByText('Previous-library comparison')).toHaveLength(2)
    // config_ledger, library and giga have no specialised view on the real report.
    expect(screen.getAllByText('Generic fallback')).toHaveLength(3)
    expect(screen.getByText('The spine itself')).toBeInTheDocument()
  })

  it('quotes the generator’s own reason for an absent section', () => {
    renderIndex('real')
    expect(screen.getByText('Absent')).toBeInTheDocument()
  })
})

describe('ReportsIndex with unknown sections', () => {
  it('lists a section the dashboard has never seen and marks it unrecognised', () => {
    renderIndex('unknownSection')

    // Nine real sections plus the two synthetic unknown ones (pfam_coverage, tree_quality).
    expect(screen.getByText('11 in this report')).toBeInTheDocument()
    expect(screen.getByText('2 unrecognised')).toBeInTheDocument()
    expect(screen.getAllByText('pfam_coverage').length).toBeGreaterThan(0)
    expect(screen.getAllByText('tree_quality').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Unrecognised section').length).toBeGreaterThan(1)
  })

  it('renders both unknown sections through the fallback, differently shaped as they are', async () => {
    const { user } = renderIndex('unknownSection')
    for (const name of ['Pfam domain coverage', 'Tree quality summary']) {
      await user.click(screen.getByRole('button', { name: new RegExp(name) }))
    }

    // pfam_coverage: text, metrics, a truncated table and a warning.
    expect(
      screen.getByText('Pfam 36.0 domains matched against library sequences.')
    ).toBeInTheDocument()
    expect(screen.getByText('3 of 19,632 rows included in report')).toBeInTheDocument()
    expect(screen.getByText('412 families have no Pfam domain match')).toBeInTheDocument()

    // tree_quality: headline and rows only, no text and no table.
    expect(screen.getByText('trees_scored')).toBeInTheDocument()
    expect(screen.getByText('median_support')).toBeInTheDocument()
  })

  it('shows the phase hint that binds one of them to a declared phase', () => {
    renderIndex('unknownSection')
    expect(screen.getByText(/hint: tree-building-giga/)).toBeInTheDocument()
  })
})

describe('ReportsIndex degradation', () => {
  it('keeps an unrecognised section status as a literal', () => {
    const { container } = renderIndex('unknownStatus')

    expect(container).toHaveTextContent('Unknown status: degraded')
    // node_tracking is now sections[4]: proteomes was inserted at index 1, shifting every section
    // after config_ledger back by one (Appendix A.1).
    expect(container).toHaveTextContent('sections[4].status')
  })

  it('says a newer schema is not fully supported and still lists what it understands', () => {
    renderIndex('futureSchema')

    expect(screen.getByText('Schema not fully supported')).toBeInTheDocument()
    const notice = screen.getByRole('note')
    expect(notice).toHaveTextContent('Unknown schema version: 2')
    expect(notice).toHaveTextContent(/still listed and still render/)

    // The sections it does understand are still there, with their specialised views named.
    expect(screen.getByText('9 in this report')).toBeInTheDocument()
    expect(screen.getByText('Sequence mapping statistics')).toBeInTheDocument()
  })

  it('survives the fully degraded state: newer schema, unknown section, unknown status, missing section', () => {
    const { container } = renderIndex('degraded')

    expect(screen.getByText('Schema not fully supported')).toBeInTheDocument()
    expect(screen.getByText('2 unrecognised')).toBeInTheDocument()
    expect(container).toHaveTextContent('Unknown status: degraded')
    // Nine real sections plus the two synthetic unknown ones, minus prev_lib which was stripped -
    // ten sections remain and none of them is prev_lib.
    expect(screen.getByText('10 in this report')).toBeInTheDocument()
    expect(screen.queryByText('prev_lib')).toBeNull()
  })
})

describe('ReportsIndex links', () => {
  it('links each section to its own anchor', () => {
    const { container } = renderIndex('real')

    // Queried by href rather than by role: the index mounts the whole fallback reading of the
    // configuration ledger, and a role scan over that in jsdom is slower than the test budget.
    const link = container.querySelector('a[href="/build#report--library"]')
    expect(link).not.toBeNull()
    expect(link).toHaveTextContent('New library contents')
    expect(container.querySelector('a[href="/build#report--node-tracking"]')).not.toBeNull()
  })

  it('scopes the unattached group to sections with no phase binding', () => {
    renderIndex('unknownSection')

    const heading = screen.getByText('Unattached')
    const group = heading.closest('div')?.parentElement
    expect(group).not.toBeNull()
    expect(within(group as HTMLElement).getAllByText('pfam_coverage').length).toBeGreaterThan(0)
  })
})
