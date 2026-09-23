import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  KeyValueList,
  LongMessage,
  Panel,
  Provenance,
  SectionHeading,
  StatusChip,
  UnknownValue,
} from '@/@panther.core/components'
import type { KeyValueItem } from '@/@panther.core/components'
import { formatCount, formatUtc, plural } from '@/app/format'
import { stepRoute } from '@/features/build/model'
import type { BuildPhase } from '@/features/build/model'
import { useBuildReport } from '@/features/build/hooks'
import { BoundReports } from '@/features/pipeline/components/BoundReports'
import { StepList } from '@/features/pipeline/components/StepList'
import {
  attributeWarningsToPhases,
  phaseCounter,
  phaseInterpretation,
  phaseMarkers,
  phaseStatusKey,
} from '@/features/pipeline/model'

/**
 * The selected phase: what its state means, what its timing evidence is, its steps in declared
 * order, and the reports bound to it.
 *
 * The interpretation line is the important part. A phase reading 3/5 is ambiguous on its own, and
 * the difference between "the build stopped here" and "later phases ran past this" is the whole
 * product - so the panel states which one it is in words, rather than leaving a reviewer to infer
 * it from the position of a marker.
 */
export interface PhaseDetailProps {
  phase: BuildPhase
  highlightId?: string | null
}

export const PhaseDetail = ({ phase, highlightId }: PhaseDetailProps) => {
  const report = useBuildReport()
  const warningsByPhase = useMemo(() => attributeWarningsToPhases(report), [report])
  const markers = phaseMarkers(phase, warningsByPhase)
  const phaseCount = report.pipeline.phases.length

  const timingItems: KeyValueItem[] = [
    {
      key: 'first-artifact',
      label: 'First artifact',
      value: phase.timing.firstArtifactAt.present ? formatUtc(phase.timing.firstArtifactAt) : null,
      absentReason: 'no step here produced one',
    },
    {
      key: 'last-artifact',
      label: 'Last artifact',
      value: phase.timing.lastArtifactAt.present ? formatUtc(phase.timing.lastArtifactAt) : null,
      absentReason: 'no step here produced one',
    },
    {
      key: 'elapsed',
      label: 'Inferred activity',
      value: phase.timing.label,
      mono: false,
      aside: <StatusChip status={phase.timing.provenance} variant="plain" />,
    },
    {
      key: 'artifacts',
      label: 'Artifacts',
      value: formatCount(phase.timing.artifactCount),
    },
  ]

  if (phase.timing.potentiallyConcurrent) {
    timingItems.push({
      key: 'concurrency',
      label: 'Concurrency',
      value:
        'Artifacts in this phase land within the concurrency window, so parts of it may have run ' +
        'in parallel rather than in sequence.',
      mono: false,
    })
  }

  if (!phase.countersConsistent) {
    timingItems.push({
      key: 'counters',
      label: 'Reported counters',
      value:
        `the generator reports ${phase.declaredDone}/${phase.declaredTotal}, its step statuses ` +
        `say ${phase.completedSteps}/${phase.totalSteps}`,
      mono: false,
      attention: true,
    })
  }

  return (
    <div className="space-y-gutter">
      <Panel
        title={phase.name}
        subtitle={phase.id}
        tone={phase.isFrontier || phase.isHole || phase.hasFailure ? 'attention' : 'default'}
        breakBefore
        status={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <StatusChip status={phaseStatusKey(phase)} detail={phaseCounter(phase)} size="md" />
            <span className="pb-figures text-ink-faint text-2xs">
              phase {phase.index + 1} of {phaseCount}
            </span>
          </span>
        }
      >
        <div className="space-y-2">
          <p className="text-ink max-w-prose text-xs">
            {phaseInterpretation(phase, report.pipeline.phases)}
          </p>

          {markers.warnings.length > 0 && (
            <ul className="list-none space-y-1 p-0">
              {markers.warnings.map((finding, index) => (
                <li
                  key={`${finding.warning.id}-${index}`}
                  className="bg-status-warn-wash rounded-hair flex flex-wrap items-baseline gap-x-2 gap-y-1 px-2 py-1"
                >
                  <StatusChip status="warn" variant="plain" />
                  <LongMessage
                    message={finding.warning.message}
                    className="text-ink text-2xs min-w-0 flex-1"
                  />
                  {finding.stepId !== null && (
                    <Link to={stepRoute(finding.stepId)} className="text-accent text-2xs">
                      go to step
                    </Link>
                  )}
                  <Provenance source="generator" detail={finding.warning.sectionId} />
                </li>
              ))}
            </ul>
          )}

          {markers.unknownStatusValues.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {markers.unknownStatusValues.map(value => (
                <UnknownValue key={value} value={value} kind="step status" source={phase.id} />
              ))}
            </div>
          )}

          <KeyValueList items={timingItems} labelWidth={18} columns={2} />

          <SectionHeading
            level={4}
            count={`${phase.completedSteps} of ${phase.totalSteps} complete · declared order`}
            description={
              // Timing provenance used to ride every row as its own chip, which on a
              // twelve-step phase meant twelve copies of one fact. It is the same fact
              // for every row in this fixture, so it belongs to the table, not the row -
              // and each row still carries its own provenance in the expanded detail if
              // a future report mixes measured and inferred timings.
              [
                phase.incompleteSteps.length === 0
                  ? null
                  : `${phase.incompleteSteps.length} ${plural(
                      phase.incompleteSteps.length,
                      'step'
                    )} incomplete.`,
                'Elapsed times are inferred from artifact timestamps, not measured runtime.',
              ]
                .filter(Boolean)
                .join(' ')
            }
          >
            Steps
          </SectionHeading>

          <StepList phase={phase} report={report} highlightId={highlightId} />
        </div>
      </Panel>

      <BoundReports report={report} phase={phase} />
    </div>
  )
}

export default PhaseDetail
