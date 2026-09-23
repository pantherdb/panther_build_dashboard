import clsx from 'clsx'
import { Tooltip } from '@mantine/core'
import { Link } from 'react-router-dom'
import { previewMessage, StatusIcon } from '@/@panther.core/components'
import type { StatusShape } from '@/@panther.core/vocabulary'
import { checkRoute } from '@/features/build/model'
import type { CheckFinding, CheckWeight } from '@/features/checks/model'

/**
 * A finding, rendered small enough to sit beside the thing it is about.
 *
 * The brief is blunt about this: "avoid a disconnected warning page as the primary experience". A
 * checks panel on its own is exactly that page, so the same findings have to be reachable from the
 * configuration value, the metric and the phase they concern. What belongs there is not the argument
 * - that is in the panel - but the fact that an argument exists, plus a way to reach it.
 *
 * Word, shape and link, in ink or a status tone. Never a bare coloured dot: at this size, hue is
 * the least reliable channel available.
 */
export interface InlineCheckMarkerProps {
  findings: readonly CheckFinding[]
  /** What the findings are about, for the accessible name: a config key, a metric label. */
  subject: string
  className?: string
}

const SHAPE: Record<CheckWeight, StatusShape> = {
  issue: 'triangle-warn',
  note: 'diamond',
  verified: 'check',
  absent: 'dash',
}

const TONE: Record<CheckWeight, string> = {
  issue: 'text-status-warn',
  note: 'text-ink-muted',
  verified: 'text-status-pass',
  absent: 'text-status-neutral',
}

const WORD: Record<CheckWeight, string> = {
  issue: 'Mismatch',
  note: 'Notable',
  verified: 'Verified',
  absent: 'Not evaluated',
}

/** The finding that most needs attention wins the marker; the rest are counted behind it. */
const ORDER: readonly CheckWeight[] = ['issue', 'note', 'absent', 'verified']

export function strongestFinding(findings: readonly CheckFinding[]): CheckFinding | null {
  for (const weight of ORDER) {
    const match = findings.find(finding => finding.weight === weight)
    if (match !== undefined) return match
  }
  return null
}

export const InlineCheckMarker = ({ findings, subject, className }: InlineCheckMarkerProps) => {
  const finding = strongestFinding(findings)
  if (finding === null) return null

  const others = findings.length - 1
  // previewMessage's clipping is for the generator's own long, sometimes multi-line warnings
  // (see LongMessage's doc comment); a dashboard-authored explanation is never that, so it is
  // quoted in full here exactly as it was before LongMessage existed.
  const message =
    finding.origin === 'generator' ? previewMessage(finding.explanation) : finding.explanation

  return (
    <Tooltip
      label={`${WORD[finding.weight]}: ${message}`}
      withArrow
      multiline
      maw={320}
      openDelay={150}
    >
      <Link
        to={checkRoute(finding.id)}
        data-check-marker={finding.weight}
        className={clsx(
          TONE[finding.weight],
          'hover:text-accent text-2xs inline-flex items-center gap-1 whitespace-nowrap',
          className
        )}
        aria-label={`${WORD[finding.weight]} on ${subject}: ${finding.label}`}
      >
        <StatusIcon shape={SHAPE[finding.weight]} size={11} className="shrink-0" />
        <span className="uppercase">{WORD[finding.weight]}</span>
        {others > 0 && <span className="pb-figures text-ink-faint">+{others}</span>}
      </Link>
    </Tooltip>
  )
}
