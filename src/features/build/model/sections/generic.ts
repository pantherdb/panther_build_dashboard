/**
 * The generic section renderer's data model, and the report registry entry every section gets.
 *
 * This is what makes an unfamiliar future report usable before anyone writes a specialised view:
 * a section is reduced to headline values, rows, tables, text, warnings, status and an optional
 * `definitions` map of generator-supplied vocabulary, with anything left over kept on `extra` so
 * nothing is silently discarded. Unknown sections still get a registry entry and hang from the
 * Unattached reports node.
 */

import { reportAnchor } from '../anchors'
import { resolveBinding } from '../binding'
import {
  asArray,
  asNonEmptyString,
  asRecord,
  asString,
  asStringArray,
  isRecord,
} from '../primitives'
import { makeMeta } from '../notes'
import { availabilityFor } from '../status'
import { formatUnknownValue, makeDerivedTable, normaliseTable } from '../tables'
import type { NoteSink } from '../notes'
import type {
  DerivedTable,
  GeneratorDefinition,
  GenericHeadlineValue,
  GenericSectionView,
  ReportRegistryEntry,
} from '../types'
import { SECTION_ENVELOPE_KEYS } from './input'
import type { SectionInput } from './input'

const GENERIC_DATA_KEYS: readonly string[] = [
  'headline',
  'rows',
  'tables',
  'text',
  'warnings',
  'current',
  'record_count',
  'definitions',
]

/** `prev_uniprot_pct_same` reads as `Prev uniprot pct same`, which is enough for a fallback view. */
export function humaniseKey(key: string): string {
  const spaced = key.replace(/[_-]+/g, ' ').trim()
  if (spaced === '') return key
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

export function buildGenericView(section: SectionInput, sink: NoteSink): GenericSectionView {
  const data = section.dataRecord
  const scope = `section:${section.sectionId}`

  const headlineRecord = asRecord(data?.headline)
  const headline: GenericHeadlineValue[] = Object.keys(headlineRecord ?? {}).map(key => ({
    key,
    label: humaniseKey(key),
    value: headlineRecord?.[key],
    formatted: formatUnknownValue(headlineRecord?.[key]),
  }))

  const rows = asArray(data?.rows).map((entry, index) => {
    const record = asRecord(entry)
    if (record === null) {
      return { key: `row_${index + 1}`, value: entry, formatted: formatUnknownValue(entry) }
    }
    const key =
      asNonEmptyString(record.metric) ?? asNonEmptyString(record.key) ?? `row_${index + 1}`
    const value = 'value' in record ? record.value : record
    return { key, value, formatted: formatUnknownValue(value) }
  })

  const tables: DerivedTable<Record<string, unknown>>[] = asArray(data?.tables).map(
    (raw, index) => {
      const table = normaliseTable(raw, `table_${index + 1}`)
      return makeDerivedTable(
        `${section.sectionId}_table_${index + 1}`,
        table,
        table.records,
        makeMeta({
          availability: availabilityFor(section.status, true),
          sectionId: section.sectionId,
          message: section.message,
          status: section.status,
        })
      )
    }
  )

  // A malformed entry is dropped, never thrown: the vocabulary is an aid to reading the numbers,
  // and a bad definition must not cost a reader the numbers themselves.
  const definitionsRecord = asRecord(data?.definitions)
  const definitions: GeneratorDefinition[] = []
  for (const term of Object.keys(definitionsRecord ?? {})) {
    const entry = asRecord(definitionsRecord?.[term])
    const label = asNonEmptyString(entry?.label)
    const definition = asNonEmptyString(entry?.definition)
    if (label === null || definition === null) {
      sink.add(
        'warning',
        scope,
        `Definition \`${term}\` is missing a label or a definition; ignored.`
      )
      continue
    }
    definitions.push({ term, label, definition })
  }

  const extra: Record<string, unknown> = {}
  for (const key of Object.keys(data ?? {})) {
    if (!GENERIC_DATA_KEYS.includes(key)) extra[key] = data?.[key]
  }
  // A non-object payload cannot be decomposed, so it is preserved whole.
  if (data === null && section.data !== undefined && section.data !== null) {
    extra.data = section.data
    sink.add(
      'info',
      scope,
      'Section payload is not an object; it is preserved verbatim for the generic renderer.'
    )
  }

  return {
    headline,
    rows,
    tables,
    text: asString(data?.text),
    warnings: asStringArray(data?.warnings),
    definitions,
    extra,
  }
}

export function buildRegistryEntry(
  section: SectionInput,
  known: boolean,
  knownPhaseIds: readonly string[],
  sink: NoteSink
): ReportRegistryEntry {
  const binding = resolveBinding(section.sectionId, section.raw, knownPhaseIds)
  if (!binding.known && binding.phaseHint === null) {
    sink.add(
      'info',
      `section:${section.sectionId}`,
      'Section has no phase binding; it is listed under Unattached reports.'
    )
  }
  if (section.status.isUnknown && section.status.raw !== null) {
    sink.add(
      'info',
      `section:${section.sectionId}`,
      `Section status "${section.status.raw}" is preserved verbatim rather than coerced.`
    )
  }

  return {
    sectionId: section.sectionId,
    index: section.index,
    title: section.title,
    status: section.status,
    message: section.message,
    availability: availabilityFor(section.status, section.dataRecord !== null),
    known,
    placement: binding.placement,
    phaseIds: binding.phaseIds,
    primaryPhaseId: binding.primaryPhaseId,
    phaseHint: binding.phaseHint,
    anchor: reportAnchor(section.sectionId),
    generic: buildGenericView(section, sink),
    unknownFields: Object.keys(section.raw ?? {}).filter(
      key => !SECTION_ENVELOPE_KEYS.includes(key)
    ),
    raw: section.raw,
  }
}

/** True when a value looks like something the generic renderer can decompose at all. */
export function isRenderableSection(section: SectionInput): boolean {
  return isRecord(section.raw)
}
