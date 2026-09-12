import clsx from 'clsx'
import { Tooltip } from '@mantine/core'
import type { ReactNode } from 'react'
import { Provenance } from '@/@panther.core/components/Provenance'
import type { MetricDefinition } from '@/@panther.core/components/metricDefinitions'
import { useMetricDefinition } from '@/@panther.core/components/metricDefinitions'
import { ABSENT_MARK } from '@/@panther.core/vocabulary'
import type { ProvenanceSource } from '@/@panther.core/vocabulary'

/**
 * A labelled figure, with its label and explanation taken from the metric
 * definitions registry rather than from the call site.
 *
 * This is the primitive that makes acceptance question 5 answerable: the fixture
 * carries six different sequence counts, and any screen that shows one of them
 * labelled "Sequences" is wrong. Because the label comes from the registry, one
 * fix reaches every summary, chart, table and export at once.
 *
 * A metric with no registry entry renders its id in mono next to an explicit
 * "no definition registered" note. That is deliberately ugly: a bare number
 * with a guessed label is the defect, and a missing definition should be
 * impossible to ship past.
 *
 * `value == null` renders the absent mark with a reason. Never a zero where a
 * measurement is absent.
 *
 * The label carries a focus stop when it resolves to a definition, so the explanation is reachable
 * by keyboard and on touch. Without it the tooltip is mouse-only, which made every definition in
 * this app unreachable for anyone not using a pointer.
 */
export interface MetricValueProps {
  /** Registry key. */
  metricId: string
  value: number | string | null | undefined
  /** Bypasses the registry. For a one-off derived figure that has no entry yet. */
  definition?: MetricDefinition
  /** Formats a numeric value. Defaults to a grouped integer. */
  format?: (value: number) => string
  /** Overrides the registry unit. */
  unit?: string
  /** Why the value is missing. Shown beside the absent mark. */
  absentReason?: string
  /** Generator-emitted or dashboard-derived. */
  provenance?: ProvenanceSource
  /** `stack` puts the label above the figure; `row` keeps them on one line. */
  layout?: 'row' | 'stack'
  /** Raises the accent: this figure is the changed or anomalous one. */
  emphasis?: 'normal' | 'accent'
  /** A DeltaValue, a StatusChip or a Sparkline shown after the figure. */
  aside?: ReactNode
  anchorId?: string
  className?: string
}

const defaultFormat = (value: number): string =>
  Number.isInteger(value)
    ? value.toLocaleString()
    : value.toLocaleString(undefined, {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      })

export const MetricValue = ({
  metricId,
  value,
  definition,
  format = defaultFormat,
  unit,
  absentReason,
  provenance,
  layout = 'row',
  emphasis = 'normal',
  aside,
  anchorId,
  className,
}: MetricValueProps) => {
  const registered = useMetricDefinition(metricId)
  const resolved = definition ?? registered
  const missing = value === null || value === undefined

  const label = resolved?.label ?? metricId
  const suffix = unit ?? resolved?.unit
  const text = missing
    ? ABSENT_MARK
    : typeof value === 'number'
      ? Number.isFinite(value)
        ? format(value)
        : ABSENT_MARK
      : value

  const labelNode = (
    <span
      tabIndex={resolved ? 0 : undefined}
      className={clsx(
        'text-2xs',
        resolved ? 'text-ink-muted' : 'text-status-warn pb-ident',
        !resolved && 'underline decoration-dotted',
        resolved && 'focus-visible:outline-accent rounded-xs focus-visible:outline-2'
      )}
    >
      {label}
      {!resolved && ' (no definition registered)'}
    </span>
  )

  return (
    <div
      id={anchorId}
      data-pb-anchor={anchorId ? '' : undefined}
      data-metric={metricId}
      className={clsx(
        layout === 'stack'
          ? 'flex flex-col gap-px'
          : 'flex flex-wrap items-baseline gap-x-1.5 gap-y-px',
        className
      )}
    >
      {resolved ? (
        <Tooltip label={resolved.description} withArrow openDelay={200} multiline maw={300}>
          {labelNode}
        </Tooltip>
      ) : (
        labelNode
      )}

      <span className="flex flex-wrap items-baseline gap-x-1.5">
        <span
          className={clsx(
            'pb-figures text-sm leading-tight',
            missing ? 'text-ink-faint' : emphasis === 'accent' ? 'text-accent' : 'text-ink'
          )}
        >
          {text}
          {!missing && suffix && (
            <span className="text-ink-muted text-2xs ml-0.5 font-normal">{suffix}</span>
          )}
        </span>
        {missing && absentReason && <span className="text-ink-faint text-2xs">{absentReason}</span>}
        {aside}
        {provenance && <Provenance source={provenance} variant="marker" />}
      </span>
    </div>
  )
}
