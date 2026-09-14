import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { MetricDefinitionsProvider } from '@/@panther.core/components'
import { GenericTable } from '@/features/reports/components/GenericTable'
import { renderWithProviders } from '@tests/test-utils'

/**
 * A table from an unfamiliar section, with its bucket column defined (spec §6.3).
 *
 * Only the column the generator named is treated as vocabulary. Matching any cell whose value
 * happens to equal a defined term would eventually put a tooltip on a family id.
 */
const REGISTRY = {
  'recluster.new_family': {
    id: 'recluster.new_family',
    label: 'Became a new family',
    description: 'Minted a new PANTHER family id.',
  },
}

const TABLE = {
  key: 'recluster_table_1',
  sectionId: 'recluster',
  name: 'Cluster outcomes',
  columns: ['outcome', 'clusters'],
  rows: [{ outcome: 'new_family', clusters: 153 }],
  includedRows: 1,
  totalRows: 1,
  raggedRows: null,
  definesColumn: 'outcome',
}

describe('GenericTable with a defined column', () => {
  it('renders a defined cell as its label', () => {
    renderWithProviders(
      <MetricDefinitionsProvider registry={REGISTRY}>
        <GenericTable table={TABLE} />
      </MetricDefinitionsProvider>
    )
    expect(screen.getByText('Became a new family')).toBeInTheDocument()
    expect(screen.queryByText('new_family')).not.toBeInTheDocument()
  })

  it('leaves every other column untouched', () => {
    renderWithProviders(
      <MetricDefinitionsProvider registry={REGISTRY}>
        <GenericTable table={TABLE} />
      </MetricDefinitionsProvider>
    )
    expect(screen.getByText('153')).toBeInTheDocument()
  })

  it('shows the raw term when the column is defined but the term is not', () => {
    renderWithProviders(
      <MetricDefinitionsProvider registry={REGISTRY}>
        <GenericTable table={{ ...TABLE, rows: [{ outcome: 'mystery', clusters: 1 }] }} />
      </MetricDefinitionsProvider>
    )
    expect(screen.getByText('mystery')).toBeInTheDocument()
  })

  it('leaves a non-defines column plain even when its value equals a defined term', () => {
    // The column-identity check (`table.definesColumn === column`) makes this structurally
    // impossible today, but only a test proves it: matching by value instead would eventually put
    // a tooltip on a family id or oscode that happens to coincide with a bucket name.
    renderWithProviders(
      <MetricDefinitionsProvider registry={REGISTRY}>
        <GenericTable
          table={{
            ...TABLE,
            columns: ['outcome', 'note'],
            rows: [{ outcome: 'single_organism', note: 'new_family' }],
          }}
        />
      </MetricDefinitionsProvider>
    )
    expect(screen.getByText('new_family')).toBeInTheDocument()
    expect(screen.queryByText('Became a new family')).not.toBeInTheDocument()
  })

  it('does not define cells in a table that names no column', () => {
    renderWithProviders(
      <MetricDefinitionsProvider registry={REGISTRY}>
        <GenericTable table={{ ...TABLE, definesColumn: null }} />
      </MetricDefinitionsProvider>
    )
    expect(screen.getByText('new_family')).toBeInTheDocument()
    expect(screen.queryByText('Became a new family')).not.toBeInTheDocument()
  })
})
