import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MetricDefinitionsProvider } from '@/@panther.core/components'
import { metricRegistry } from '@/app/metricRegistry'
import { getFixtureReport } from '@/features/build/fixtures'
import type { FixtureStateKey } from '@/features/build/fixtures'
import { parseBuildState } from '@/features/build/model'
import type { ReportRegistryEntry } from '@/features/build/model'
import { GenericReport } from '@/features/reports/components/GenericReport'
import { renderWithProviders } from '@tests/test-utils'

/**
 * The fallback renderer held to the same standard as a bespoke view.
 *
 * The assertions that matter are not "it renders": they are that a recognised key gets the shared
 * metric label, an unrecognised one is shown as the report's own field name rather than a guessed
 * English label, a truncated table says how much of itself is present, and an unfamiliar status
 * literal survives to the screen.
 */

function entryFrom(key: FixtureStateKey, sectionId: string): ReportRegistryEntry {
  const entry = getFixtureReport(key).reports.find(item => item.sectionId === sectionId)
  if (entry === undefined) throw new Error(`no ${sectionId} in fixture state ${key}`)
  return entry
}

function synthetic(section: Record<string, unknown>): ReportRegistryEntry {
  const report = parseBuildState({
    schema_version: 1,
    target: 'target',
    generated_at: '2026-08-20T23:26:31Z',
    sections: [section],
  })
  const entry = report.reports.find(item => item.sectionId === section.id)
  if (entry === undefined) throw new Error('no registry entry')
  return entry
}

const renderReport = (report: ReportRegistryEntry, anchors = true) =>
  renderWithProviders(
    <MetricDefinitionsProvider registry={metricRegistry}>
      <GenericReport report={report} anchors={anchors} />
    </MetricDefinitionsProvider>
  )

describe('GenericReport labels', () => {
  it('labels a recognised key from the definitions registry and never writes a bare "Sequences"', () => {
    renderReport(entryFrom('real', 'library'))

    // Appendix A.1/A.7: library carries genomes 131, sequences 1,742,145, families 15,795,
    // subfamilies 117,592 - and the sequence count is one of six, so it is named.
    expect(screen.getByText('Sequences in the built library')).toBeInTheDocument()
    expect(screen.getByText('1,742,145')).toBeInTheDocument()
    expect(screen.getByText('Genomes in the library')).toBeInTheDocument()
    expect(screen.getByText('131')).toBeInTheDocument()
    expect(screen.getByText('Families')).toBeInTheDocument()
    expect(screen.getByText('15,795')).toBeInTheDocument()
    expect(screen.getByText('Subfamilies')).toBeInTheDocument()
    expect(screen.getByText('117,592')).toBeInTheDocument()

    expect(screen.queryByText('Sequences')).toBeNull()
    expect(screen.queryByText('sequences')).toBeNull()
  })

  it('shows an unregistered key as the report’s own field name, marked ambiguous where it is', () => {
    renderReport(entryFrom('unknownSection', 'pfam_coverage'))

    const ambiguous = screen.getByText('sequences_total')
    expect(ambiguous).toHaveAttribute('data-ambiguous')
    // Not humanised into a label this dashboard cannot justify.
    expect(screen.queryByText('Sequences total')).toBeNull()

    const unambiguous = screen.getByText('distinct_domains')
    expect(unambiguous).not.toHaveAttribute('data-ambiguous')
  })

  it('shows a key the registry does not define without pretending it is defined', () => {
    renderReport(entryFrom('real', 'giga'))

    // Appendix A.7: 15,797 of 15,797 books have a usable tree, 0 empty.
    expect(screen.getByText('Books submitted to tree building')).toBeInTheDocument()
    expect(screen.getByText('Books with a usable tree')).toBeInTheDocument()
    expect(screen.getByText('Empty trees')).toBeInTheDocument()
    expect(screen.getByText('trees_built')).toBeInTheDocument()
  })
})

describe('GenericReport honesty', () => {
  it('states how much of a truncated table is present and reports the ragged-row count', () => {
    renderReport(entryFrom('real', 'other_reports'))

    // Appendix A.10.
    expect(screen.getByText('50 of 147 rows included in report')).toBeInTheDocument()
    expect(screen.getByText('20 of 132 rows included in report')).toBeInTheDocument()
    expect(screen.getByText('20 of 808 rows included in report')).toBeInTheDocument()
    expect(
      screen.getByText(
        '808 rows in the full result set have a column count that differs from the header.'
      )
    ).toBeInTheDocument()
    expect(
      screen.getAllByText('Sorting and filtering are disabled: they would imply a complete set.')
    ).toHaveLength(3)
  })

  it('keeps an unrecognised status literal visible instead of coercing it', () => {
    const { container } = renderReport(entryFrom('unknownStatus', 'node_tracking'))

    expect(container).toHaveTextContent('Unknown status: degraded')
    expect(screen.getByText('degraded')).toBeInTheDocument()
  })

  it('says the section is not in the report, quoting the generator, rather than showing zeros', () => {
    renderReport(entryFrom('real', 'prev_lib'))

    expect(screen.getByText(/Not in this report/)).toBeInTheDocument()
    expect(screen.getByText('inputs not present yet')).toBeInTheDocument()
  })

  it('marks the values as the generator’s and the reading as the dashboard’s', () => {
    const { container } = renderReport(entryFrom('real', 'giga'))

    expect(container.querySelector('[data-provenance="generator"]')).not.toBeNull()
    expect(container.querySelector('[data-provenance="derived"]')).not.toBeNull()
    expect(container).toHaveTextContent(/Read from the section’s structure alone/)
  })
})

