/**
 * The structural reading a report section gets when nobody has written a view for it.
 *
 * The rule this module exists to enforce: decompose a section from its COMMON STRUCTURAL ELEMENTS
 * only - headline values, rows, tables, text, warnings, status - and never from knowledge of what
 * the section means. That is what makes an unfamiliar future report usable on the day it appears
 * instead of on the day someone writes a renderer for it.
 *
 * Two decisions are worth explaining.
 *
 * It re-reads `entry.raw.data` for the preserved-fields pass rather than using the model's
 * `generic.extra`. `extra` excludes `current` and `record_count` as well as the keys it consumed,
 * so the configuration ledger's whole resolved block would disappear from a generic render. The
 * contract here is stricter: every `data` key this view did not consume is shown.
 *
 * A key is labelled from the metric definitions registry when it resolves to one, and otherwise
 * shown VERBATIM in mono as the report's own field name. It is never humanised into prose, because
 * this report carries six distinct sequence counts and a fallback that renders `sequences` as the
 * label "Sequences" is the exact defect the definitions registry exists to prevent.
 */

import { formatFileSize, isFileSizeKey } from '@/@panther.core/fileSize'
import {
  METRIC_DEFINITIONS,
  METRIC_IDS,
  configElementId,
  formatUnknownValue,
  isRecord,
  metricIdForReportKey,
  normaliseTable,
} from '@/features/build/model'
import type { DerivedTable, MetricId, ReportRegistryEntry } from '@/features/build/model'

/* -- Fields -------------------------------------------------------------------------------- */

/** `scalar` renders inline, `text` as a preformatted block, `json` as a preserved snapshot. */
export type GenericFieldKind = 'scalar' | 'text' | 'json'

export interface GenericField {
  /** Unique within a section, and the display path: `current.QFO_DATA_DIR`. */
  path: string
  /** The report's own leaf key. */
  key: string
  value: unknown
  kind: GenericFieldKind
  formatted: string
  /** Set when the key resolves to a registered metric, which then supplies the label. */
  metricId: MetricId | null
  /** A SHOUTY_CASE key names a configuration-style variable, so it can carry a config anchor. */
  namedVariable: boolean
  /** An unregistered key using one of the report's ambiguous terms - `seqs`, `sequences`. */
  ambiguousTerm: boolean
}

const METRIC_ID_SET = new Set<string>(METRIC_IDS)

/** The model exports the guard rather than the coercion, so this is the local narrowing. */
function recordOf(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null
}

const NAMED_VARIABLE = /^[A-Z][A-Z0-9_]+$/
const AMBIGUOUS_TERM = /(?:^|_)(?:seq|seqs|sequence|sequences)(?:_|$)/

function camelCase(key: string): string {
  return key.toLowerCase().replace(/[_-]+([a-z0-9])/g, (_match, char: string) => char.toUpperCase())
}

/**
 * `sectionId.key` -> the definition that declares it, built from the registry's own `source` paths.
 *
 * This is the route that lets a fallback render `library.sequences` as "Sequences in the built
 * library" without anybody teaching it what the library section is: the definitions registry
 * already records where each figure comes from, so the join is data-driven. A path matches when its
 * first segment is the section id and its last segment is the key, which covers `library.sequences`
 * and `giga.headline.books_total` alike.
 *
 * Where two definitions claim one `sectionId.key` - `mapping.rows[stage=id].total_seqs` and
 * `mapping.rows[stage=post_giga].total_seqs` both end in `total_seqs` - the composite is marked
 * AMBIGUOUS and resolves to nothing. Guessing between two definitions of "sequences" would be
 * exactly the failure the registry exists to prevent.
 */
const AMBIGUOUS = Symbol('ambiguous')

