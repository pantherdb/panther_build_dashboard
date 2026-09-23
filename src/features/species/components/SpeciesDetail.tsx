import { Button } from '@mantine/core'
import { useMemo } from 'react'
import type { ReactNode } from 'react'
import {
  DeltaValue,
  EmptyState,
  KeyValueList,
  Panel,
  PanelGrid,
  Provenance,
  SectionHeading,
  StatusChip,
} from '@/@panther.core/components'
import type { KeyValueItem } from '@/@panther.core/components'
import { formatCount, plural } from '@/app/format'
import { speciesElementId } from '@/features/build/model'
import { useBuildReport, useSelectSpecies, useSpeciesRecord } from '@/features/build/hooks'
import { formatPercent } from '@/features/species/model/format'
import {
  COUNT_CONCEPT_NOTE,
  VERDICT_STATUS,
  readSpecies,
  readingContext,
} from '@/features/species/model/interpretation'
import type { SourceScope } from '@/features/species/model/interpretation'
import { buildLinkModel } from '@/features/species/model/links'
import { SpeciesLinks } from '@/features/species/components/SpeciesLinks'

/**
 * One species, every source that mentions it, and what the combination means.
 *
 * This panel is the prototype's central argument: that a build report is worth more read as one
 * model than as eight tables. `DAPMA` at 0 % node forward tracking is the case it has to win. In
 * isolation that is the worst species in the build; joined with a previous count of 0 and a UniProt
 * table reporting no previous match for any of its 26,600 sequences, it is a species that did not
 * exist in the previous library and therefore has nothing to track forward. The panel says so in
 * words, and marks the sentence as the dashboard's reading rather than the generator's.
 *
 * Its credibility rests on the cases it does NOT explain. `FELCA` tracked 65 % forward while
 * carrying an established previous proteome, and the panel says that nothing in the report accounts
 * for it. A species absent from the truncated comparison table gets "unknown", never "zero" and
 * never "new".
 *
 * Every fact is attributed to the section and table it came from, because a reader who cannot see
 * where a number came from cannot check it, and this panel is meant to survive into a permanent
 * build record.
 */
export interface SpeciesDetailProps {
  oscode: string
  onClose?: () => void
}

