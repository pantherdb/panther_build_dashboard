import clsx from 'clsx'
import { Tooltip } from '@mantine/core'
import { Link } from 'react-router-dom'
import { previewMessage, StatusChip, StatusIcon } from '@/@panther.core/components'
import { plural } from '@/app/format'
import { formatDuration, phaseElementId, stepRoute } from '@/features/build/model'
import type { BuildPhase } from '@/features/build/model'
import { PhaseMarker } from '@/features/pipeline/components/PhaseMarker'
import { phaseCounter, phaseStatusKey } from '@/features/pipeline/model'
import type { PhaseMarkers } from '@/features/pipeline/model'

/**
 * One phase on the spine: navigation, progress, state, inferred duration and findings in a single
 * row that stays visible while the content column changes.
 *
 * The frontier is emphasised with weight and a directional caret; a hole is marked with a hatched
 * glyph and the word "Hole". Neither relies on colour, and neither is described as where the build
 * stopped - the row for a hole says how many later phases carried on past it.
 */
export interface PhaseNodeProps {
  phase: BuildPhase
  /** Later phases that actually produced work - not simply the phases after this one. */
  laterPhasesRan: number
  /** The longest phase span in the build, so the duration bars share one scale. */
  longestPhaseSeconds: number | null
  markers: PhaseMarkers
  reportCount: number
  selected: boolean
  onSelect: () => void
  expanded: boolean
  onToggleExpanded: () => void
  isFirst: boolean
  isLast: boolean
  highlighted: boolean
}

const Flag = ({
  shape,
  tone,
  hint,
  label,
}: {
  shape: 'triangle-warn' | 'cross' | 'question' | 'diamond'
  tone: string
  hint: string
  label: string
}) => (
  <Tooltip label={hint} withArrow multiline maw={300} openDelay={150}>
    <span className={clsx('inline-flex items-center', tone)} aria-label={label}>
      <StatusIcon shape={shape} size={11} />
    </span>
  </Tooltip>
)