const METRIC_BY_SOURCE_PATH = ((): Map<string, MetricId | typeof AMBIGUOUS> => {
  const map = new Map<string, MetricId | typeof AMBIGUOUS>()
  for (const definition of Object.values(METRIC_DEFINITIONS)) {
    for (const path of definition.source.split(' / ')) {
      const segments = path.trim().split('.')
      if (segments.length < 2) continue
      const composite = `${segments[0]}.${segments[segments.length - 1]}`
      const existing = map.get(composite)
      if (existing === undefined) map.set(composite, definition.id)
      else if (existing !== definition.id) map.set(composite, AMBIGUOUS)
    }
  }
  return map
})()

/**
 * The registry id a report key names, or `null`. Three routes, strongest first: the model's own
 * mapping for `other_reports` keys, the registry's declared source path for this section, then the
 * snake-to-camel form of the key. A bare `sequences` with no section context deliberately resolves
 * to nothing - there is no such metric in this report, only six specific ones.
 */
export function resolveMetricId(key: string, sectionId?: string): MetricId | null {
  const mapped = metricIdForReportKey(key)
  if (mapped !== null) return mapped
  if (sectionId !== undefined) {
    const bySource = METRIC_BY_SOURCE_PATH.get(`${sectionId}.${key}`)
    if (bySource !== undefined && bySource !== AMBIGUOUS) return bySource
  }
  const camel = camelCase(key)
  return METRIC_ID_SET.has(camel) ? (camel as MetricId) : null
}

/** True for a SHOUTY_CASE key. Structural, not semantic: it is what a variable name looks like. */
export function isNamedVariableKey(key: string): boolean {
  return NAMED_VARIABLE.test(key)
}

/** True for an array carrying no nested objects, which formats acceptably on one line. */
function isFlatArray(value: unknown): boolean {
  return Array.isArray(value) && value.every(entry => entry === null || typeof entry !== 'object')
}

export function describeField(
  path: string,
  key: string,
  value: unknown,
  sectionId?: string
): GenericField {
  const metricId = resolveMetricId(key, sectionId)
  const multilineText = typeof value === 'string' && value.includes('\n')
  const structured =
    !multilineText && typeof value === 'object' && value !== null && !isFlatArray(value)

  return {
    path,
    key,
    value,
    kind: multilineText ? 'text' : structured ? 'json' : 'scalar',
    // A byte-valued metric reads as a file size. `value` stays the raw number, so anything
    // computing on it is unaffected -- only the display string changes. This is the one place
    // headline fields and the `rows` metric list are both formatted.
    formatted:
      isFileSizeKey(key) && typeof value === 'number' && Number.isFinite(value)
        ? formatFileSize(value)
        : formatUnknownValue(value),
    metricId,
    namedVariable: isNamedVariableKey(key),
    ambiguousTerm: metricId === null && AMBIGUOUS_TERM.test(key.toLowerCase()),
  }
}

/* -- Tables -------------------------------------------------------------------------------- */

/**
 * A table reduced to what a fallback can render. Truncation travels with it, because a subset must
 * never be sortable, and `raggedRows` is a COUNT (813 on one table in this fixture), not a flag.
 */
export interface GenericTableView {
  key: string
  name: string
  columns: string[]
  rows: Record<string, unknown>[]
  includedRows: number
  totalRows: number | null
  raggedRows: number | null
}

function fromDerivedTable(table: DerivedTable<Record<string, unknown>>): GenericTableView {
  return {
    key: table.key,
    name: table.name,
    columns: table.columns,
    rows: table.rows,
    includedRows: table.truncation.includedRows,
    totalRows: table.truncation.totalRows,
    raggedRows: table.truncation.raggedRows,
  }
}

/* -- The whole reading --------------------------------------------------------------------- */

/** `data` keys the structural pass consumes. Everything else is preserved and shown. */
export const CONSUMED_DATA_KEYS: readonly string[] = [
  'headline',
  'rows',
  'tables',
  'text',
  'warnings',
]