describe('GenericReport payload shapes', () => {
  it('renders an array payload as a table', () => {
    renderReport(
      synthetic({
        id: 'future_array',
        title: 'Future array report',
        status: 'ok',
        data: [
          { pfam_id: 'PF00069', hits: 41203 },
          { pfam_id: 'PF00005', hits: 28714 },
        ],
      })
    )

    expect(screen.getByText('PF00069')).toBeInTheDocument()
    expect(screen.getByText('41,203')).toBeInTheDocument()
    expect(screen.getByText(/payload as an array, not an object/)).toBeInTheDocument()
  })

  it('renders a scalar payload verbatim', () => {
    renderReport(
      synthetic({ id: 'future_scalar', status: 'ok', data: 'nothing to report this run' })
    )

    expect(screen.getByText('nothing to report this run')).toBeInTheDocument()
  })

  it('reports a null payload as an absence rather than an empty frame', () => {
    renderReport(synthetic({ id: 'future_null', title: 'Future empty', status: 'ok', data: null }))

    expect(screen.getByText('Future empty — Not in this report')).toBeInTheDocument()
    expect(
      screen.getByText(
        'The report does not carry this section. Nothing below is inferred from its absence.'
      )
    ).toBeInTheDocument()
  })

  it('says so when a section is present and carries nothing structural', () => {
    renderReport(synthetic({ id: 'future_bare', title: 'Future bare', status: 'ok', data: {} }))

    expect(screen.getByText('No structural content in this section')).toBeInTheDocument()
  })

  it('shows unknown keys behind a disclosure rather than dropping them', () => {
    renderReport(
      synthetic({
        id: 'future_keys',
        status: 'ok',
        data: { headline: { a: 1 }, provenance: { tool: 'hmmer' }, record_count: 2 },
      })
    )

    expect(screen.getByText('Fields this view did not interpret')).toBeInTheDocument()
    expect(screen.getByText('provenance.tool')).toBeInTheDocument()
    expect(screen.getByText('record_count')).toBeInTheDocument()
    expect(screen.getByText('hmmer')).toBeInTheDocument()
  })
})

describe('GenericReport anchors', () => {
  it('anchors each configuration variable it renders, so a deep link can reach it', () => {
    const { container } = renderReport(entryFrom('real', 'config_ledger'))

    expect(container.querySelector('#config--qfo-data-dir')).not.toBeNull()
    expect(container.querySelectorAll('#config--pthr-version')).toHaveLength(1)
  })

  it('drops the anchors for a second, non-canonical rendering of the same section', () => {
    const { container } = renderReport(entryFrom('real', 'config_ledger'), false)

    expect(container.querySelector('#config--qfo-data-dir')).toBeNull()
  })
})

/**
 * Byte columns and byte metrics, as a reader compares them against the cluster.
 *
 * The report keeps these numeric; the formatting is at this edge so the column can still be
 * SORTED by true size -- formatting into build_state.json instead would sort lexicographically
 * and put `9.1 MB` above `1.4 GB`. `orthologs` is the only section emitting byte values today.
 */
describe('byte values are shown as file sizes', () => {
  const orthologs = () =>
    synthetic({
      id: 'orthologs',
      title: 'Orthologs & homolog products',
      status: 'ok',
      message: '',
      data: {
        text: 'three books',
        headline: { orthologs_all_bytes: 1_503_238_553, orthologs_books: 3 },
        rows: [{ metric: 'orthologs_all_bytes', value: 1_503_238_553 }],
        tables: [
          {
            name: 'Largest books by pairwise output',
            columns: ['book', 'bytes'],
            rows: [
              { book: 'PTHR10015', bytes: 1_503_238_553 },
              { book: 'PTHR10050', bytes: 9_500_000 },
            ],
            total_rows: 2,
            truncated: false,
          },
        ],
      },
    })

  it('renders a `bytes` cell in units rather than as a raw integer', () => {
    renderReport(orthologs())
    expect(screen.getByText('9.1 MB')).toBeInTheDocument()
    expect(screen.queryByText('1503238553')).not.toBeInTheDocument()
  })

  it('heads the column `size`, since the unit now lives in the value', () => {
    renderReport(orthologs())
    expect(screen.getByText('size')).toBeInTheDocument()
    expect(screen.queryByText('bytes')).not.toBeInTheDocument()
  })

  it('formats a byte headline metric too, not only the table column', () => {
    // `Orthologs all bytes: 1503238553` is the same defect one line from the column.
    renderReport(orthologs())
    expect(screen.queryAllByText('1503238553')).toHaveLength(0)
    expect(screen.queryAllByText('1.4 GB').length).toBeGreaterThan(1)
  })

  it('leaves a non-byte column and a plain count alone', () => {
    renderReport(orthologs())
    expect(screen.getByText('book')).toBeInTheDocument()
    expect(screen.getByText('PTHR10015')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })
})