export const PhaseNode = ({
  phase,
  laterPhasesRan,
  longestPhaseSeconds,
  markers,
  reportCount,
  selected,
  onSelect,
  expanded,
  onToggleExpanded,
  isFirst,
  isLast,
  highlighted,
}: PhaseNodeProps) => {
  const statusKey = phaseStatusKey(phase)
  const duration =
    phase.timing.seconds === null ? null : `≈ ${formatDuration(phase.timing.seconds)}`
  const incomplete = phase.steps.filter(step => !step.isComplete)

  return (
    <li
      id={phaseElementId(phase.id)}
      data-pb-anchor=""
      data-phase-status={phase.status}
      data-phase-index={phase.index}
      className={clsx('relative', highlighted && 'pb-hairline-accent')}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
        className={clsx(
          'flex w-full items-stretch gap-2 px-2 py-1.5 text-left',
          selected ? 'bg-wash-selected' : 'hover:bg-wash-hover'
        )}
      >
        <span className="relative flex w-4 shrink-0 justify-center">
          <span
            aria-hidden="true"
            className={clsx(
              'bg-hairline absolute left-1/2 w-px -translate-x-1/2',
              isFirst ? 'top-2' : 'top-0',
              isLast ? 'h-2' : 'bottom-0'
            )}
          />
          <span className="bg-surface-1 relative mt-1 py-0.5">
            <PhaseMarker statusKey={statusKey} />
          </span>
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-1.5">
            <span className="pb-figures text-ink-faint text-2xs w-4 shrink-0 text-right">
              {phase.index + 1}
            </span>
            <span
              className={clsx(
                'text-ink text-xs leading-4',
                phase.isFrontier && 'font-semibold',
                phase.status === 'pending' && 'text-ink-muted'
              )}
            >
              {phase.name}
            </span>
          </span>

          <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 pl-[1.375rem]">
            <StatusChip
              status={statusKey}
              detail={phaseCounter(phase)}
              hint={
                phase.isHole
                  ? `Incomplete while ${laterPhasesRan} later ${plural(laterPhasesRan, 'phase')} ran ` +
                    'past it. A hole, not where the build stopped.'
                  : undefined
              }
            />

            {duration !== null && (
              <Tooltip
                label={`${phase.timing.label} — inferred from artifact timestamps across ${phase.timing.artifactCount} artifacts, not measured runtime.`}
                withArrow
                multiline
                maw={300}
                openDelay={150}
              >
                <span className="flex items-center gap-1.5">
                  {/* Where the time went, at a glance. The spans run from about three
                      minutes to nearly half an hour across the fourteen phases and the
                      figure alone made that spread invisible. Shares one scale across
                      the spine, so bar lengths are comparable between phases. */}
                  {longestPhaseSeconds !== null &&
                    longestPhaseSeconds > 0 &&
                    phase.timing.seconds !== null && (
                      <span
                        aria-hidden="true"
                        className="bg-surface-3 relative h-1 w-10 overflow-hidden rounded-full"
                      >
                        <span
                          className="bg-seq-3 absolute inset-y-0 left-0 rounded-full"
                          style={{
                            width: `${Math.max(
                              3,
                              (phase.timing.seconds / longestPhaseSeconds) * 100
                            )}%`,
                          }}
                        />
                      </span>
                    )}
                  <span className="pb-figures text-ink-faint text-2xs">{duration}</span>
                </span>
              </Tooltip>
            )}

            {markers.hasFailure && (
              <Flag
                shape="cross"
                tone="text-status-fail"
                label="Failed step in this phase"
                hint="A step in this phase failed. Its attempt history is in the phase detail."
              />
            )}
            {markers.warnings.length > 0 && (
              <Flag
                shape="triangle-warn"
                tone="text-status-warn"
                label={`${markers.warnings.length} generator ${plural(
                  markers.warnings.length,
                  'warning'
                )}`}
                hint={markers.warnings
                  .map(finding => previewMessage(finding.warning.message))
                  .join(' — ')}
              />
            )}
            {markers.outOfOrderStepIds.length > 0 && (
              <Flag
                shape="diamond"
                tone="text-ink-muted"
                label={`${markers.outOfOrderStepIds.length} artifact ${plural(
                  markers.outOfOrderStepIds.length,
                  'time'
                )} out of declared order`}
                hint={
                  `${markers.outOfOrderStepIds.length} step ${plural(
                    markers.outOfOrderStepIds.length,
                    'artifact'
                  )} here ${markers.outOfOrderStepIds.length === 1 ? 'lands' : 'land'} before the ` +
                  'step declared ahead of it. Artifact times are evidence of activity, not an ' +
                  'execution log.'
                }
              />
            )}
            {(markers.countersInconsistent || markers.unknownStatusValues.length > 0) && (
              <Flag
                shape="question"
                tone="text-status-neutral"
                label="Reported values this dashboard could not reconcile"
                hint={
                  markers.countersInconsistent
                    ? `The generator reports ${phase.declaredDone}/${phase.declaredTotal} here ` +
                      `but its own step statuses say ${phase.completedSteps}/${phase.totalSteps}; ` +
                      'the step statuses are used.'
                    : `Unrecognised step status: ${markers.unknownStatusValues.join(', ')}`
                }
              />
            )}

            {reportCount > 0 && (
              <span className="text-ink-faint text-2xs">
                {reportCount} {plural(reportCount, 'report')}
              </span>
            )}
          </span>
        </span>
      </button>

      {incomplete.length > 0 && (
        <div className="pr-2 pb-1 pl-[2.75rem]">
          <button
            type="button"
            onClick={onToggleExpanded}
            aria-expanded={expanded}
            className="text-ink-muted hover:text-ink text-2xs inline-flex items-center gap-1"
          >
            <svg
              viewBox="0 0 12 12"
              width={9}
              height={9}
              aria-hidden="true"
              focusable="false"
              className={clsx('shrink-0 transition-transform', expanded && 'rotate-90')}
            >
              <path d="M4 2.5 8.5 6 4 9.5z" fill="currentColor" />
            </svg>
            {incomplete.length} incomplete {plural(incomplete.length, 'step')}
          </button>

          {expanded && (
            <ul className="mt-0.5 list-none space-y-0.5 p-0">
              {incomplete.map(step => (
                <li key={step.id} className="flex items-baseline gap-1.5">
                  <StatusChip
                    status={
                      step.status.isUnknown ? (step.status.raw ?? 'unknown') : step.status.kind
                    }
                    variant="plain"
                  />
                  <Link
                    to={stepRoute(step.id)}
                    className="pb-ident text-ink-muted hover:text-accent text-2xs min-w-0 break-all"
                  >
                    {step.goal}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  )
}