export interface GenericSectionReading {
  headline: GenericField[]
  rows: GenericField[]
  tables: GenericTableView[]
  text: string | null
  /** Multi-line text is a captured snapshot rather than prose, and reads as a block. */
  textIsBlock: boolean
  warnings: string[]
  /** Every `data` key the pass above did not consume, with one level of nesting flattened. */
  preserved: GenericField[]
  /** A `data` that is an array, read as an unnamed table rather than discarded. */
  payloadTable: GenericTableView | null
  /** A `data` that is a scalar, kept verbatim. */
  payloadScalar: GenericField | null
  /** True when the section carried nothing this view could decompose. */
  isEmpty: boolean
}

function preservedFields(entry: ReportRegistryEntry): GenericField[] {
  const data = recordOf(recordOf(entry.raw)?.data)
  if (data === null) return []

  const fields: GenericField[] = []
  for (const key of Object.keys(data)) {
    if (CONSUMED_DATA_KEYS.includes(key)) continue
    const value = data[key]
    const nested = recordOf(value)
    const childKeys = nested === null ? [] : Object.keys(nested)
    if (nested === null || childKeys.length === 0) {
      fields.push(describeField(key, key, value, entry.sectionId))
      continue
    }
    for (const childKey of childKeys) {
      fields.push(describeField(`${key}.${childKey}`, childKey, nested[childKey], entry.sectionId))
    }
  }
  return fields
}

function fromPayloadArray(rows: unknown[], key: string): GenericTableView {
  const table = normaliseTable({ rows }, 'data')
  return {
    key,
    name: table.name,
    columns: table.columns,
    rows: table.records,
    includedRows: table.records.length,
    totalRows: table.records.length,
    raggedRows: null,
  }
}

export function readGenericSection(entry: ReportRegistryEntry): GenericSectionReading {
  const view = entry.generic
  const headline = view.headline.map(item =>
    describeField(item.key, item.key, item.value, entry.sectionId)
  )

  // The report restates several headline values in `rows`; rendering both reads as two findings
  // rather than one fact said twice.
  const headlineIndex = new Set(headline.map(field => `${field.key}=${field.formatted}`))
  const rows = view.rows
    .map(item => describeField(item.key, item.key, item.value, entry.sectionId))
    .filter(field => !headlineIndex.has(`${field.key}=${field.formatted}`))

  const rawData = recordOf(entry.raw)?.data
  const payloadTable = Array.isArray(rawData)
    ? fromPayloadArray(rawData, `${entry.sectionId}_payload`)
    : null
  const payloadScalar =
    rawData !== undefined && rawData !== null && typeof rawData !== 'object'
      ? describeField('data', 'data', rawData, entry.sectionId)
      : null

  const preserved = preservedFields(entry)
  const tables = view.tables.map(fromDerivedTable)
  const text = view.text

  return {
    headline,
    rows,
    tables,
    text,
    textIsBlock: text !== null && text.includes('\n'),
    warnings: view.warnings,
    preserved,
    payloadTable,
    payloadScalar,
    isEmpty:
      headline.length === 0 &&
      rows.length === 0 &&
      tables.length === 0 &&
      preserved.length === 0 &&
      text === null &&
      view.warnings.length === 0 &&
      payloadTable === null &&
      payloadScalar === null,
  }
}

/**
 * Anchor ids for the named variables a section renders, keyed by field path.
 *
 * The configuration ledger reaches the screen through this renderer, so this is where a deep link
 * to a configuration value has to resolve. A key appearing in both the resolved block and the
 * ledger rows is anchored once - two elements sharing a DOM id would make the link ambiguous.
 */
export function variableAnchorIds(reading: GenericSectionReading): Record<string, string> {
  const ids: Record<string, string> = {}
  const used = new Set<string>()
  for (const field of [...reading.rows, ...reading.preserved]) {
    if (!field.namedVariable) continue
    const id = configElementId(field.key)
    if (used.has(id)) continue
    used.add(id)
    ids[field.path] = id
  }
  return ids
}
