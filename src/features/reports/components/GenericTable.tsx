import { DataTable } from '@/@panther.core/components'
import { fileSizeLabel, formatFileSize, isFileSizeKey } from '@/@panther.core/fileSize'
import type { DataColumn } from '@/@panther.core/components'
import { formatUnknownValue } from '@/features/build/model'
import type { GenericTableView } from '@/features/reports/model/genericView'

/**
 * A table from an unfamiliar report section.
 *
 * Nothing here knows what the columns mean, so the two things it must get right are honesty and
 * type: truncation is passed through so `DataTable` disables sorting and filtering on a subset -
 * sorting 50 of 147 rows and calling the top one the largest is the specific wrong answer - and a
 * column is right-aligned with tabular figures only when every value present in it is a number.
 * Everything else is treated as an identifier and rendered mono, which is what the values in this
 * report actually are: oscodes, accessions, paths and filenames.
 *
 * `ragged_rows` is a COUNT, and it is reported even when the table is not truncated, because a
 * table whose full result set has rows of differing width is a fact about the data rather than a
 * detail of this rendering.
 */
export interface GenericTableProps {
  table: GenericTableView
  /** Rows shown before the first "show more". */
  pageSize?: number
}

interface KeyedRow {
  index: number
  row: Record<string, unknown>
}

const isNumeric = (value: unknown): boolean => typeof value === 'number' && Number.isFinite(value)

const isPresent = (value: unknown): boolean => value !== null && value !== undefined && value !== ''

/** A column is numeric only when every value it actually carries is a number. */
function columnIsNumeric(rows: readonly KeyedRow[], column: string): boolean {
  const present = rows.map(entry => entry.row[column]).filter(isPresent)
  return present.length > 0 && present.every(isNumeric)
}

/**
 * Grouped thousands in a numeric column, because a column of figures in a build report is read by
 * scanning. Fractions keep four decimals rather than being rounded to a friendlier number: one of
 * these tables stores a change as a fraction, and rounding a report's own value is not this view's
 * decision to make.
 */
function formatCell(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number.isInteger(value)
      ? value.toLocaleString()
      : value.toLocaleString(undefined, { maximumFractionDigits: 4 })
  }
  return formatUnknownValue(value)
}

/** A byte count only formats as a size if it really is a number; anything else falls through. */
function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function sortValueOf(value: unknown): number | string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'boolean') return value ? 1 : 0
  return formatUnknownValue(value)
}

export const GenericTable = ({ table, pageSize = 20 }: GenericTableProps) => {
  const rows: KeyedRow[] = table.rows.map((row, index) => ({ index, row }))

  const columns: DataColumn<KeyedRow>[] = table.columns.map(column => {
    const numeric = columnIsNumeric(rows, column)
    // A byte column is shown in units but still SORTED on the raw number, which is the whole
    // reason build_state.json keeps these numeric: sorting the formatted strings would put
    // `9.1 MB` above `1.4 GB`.
    const isSize = isFileSizeKey(column)
    return {
      id: column,
      header: <span className="pb-ident">{isSize ? fileSizeLabel(column) : column}</span>,
      kind: numeric || isSize ? 'number' : 'mono',
      render: entry =>
        isSize ? formatFileSize(asFiniteNumber(entry.row[column])) : formatCell(entry.row[column]),
      sortValue: entry => sortValueOf(entry.row[column]),
    }
  })

  const ragged =
    table.raggedRows !== null && table.raggedRows > 0
      ? `${table.raggedRows.toLocaleString()} rows in the full result set have a column count that ` +
        'differs from the header.'
      : null

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={entry => String(entry.index)}
      caption={table.name}
      captionVisible
      completeness={{ included: table.includedRows, total: table.totalRows }}
      density="tight"
      pageSize={pageSize}
      maxHeight={360}
      footNote={ragged}
    />
  )
}
