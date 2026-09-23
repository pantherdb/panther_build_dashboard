import { useMemo } from 'react'
import {
  CodeBlock,
  Disclosure,
  EmptyState,
  LongMessage,
  Panel,
  Provenance,
  SectionHeading,
  StatusChip,
  UnknownValue,
} from '@/@panther.core/components'
import { plural } from '@/app/format'
import type { ReportRegistryEntry } from '@/features/build/model'
import { GenericFieldRows, GenericFigureList } from '@/features/reports/components/GenericFields'
import { GenericTable } from '@/features/reports/components/GenericTable'
import { readGenericSection, variableAnchorIds } from '@/features/reports/model/genericView'

/**
 * The fallback view for a report section nobody has written a view for.
 *
 * This is the extensibility claim made good. It renders a section from its structural elements
 * alone - headline values, rows, tables, text, warnings, status - and it holds itself to the same
 * rules as a bespoke view rather than to a lower standard:
 *
 *   the metric definitions registry supplies the label wherever a key resolves to one, and an
 *   unresolved key is shown verbatim in mono rather than humanised into a guessed label;
 *
 *   a truncated table shows how much of the result set is present and refuses client sorting;
 *
 *   an unrecognised `status` renders as `Unknown status: <value>` with the literal preserved,
 *   never coerced into a known state;
 *
 *   the generator's values and this view's own reading of them carry different provenance marks,
 *   because a permanent record must not make a dashboard inference look generator-authored;
 *
 *   and every `data` key the structural pass did not consume is still shown, so a future field
 *   is never silently dropped.
 *
 * It also tolerates a `data` that is null, an array or a scalar. An array becomes a table, a
 * scalar is shown verbatim, and a section carrying nothing says so instead of rendering an empty
 * frame that reads as a zero.
 */
export interface GenericReportProps {
  report: ReportRegistryEntry
  /**
   * Off for a second, non-canonical rendering of the same section - the reports index shows the
   * fallback reading alongside the primary mount, and two elements must not claim one DOM id.
   */
  anchors?: boolean
  /** Highlight the anchored row a deep link points at. */
  highlightId?: string | null
}

const FALLBACK_NOTE =
  'Read from the section’s structure alone — headline values, rows, tables, text, warnings and ' +
  'status. Nothing here interprets what the section means.'

export const GenericReport = ({ report, anchors = true, highlightId }: GenericReportProps) => {
  const reading = useMemo(() => readGenericSection(report), [report])
  const anchorIds = useMemo(() => (anchors ? variableAnchorIds(reading) : {}), [anchors, reading])

  // A payload the model could not read as an object is NOT an absent section: the generator emitted
  // something, and the model reports `absent` only because a section is expected to be a record.
  // Leaving the panel's availability at `absent` would replace the very content this view exists to
  // salvage, so the shape is stated in a line of its own instead.
  const payloadShape =
    reading.payloadTable !== null ? 'an array' : reading.payloadScalar !== null ? 'a scalar' : null
  const availability = payloadShape === null ? report.availability : 'available'

  const status = report.status.isUnknown ? (
    <UnknownValue
      value={report.status.raw ?? '(not reported)'}
      kind="status"
      source={`sections[${report.index}].status`}
    />
  ) : (
    <StatusChip status={report.status.kind} label={report.status.label} />
  )

  return (
    <Panel
      title={report.title ?? report.sectionId}
      subtitle={report.sectionId}
      availability={availability}
      message={report.message ?? undefined}
      missingSubject={report.title ?? report.sectionId}
      provenance="generator"
      status={status}
      footer={
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <Provenance source="derived" detail="generic fallback" />
          <span>{FALLBACK_NOTE}</span>
          {report.unknownFields.length > 0 && (
            <span>
              Section keys outside the envelope, kept as written:{' '}
              <span className="pb-ident">{report.unknownFields.join(', ')}</span>.
            </span>
          )}
        </span>
      }
    >
      <div className="space-y-3">
        {payloadShape !== null && (
          <p className="text-ink-muted max-w-prose text-xs">
            {`The generator emitted this section’s payload as ${payloadShape}, not an object, so the ` +
              'model could not read it as a section. It is shown below as written rather than dropped.'}
          </p>
        )}

        {reading.isEmpty ? (
          <EmptyState
            compact
            title="No structural content in this section"
            description="The section is present in the report and carries no headline, rows, tables or text. Nothing below is inferred from that."
          />
        ) : null}

        {reading.text !== null &&
          (reading.textIsBlock ? (
            <CodeBlock code={reading.text} filename={`${report.sectionId}.text`} wrap />
          ) : (
            <p className="text-ink-muted max-w-prose text-xs">{reading.text}</p>
          ))}

        {reading.headline.length > 0 && <GenericFigureList fields={reading.headline} />}

        {reading.payloadScalar !== null && (
          <GenericFieldRows fields={[reading.payloadScalar]} labelWidth={10} />
        )}

        {reading.rows.length > 0 && (
          <GenericFieldRows fields={reading.rows} anchorIds={anchorIds} highlightId={highlightId} />
        )}

        {reading.payloadTable !== null && <GenericTable table={reading.payloadTable} />}

        {reading.tables.map(table => (
          <GenericTable key={table.key} table={table} />
        ))}

        {reading.warnings.length > 0 && (
          <div className="space-y-1">
            <SectionHeading
              level={4}
              count={`${reading.warnings.length} ${plural(reading.warnings.length, 'warning')}`}
            >
              Reported by the generator
            </SectionHeading>
            <ul className="list-none space-y-1 p-0">
              {reading.warnings.map(message => (
                <li key={message} className="flex flex-wrap items-baseline gap-x-2">
                  <StatusChip status="warn" />
                  <LongMessage message={message} className="text-ink text-xs" />
                  <Provenance source="generator" variant="marker" detail={report.sectionId} />
                </li>
              ))}
            </ul>
          </div>
        )}

        {reading.preserved.length > 0 && (
          <Disclosure
            summary={
              <span className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-ink">Fields this view did not interpret</span>
                <span className="text-ink-faint text-2xs">
                  kept as written so nothing is discarded
                </span>
              </span>
            }
            count={`${reading.preserved.length} ${plural(reading.preserved.length, 'field')}`}
          >
            <GenericFieldRows
              fields={reading.preserved}
              anchorIds={anchorIds}
              highlightId={highlightId}
            />
          </Disclosure>
        )}
      </div>
    </Panel>
  )
}

export default GenericReport
