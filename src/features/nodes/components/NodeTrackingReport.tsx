import { useMemo, useState } from 'react'
import {
  Disclosure,
  LongMessage,
  MetricValue,
  Panel,
  Provenance,
  SectionHeading,
  StatusChip,
} from '@/@panther.core/components'
import { formatCount, plural } from '@/app/format'
import { useBuildReport, useSelectSpecies, useSelectedOscode } from '@/features/build/hooks'
import { NodeTypeBreakdown } from '@/features/nodes/components/NodeTypeBreakdown'
import {
  buildNodeTypes,
  speciesCoverageFact,
  trackingHeadlineSentence,
} from '@/features/nodes/model'
import { buildDistribution } from '@/features/species/model/distribution'
import { formatPercentTerse } from '@/features/species/model/format'
import { readSpecies, readingContext } from '@/features/species/model/interpretation'
import { buildLinkModel } from '@/features/species/model/links'
import { LowTailReadings } from '@/features/species/components/LowTailReadings'
import type { LowTailRow } from '@/features/species/components/LowTailReadings'
import {
  SpeciesDistribution,
  distributionSummaryLine,
} from '@/features/species/components/SpeciesDistribution'
import { SpeciesLinks } from '@/features/species/components/SpeciesLinks'
import { SpeciesTable } from '@/features/species/components/SpeciesTable'

/**
 * Node forward tracking, distribution first.
 *
 * The default reading of this section is the shape of the distribution and the handful of species
 * at the bottom of it, not a sortable table of 131 rows - the table is behind a toggle because it
 * is supporting evidence, and because reading it is the work this view exists to remove.
 *
 * The panel opens with two derived sentences rather than a figure, because two legitimate
 * percentages sit in this section and a reader has to be told which is which: the 93.5 % headline
 * spans all five node types, while the per-species rows sum to exactly the LEAF total and are
 * therefore a LEAF distribution. Left unsaid, that looks like a contradiction.
 *
 * The species identity changes hang here too. A rename is what stops a 6,788-sequence drop reading
 * as a biological loss, and the species it concerns are the same ones the distribution is about.
 */
const NodeTrackingReport = () => {
  const report = useBuildReport()
  const selectedOscode = useSelectedOscode()
  const selectSpecies = useSelectSpecies()
  const [tableOpen, setTableOpen] = useState(false)

  const tracking = report.nodeTracking
  const distribution = useMemo(() => buildDistribution(tracking), [tracking])
  const nodeTypes = useMemo(() => buildNodeTypes(tracking), [tracking])
  const context = useMemo(() => readingContext(report), [report])
  const links = useMemo(() => buildLinkModel(report), [report])

  const byOscode = report.species.byOscode
  const headline = useMemo(
    () => trackingHeadlineSentence(tracking, distribution),
    [tracking, distribution]
  )
  const coverage = useMemo(
    () => speciesCoverageFact(tracking, distribution),
    [tracking, distribution]
  )

  const lowRows = useMemo<LowTailRow[]>(
    () =>
      distribution.lowByMagnitude.map(point => {
        const record = byOscode[point.oscode] ?? null
        return { point, reading: record === null ? null : readSpecies(record, context) }
      }),
    [distribution.lowByMagnitude, byOscode, context]
  )

  /* Species the comparison tables mention that node forward tracking does not, for the footnote:
     they have no row in the table below, and the reader should not read that as zero. */
  const onlyInComparison = report.species.records.filter(
    record => !record.nodeTracking.present
  ).length

  return (
    <div className="space-y-gutter">
      <Panel
        title="Node forward tracking"
        subtitle="node_tracking"
        availability={tracking.availability}
        message={tracking.message ?? undefined}
        missingSubject="Node forward tracking"
        status={
          <span className="pb-figures text-ink-muted text-2xs">
            {distributionSummaryLine(distribution)}
          </span>
        }
      >
        <div className="space-y-2.5">
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            <MetricValue
              metricId="pctNodesMapped"
              value={tracking.pctMapped ?? tracking.recomputedPctMapped}
              unit="%"
              layout="stack"
            />
            <MetricValue metricId="nodesMapped" value={tracking.nodesMapped} layout="stack" />
            <MetricValue metricId="nodesTotal" value={tracking.nodesTotal} layout="stack" />
            <MetricValue
              metricId="speciesReported"
              value={tracking.speciesReported}
              layout="stack"
            />
          </div>

          <div className="space-y-1">
            <p className="text-ink max-w-prose text-xs">{headline}</p>
            <p className="text-ink max-w-prose text-xs">
              {coverage.sentence}{' '}
              <Provenance source="derived" variant="marker" className="translate-y-px" />
            </p>
          </div>

          {tracking.warnings.length > 0 && (
            <ul className="list-none space-y-1 p-0">
              {tracking.warnings.map(warning => (
                <li key={warning} className="flex flex-wrap items-baseline gap-x-1.5">
                  <StatusChip status="warn" />
                  <LongMessage message={warning} className="text-ink text-2xs" />
                  <Provenance source="generator" variant="marker" />
                </li>
              ))}
            </ul>
          )}

          <SpeciesDistribution
            model={distribution}
            byOscode={byOscode}
            selectedOscode={selectedOscode}
            onSelect={selectSpecies}
          />

          <div className="space-y-1">
            <SectionHeading
              level={4}
              count={`${formatCount(distribution.low.length)} ${plural(
                distribution.low.length,
                'species'
              )}`}
              description={
                `Below ${formatPercentTerse(distribution.threshold, 0)}, with this dashboard's ` +
                'reading of each one. They are not all the same kind of problem, and one of them ' +
                'is not a problem at all.'
              }
            >
              The low tail
            </SectionHeading>
            <LowTailReadings
              rows={lowRows}
              threshold={distribution.threshold}
              selectedOscode={selectedOscode}
              onSelect={selectSpecies}
            />
          </div>

          <Disclosure
            summary="Full species table"
            count={`${formatCount(distribution.speciesCount)} ${plural(
              distribution.speciesCount,
              'species'
            )}`}
            open={tableOpen}
            onOpenChange={setTableOpen}
          >
            <SpeciesTable
              points={distribution.points}
              byOscode={byOscode}
              context={context}
              selectedOscode={selectedOscode}
              onSelect={selectSpecies}
              onlyInComparison={onlyInComparison}
            />
          </Disclosure>
        </div>
      </Panel>

      <Panel
        title="Forward tracking by node type"
        subtitle="node_tracking.by_type"
        availability={tracking.availability}
        message={tracking.message ?? undefined}
        missingSubject="Forward tracking by node type"
      >
        <NodeTypeBreakdown model={nodeTypes} />
      </Panel>

      <Panel
        title="Species identity changes"
        subtitle="derived from other_reports"
        provenance="derived"
        availability={report.species.availability === 'absent' ? 'absent' : 'available'}
        missingSubject="Species identity changes"
      >
        <SpeciesLinks model={links} selectedOscode={selectedOscode} onSelect={selectSpecies} />
      </Panel>
    </div>
  )
}

export default NodeTrackingReport
