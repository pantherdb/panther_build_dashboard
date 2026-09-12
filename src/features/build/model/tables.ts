/**
 * Table normalisation and truncation metadata.
 *
 * Every table in `other_reports` is a subset of its real result set, so truncation is carried
 * through the model rather than discovered in a component. `allowClientSort` / `allowClientFilter`
 * are false whenever the rows are a subset, because sorting a subset implies a completeness the
 * report does not have.
 *
 * `ragged_rows` is a COUNT, not a boolean. It is 813 on one table in this fixture, and typing it
 * as a boolean would compile and read 813 as truthy right up until the day it is 0.
 */

import {
  asArray,
  asInteger,
  asNonEmptyString,
  asRecord,
  asString,
  asStringArray,
  isRecord,
} from './primitives'
import { makeMeta } from './notes'
import type { DerivedTable, SummaryMeta, TableTruncation } from './types'

export interface NormalisedTable {
  name: string
  columns: string[]
  /** Rows as records keyed by column name, whichever shape the report used. */
  records: Record<string, unknown>[]
  rawRows: unknown[]
  truncation: TableTruncation
  /** Column whose cell values are terms the section defined. `null` when the table names none. */
  definesColumn: string | null
}

export function buildTruncation(
  includedRows: number,
  totalRows: number | null,
  truncatedFlag: boolean | null,
  raggedRows: number | null
): TableTruncation {
  const truncated =
    truncatedFlag === true || (totalRows !== null && totalRows > includedRows) || false
  const label =
    totalRows === null
      ? truncated
        ? `${includedRows} rows included in report (subset)`
        : `${includedRows} rows`
      : truncated
        ? `${includedRows} of ${totalRows} rows included in report`
        : `${totalRows} rows`

  return {
    truncated,
    includedRows,
    totalRows,
    raggedRows,
    hasRaggedRows: raggedRows !== null && raggedRows > 0,
    allowClientSort: !truncated,
    allowClientFilter: !truncated,
    label,
  }
}

export const EMPTY_TRUNCATION: TableTruncation = buildTruncation(0, null, false, null)

/** Reads one raw table object. Row arrays are zipped against `columns` so both shapes work. */
export function normaliseTable(raw: unknown, fallbackName: string): NormalisedTable {
  const record = asRecord(raw)
  const rawRows = asArray(record?.rows)
  const columns = asStringArray(record?.columns)
  const records = rawRows.map((row, rowIndex) => {
    if (isRecord(row)) return row
    if (Array.isArray(row)) {
      const out: Record<string, unknown> = {}
      row.forEach((cell, index) => {
        out[columns[index] ?? `column_${index + 1}`] = cell
      })
      return out
    }
    return { value: row, row_index: rowIndex }
  })

  const derivedColumns =
    columns.length > 0 ? columns : [...new Set(records.flatMap(entry => Object.keys(entry)))]

  return {
    name: asNonEmptyString(record?.name) ?? fallbackName,
    columns: derivedColumns,
    records,
    rawRows,
    truncation: buildTruncation(
      rawRows.length,
      asInteger(record?.total_rows),
      typeof record?.truncated === 'boolean' ? record.truncated : null,
      asInteger(record?.ragged_rows)
    ),
    definesColumn: asNonEmptyString(record?.defines),
  }
}

export function makeDerivedTable<TRow>(
  key: string,
  normalised: NormalisedTable,
  rows: TRow[],
  meta: SummaryMeta
): DerivedTable<TRow> {
  return {
    ...meta,
    key,
    name: normalised.name,
    columns: normalised.columns,
    rows,
    rawRows: normalised.rawRows,
    truncation: normalised.truncation,
    definesColumn: normalised.definesColumn,
  }
}

/** A table the report did not contain. Still an object, so no view null-checks it. */
export function absentTable<TRow>(
  key: string,
  name: string,
  sectionId: string,
  reason: string
): DerivedTable<TRow> {
  return {
    ...makeMeta({ availability: 'absent', sectionId, notes: [reason] }),
    key,
    name,
    columns: [],
    rows: [],
    rawRows: [],
    truncation: EMPTY_TRUNCATION,
    definesColumn: null,
  }
}

/** Best-effort display string for the generic renderer; never throws on odd values. */
export function formatUnknownValue(value: unknown): string {
  if (value === null) return '—'
  if (value === undefined) return '—'
  if (typeof value === 'string') return value
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '—'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (Array.isArray(value)) {
    return value.length === 0 ? '(empty)' : value.map(entry => formatUnknownValue(entry)).join(', ')
  }
  const text = asString(value)
  if (text !== null) return text
  try {
    return JSON.stringify(value) ?? '—'
  } catch {
    return '(unrepresentable)'
  }
}
