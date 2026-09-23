import clsx from 'clsx'
import { Tooltip } from '@mantine/core'
import { Link } from 'react-router-dom'
import { previewMessage, StatusIcon } from '@/@panther.core/components'
import { plural } from '@/app/format'
import { checkRoute } from '@/features/build/model'
import { useChecksForPhase } from '@/features/checks/hooks'
import type { CheckFinding } from '@/features/checks/model'

/**
 * The findings on one phase, for the spine.
 *
 * A check is only useful where the thing it is about is: on the phase node, beside the metric, next
 * to the configuration value. This is the phase-node half of that, and it is deliberately a count
 * plus a glyph rather than a sentence - the row it sits in is already carrying a status, a counter
 * and a duration.
 *
 * Not mounted by the spine today; the spine's own files belong to another plan. Any view holding a
 * phase id can drop it in.
 */
export interface PhaseCheckMarkerProps {
  phaseId: string
  /** Include verified findings. Off by default: a spine row is not the place for what went right. */
  includeVerified?: boolean
  className?: string
}

const ISSUE_TONE = 'text-status-warn'
const NOTE_TONE = 'text-ink-muted'
const PASS_TONE = 'text-status-pass'

function describe(findings: readonly CheckFinding[]): string {
  // Only a generator warning gets previewMessage's clipping; a dashboard-derived explanation is
  // quoted in full, as it was before LongMessage existed. A group can mix both origins, so the
  // choice is per finding, not per group.
  return findings
    .map(
      finding =>
        `${finding.label}. ${finding.origin === 'generator' ? previewMessage(finding.explanation) : finding.explanation}`
    )
    .join(' — ')
}

export const PhaseCheckMarker = ({
  phaseId,
  includeVerified = false,
  className,
}: PhaseCheckMarkerProps) => {
  const findings = useChecksForPhase(phaseId)
  const issues = findings.filter(finding => finding.weight === 'issue')
  const notes = findings.filter(finding => finding.weight === 'note')
  const verified = findings.filter(finding => finding.weight === 'verified')

  const shown = [
    ...(issues.length > 0
      ? [{ key: 'issue', tone: ISSUE_TONE, shape: 'triangle-warn' as const, list: issues }]
      : []),
    ...(notes.length > 0
      ? [{ key: 'note', tone: NOTE_TONE, shape: 'diamond' as const, list: notes }]
      : []),
    ...(includeVerified && verified.length > 0
      ? [{ key: 'verified', tone: PASS_TONE, shape: 'check' as const, list: verified }]
      : []),
  ]

  if (shown.length === 0) return null

  return (
    <span className={clsx('inline-flex items-center gap-1.5', className)}>
      {shown.map(group => (
        <Tooltip key={group.key} label={describe(group.list)} withArrow multiline maw={320}>
          <Link
            to={checkRoute(group.list[0].id)}
            data-phase-check-marker={group.key}
            className={clsx(
              group.tone,
              'hover:text-accent text-2xs inline-flex items-center gap-1'
            )}
            aria-label={`${group.list.length} ${group.key} ${plural(
              group.list.length,
              'check'
            )} on this phase`}
          >
            <StatusIcon shape={group.shape} size={11} />
            <span className="pb-figures">{group.list.length}</span>
          </Link>
        </Tooltip>
      ))}
    </span>
  )
}
