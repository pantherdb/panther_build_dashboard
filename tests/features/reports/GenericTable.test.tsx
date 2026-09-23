import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

/**
 * A one-column, untruncated table - a plain list wearing a table shape - collapses into a
 * disclosure instead of a full sortable grid. Decided from the table's own shape (column count,
 * truncation), never from its name, so an unfamiliar future section gets the same treatment.
 */
const SINGLE_COLUMN_TABLE = {
  key: 'giga_removed_single_genome',
  sectionId: 'giga',
  name: 'Families removed after GIGA (single genome)',
  columns: ['family'],
  rows: [{ family: 'PTHR30001' }, { family: 'PTHR30002' }],
  includedRows: 2,
  totalRows: 2,
  raggedRows: null,
  definesColumn: null,
}

describe('GenericTable, a single-column untruncated table', () => {
  it('renders collapsed, with the table name and row count in the summary', () => {
    renderWithProviders(<GenericTable table={SINGLE_COLUMN_TABLE} />)
    const toggle = screen.getByRole('button', { name: /removed after giga/i })
    expect(toggle).toHaveTextContent('2')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  it('reveals the values once opened', async () => {
    renderWithProviders(<GenericTable table={SINGLE_COLUMN_TABLE} />)
    const toggle = screen.getByRole('button', { name: /removed after giga/i })
    // The panel stays mounted while closed (Disclosure.tsx) and jsdom loads no CSS, so
    // `toBeVisible()` alone would pass even behind the `hidden` class. Assert the real
    // mechanism directly: `aria-expanded` and the `hidden` class on the panel itself.
    const panel = screen.getByText('PTHR30001').closest('[data-pb-disclosure-panel]')
    expect(panel).not.toBeNull()
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(panel).toHaveClass('hidden')

    await userEvent.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(panel).not.toHaveClass('hidden')
    expect(screen.getByText('PTHR30001')).toBeVisible()
    expect(screen.getByText('PTHR30002')).toBeVisible()
  })

  it('renders the name plus "none" with no toggle when there are zero rows', () => {
    renderWithProviders(
      <GenericTable
        table={{
          ...SINGLE_COLUMN_TABLE,
          name: 'Families with an empty tree',
          rows: [],
          includedRows: 0,
          totalRows: 0,
        }}
      />
    )
    expect(screen.getByText(/families with an empty tree/i)).toBeInTheDocument()
    expect(screen.getByText(/none/i)).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('leaves a TRUNCATED single-column table as an ordinary table, not collapsed', () => {
    renderWithProviders(
      <GenericTable
        table={{
          ...SINGLE_COLUMN_TABLE,
          rows: [{ family: 'PTHR1' }],
          includedRows: 1,
          totalRows: 5,
        }}
      />
    )
    // Truncation disables sorting too, so there is no button at all here - the value is simply
    // on screen, the honest reading of a subset the report itself says is incomplete.
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('PTHR1')).toBeVisible()
  })

  it('leaves a multi-column table as an ordinary table, values visible without a click', () => {
    // A multi-column table's own sort buttons are expected here - the assertion is only that the
    // VALUE never sits behind a disclosure toggle. `toBeVisible()` alone can't tell a real
    // absence of the `hidden` class from jsdom simply not applying the class's CSS, so assert
    // there is no disclosure panel ancestor at all - nothing here to reveal with a click.
    renderWithProviders(<GenericTable table={TABLE} />)
    const cell = screen.getByText('153')
    expect(cell.closest('[data-pb-disclosure-panel]')).toBeNull()
    expect(cell).toBeVisible()
  })
})
