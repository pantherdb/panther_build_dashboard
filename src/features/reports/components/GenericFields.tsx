import clsx from 'clsx'
import { Tooltip } from '@mantine/core'
import { CodeBlock, DefinedTerm, KeyValueList, MetricValue } from '@/@panther.core/components'
import type { KeyValueItem } from '@/@panther.core/components'
import { getMetricDefinition } from '@/features/build/model'
import type { MetricId } from '@/features/build/model'
import type { GenericField } from '@/features/reports/model/genericView'

/**
 * How a fallback view labels a value it may not understand.
 *
 * The registry wins wherever the key resolves to a metric, so a generic render of the library
 * section says "Sequences in the built library" exactly as a bespoke view would. Where it does not
 * resolve, the report's own field name is shown verbatim in mono and marked as such. Humanising
 * `sequences` into the label "Sequences" would be the worse option by a wide margin: this report
 * carries six different sequence counts, and a guessed label is how they get confused.
 */

const KEY_HINT =
  'The report’s own field name. No specialised view or metric definition is registered for it, ' +
  'so the fallback shows the key verbatim rather than inventing a label.'

const AMBIGUOUS_HINT =
  'This report carries six distinct sequence counts. No metric definition is registered for this ' +
  'key, so the fallback cannot say which one it is and shows the report’s own field name instead.'

export interface FieldLabelProps {
  field: GenericField
}

/** The report's own key, in mono, with a dotted underline when the term is a known ambiguity. */
export const ReportKeyLabel = ({ field }: FieldLabelProps) => (
  <Tooltip
    label={field.ambiguousTerm ? AMBIGUOUS_HINT : KEY_HINT}
    withArrow
    openDelay={200}
    multiline
    maw={300}
  >
    <span
      className={clsx(
        'pb-ident text-ink-muted text-2xs',
        field.ambiguousTerm && 'underline decoration-dotted'
      )}
      data-generic-key={field.key}
      data-ambiguous={field.ambiguousTerm ? '' : undefined}
    >
      {field.path}
    </span>
  </Tooltip>
)

export interface MetricLabelProps {
  metricId: MetricId
}

/**
 * The hover affordance `DefinedTerm`'s resolved branch uses
 * (`src/@panther.core/components/DefinedTerm.tsx`): a dotted underline plus a help cursor, the
 * visual signal that a label is hoverable/focusable at all. Copied verbatim rather than imported,
 * because `DefinedTerm` is a frozen core primitive with no feature-facing export for this and
 * core must not gain feature knowledge to create one. A curated row label (`MetricLabel`) and a
 * generator-defined one (`DefinedTerm`) sit in the same row list, so they must carry it
 * identically or a mouse user sees one as hoverable and the other as plain text for no reason a
 * reader could tell.
 */
const HOVER_AFFORDANCE_CLASSES =
  'decoration-ink-faint cursor-help underline decoration-dotted underline-offset-2'

export const MetricLabel = ({ metricId }: MetricLabelProps) => {
  const definition = getMetricDefinition(metricId)
  const hint =
    definition.ambiguityNote === undefined
      ? definition.definition
      : `${definition.definition} ${definition.ambiguityNote}`

  return (
    <Tooltip label={hint} withArrow openDelay={200} multiline maw={300}>
      <span
        tabIndex={0}
        className={clsx(
          'text-ink-muted text-2xs',
          HOVER_AFFORDANCE_CLASSES,
          'focus-visible:outline-accent rounded-xs focus-visible:outline-2'
        )}
      >
        {definition.label}
      </span>
    </Tooltip>
  )
}

const numericValue = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

/** One summary figure. Registered metrics go through `MetricValue` so the label is the shared one. */
export const GenericFigure = ({ field }: FieldLabelProps) => {
  // Curated first, then the generator's own vocabulary, then the honest raw key. A curated
  // definition carries ambiguity notes and metric-family grouping the generator contract does
  // not, which is why it wins outright rather than merging.
  const registryId = field.metricId ?? field.definitionId
  if (registryId !== null) {
    return (
      <MetricValue
        metricId={registryId}
        value={numericValue(field.value) ?? field.formatted}
        layout="stack"
      />
    )
  }

  return (
    <div className="flex flex-col gap-px" data-generic-figure={field.key}>
      <ReportKeyLabel field={field} />
      <span className="pb-figures text-ink text-sm leading-tight">{field.formatted}</span>
    </div>
  )
}

export interface GenericFigureListProps {
  fields: readonly GenericField[]
}

export const GenericFigureList = ({ fields }: GenericFigureListProps) => (
  <div className="flex flex-wrap gap-x-6 gap-y-2">
    {fields.map(field => (
      <GenericFigure key={field.path} field={field} />
    ))}
  </div>
)

export interface GenericFieldRowsProps {
  fields: readonly GenericField[]
  /** Element ids for the named variables, keyed by field path. */
  anchorIds?: Record<string, string>
  /** Highlight the row a deep link points at. */
  highlightId?: string | null
  labelWidth?: number
}

function snapshotOf(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return String(value)
  }
}

function rowValue(field: GenericField) {
  if (field.kind === 'scalar') return field.formatted
  return (
    <CodeBlock code={snapshotOf(field.value)} copy wrap maxHeight={200} showLineNumbers={false} />
  )
}

/**
 * The same ordered decision as `GenericFigure`: curated metric, then the generator's own
 * vocabulary, then the honest raw key. Kept as one function with early returns, rather than a
 * ternary chain inlined at the call site, so the precedence reads top to bottom in one place.
 *
 * The middle branch reuses `DefinedTerm` - the same primitive `GenericTable` already uses for a
 * generator-defined bucket value - rather than a bespoke label component, since
 * `field.definitionId` is exactly the "vocabulary the generator defined" case that component
 * exists for. `MetricLabel` cannot serve it: it is typed to the curated `MetricId` union and reads
 * the curated model map, not the context registry a generator id resolves against.
 */
function fieldLabel(field: GenericField) {
  if (field.metricId !== null) return <MetricLabel metricId={field.metricId} />
  if (field.definitionId !== null) {
    return (
      <DefinedTerm
        definitionId={field.definitionId}
        fallback={field.path}
        className="text-ink-muted text-2xs"
      />
    )
  }
  return <ReportKeyLabel field={field} />
}

/**
 * Label/value rows. A value that is multi-line text or a nested structure is shown as a snapshot
 * block instead of being flattened onto one line, because a truncated path or a collapsed object
 * is exactly the kind of quiet data loss this view exists to avoid.
 */
export const GenericFieldRows = ({
  fields,
  anchorIds,
  highlightId,
  labelWidth = 26,
}: GenericFieldRowsProps) => {
  const items: KeyValueItem[] = fields.map(field => ({
    key: field.path,
    label: fieldLabel(field),
    value: rowValue(field),
    mono: field.kind === 'scalar',
    anchorId: anchorIds?.[field.path],
  }))

  return <KeyValueList items={items} labelWidth={labelWidth} highlightId={highlightId} />
}