const scopeLine = (scope: SourceScope, tableName: string | null): string =>
  [
    scope.sectionId,
    tableName === null ? null : `“${tableName}”`,
    scope.truncated ? scope.label : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ')

const SourceBlock = ({
  title,
  provenanceLine,
  present,
  absentNote,
  items,
  note,
}: {
  title: string
  provenanceLine: string
  present: boolean
  absentNote: string
  items: readonly KeyValueItem[]
  note?: ReactNode
}) => (
  <div className="space-y-1">
    <SectionHeading level={4} description={<span className="pb-ident">{provenanceLine}</span>}>
      {title}
    </SectionHeading>
    {present ? (
      <KeyValueList items={items} labelWidth={20} />
    ) : (
      <p className="text-ink-faint text-2xs max-w-prose">{absentNote}</p>
    )}
    {note && <p className="text-ink-faint text-2xs max-w-prose">{note}</p>}
  </div>
)

export const SpeciesDetail = ({ oscode, onClose }: SpeciesDetailProps) => {
  const report = useBuildReport()
  const record = useSpeciesRecord(oscode)
  const selectSpecies = useSelectSpecies()
  const context = useMemo(() => readingContext(report), [report])
  const links = useMemo(() => buildLinkModel(report), [report])

  const closeAction =
    onClose === undefined ? undefined : (
      <Button variant="default" size="compact-xs" onClick={onClose}>
        Close
      </Button>
    )

  if (record === null) {
    return (
      <Panel
        title="Species cross-section"
        subtitle={oscode}
        actions={closeAction}
        anchorId={speciesElementId(oscode)}
      >
        <EmptyState
          title={`No source in this report mentions ${oscode}`}
          description={
            `Node forward tracking, “${context.counts.tableName}” (${context.counts.label}) and ` +
            `“${context.uniprot.tableName}” (${context.uniprot.label}) were all searched. Two of ` +
            'them are truncated, so this means the report does not carry the species - not that ' +
            'the build does not contain it.'
          }
        />
      </Panel>
    )
  }

  const reading = readSpecies(record, context)
  const tracking = record.nodeTracking.value
  const counts = record.counts.value
  const uniprot = record.uniprot.value
  const trackingPct = tracking === null ? null : (tracking.pct ?? tracking.recomputedPct ?? null)
  const notTracked =
    tracking !== null && typeof tracking.total === 'number' && typeof tracking.mapped === 'number'
      ? Math.max(0, tracking.total - tracking.mapped)
      : null

  return (
    <Panel
      title="Species cross-section"
      subtitle={oscode}
      actions={closeAction}
      anchorId={speciesElementId(oscode)}
      tone={reading.verdict === 'unexplained' ? 'attention' : 'default'}
      status={
        <StatusChip
          status={VERDICT_STATUS[reading.verdict]}
          label={reading.verdictLabel}
          size="md"
          hint={reading.headline}
        />
      }
    >
      <div className="space-y-2.5">
        {/* The reading. Marked derived: these sentences are this dashboard's, not the report's. */}
        <div className="space-y-1" data-pb-species-reading="">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <Provenance source="derived" detail="joined from the sections listed below" />
            {reading.scopedByTruncation && (
              <span className="text-status-warn text-2xs">
                rests on a table the report only partly includes
              </span>
            )}
          </div>
          <p className="text-ink max-w-prose text-xs">{reading.headline}</p>
          {reading.caveat !== null && (
            <p className="text-ink-muted text-2xs max-w-prose">{reading.caveat}</p>
          )}
        </div>

        {reading.evidence.length > 0 && (
          <div className="space-y-1">
            <SectionHeading level={4} count={`${reading.evidence.length} sources`}>
              Evidence, by source
            </SectionHeading>
            <ul className="list-none space-y-1 p-0">
              {reading.evidence.map(line => (
                <li key={`${line.sectionId}:${line.tableName ?? ''}:${line.text}`}>
                  <p className="text-ink text-2xs">{line.text}</p>
                  <p className="pb-ident text-ink-faint text-3xs">
                    {line.sectionId}
                    {line.tableName === null ? '' : ` · ${line.tableName}`}
                    {line.truncated ? ' · partly included' : ''}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}

        <PanelGrid minColumnWidth={250} gap="tight">
          <SourceBlock
            title="Node forward tracking"
            provenanceLine={`${record.nodeTracking.origin.sectionId} · ${
              record.nodeTracking.origin.tableName ?? 'by_species'
            }`}
            present={record.nodeTracking.present}
            absentNote={
              context.trackingAvailable
                ? `Node forward tracking is in this report but carries no row for ${oscode}, so its forward-tracking rate is unknown rather than zero.`
                : 'This report carries no node forward tracking section, so there is no forward-tracking rate for any species.'
            }
            items={[
              {
                key: 'pct',
                label: 'Forward-tracked',
                value: formatPercent(trackingPct),
              },
              {
                key: 'mapped',
                label: 'Nodes mapped',
                value: formatCount(tracking?.mapped ?? null),
              },
              { key: 'total', label: 'Nodes total', value: formatCount(tracking?.total ?? null) },
              { key: 'unmapped', label: 'Nodes not tracked', value: formatCount(notTracked) },
            ]}
          />

          <SourceBlock
            title="Previous vs current sequences"
            provenanceLine={scopeLine(context.counts, record.counts.origin.tableName)}
            present={record.counts.present}
            absentNote={
              `${oscode} is not among the ${context.counts.label} of ` +
              `“${context.counts.tableName}” this report includes. Its previous and current ` +
              'sequence counts are therefore UNKNOWN - not zero, and not evidence that the ' +
              'species is new.'
            }
            items={[
              {
                key: 'previous',
                label: 'Previous sequences',
                value: formatCount(counts?.previousCount ?? null),
              },
              {
                key: 'current',
                label: 'Current sequences',
                value: formatCount(counts?.currentCount ?? null),
              },
              {
                key: 'diff',
                label: 'Change (sequences)',
                mono: false,
                value: <DeltaValue value={counts?.countDiff ?? null} kind="count" />,
              },
              {
                key: 'pct',
                label: 'Change (share)',
                mono: false,
                value: <DeltaValue value={counts?.percentChange ?? null} kind="percent" />,
                aside: <Provenance source="derived" variant="marker" />,
              },
            ]}
            note="The percentage is recomputed from the counts: the report stores this column as a fraction, where a full removal reads −1.0 rather than −100 %."
          />

          <SourceBlock
            title="Previous-UniProt-id agreement"
            provenanceLine={scopeLine(context.uniprot, record.uniprot.origin.tableName)}
            present={record.uniprot.present}
            absentNote={
              `${oscode} is not among the ${context.uniprot.label} of ` +
              `“${context.uniprot.tableName}” this report includes, so how many of its sequences ` +
              'kept their previous UniProt id is UNKNOWN.'
            }
            items={[
              {
                key: 'total',
                label: 'Sequences compared',
                value: formatCount(uniprot?.totalSequences ?? null),
              },
              {
                key: 'same',
                label: 'Same UniProt id',
                value: formatCount(uniprot?.sameUniprot ?? null),
              },
              {
                key: 'pct-same',
                label: 'Same, as a share',
                value: formatPercent(uniprot?.pctSameUniprot ?? null),
              },
              {
                key: 'diff',
                label: 'Different UniProt id',
                value: formatCount(uniprot?.diffUniprot ?? null),
              },
              {
                key: 'none',
                label: 'No previous match',
                value: formatCount(uniprot?.noPreviousMatch ?? null),
                attention: uniprot?.allUnmatched === true,
              },
            ]}
          />

          <SourceBlock
            title="Unplaced fragments (GIGA)"
            provenanceLine="giga_usf · Unplaced fragments by species"
            present={record.unplacedFragments !== null}
            absentNote={
              'The giga_usf section (“Unplaced fragments by species”) is not available on this ' +
              `report, so how many of ${oscode}'s sequences GIGA could not place is UNKNOWN - not ` +
              'zero. Once available, a disproportionate share here is a QC signal about the ' +
              'proteome, not the family.'
            }
            items={[
              {
                key: 'unplaced',
                label: 'Unplaced by GIGA',
                value:
                  record.unplacedFragments === null
                    ? undefined
                    : `${formatCount(record.unplacedFragments.unplaced)} across ` +
                      `${formatCount(record.unplacedFragments.families)} ` +
                      `${plural(record.unplacedFragments.families, 'family', 'families')}`,
              },
            ]}
          />
        </PanelGrid>

        {record.links.length > 0 && (
          <div className="space-y-1">
            <SectionHeading level={4}>Identity change</SectionHeading>
            <SpeciesLinks
              model={links}
              focusOscode={record.oscode}
              selectedOscode={record.oscode}
              onSelect={selectSpecies}
            />
          </div>
        )}

        <div className="space-y-0.5">
          <p className="text-ink-faint text-2xs max-w-prose">{COUNT_CONCEPT_NOTE}</p>
          {record.missingFrom.length > 0 && (
            <p className="text-ink-faint text-2xs max-w-prose">
              {`Sources with no row for ${oscode}: ${record.missingFrom.join('; ')}.`}
            </p>
          )}
        </div>
      </div>
    </Panel>
  )
}
