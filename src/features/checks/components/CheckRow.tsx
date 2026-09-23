import clsx from 'clsx'
import { Link } from 'react-router-dom'
import { Disclosure, LongMessage, Provenance } from '@/@panther.core/components'
import { useSelectSpecies } from '@/features/build/hooks'
import { checkElementId } from '@/features/build/model'
import { CheckMark } from '@/features/checks/components/CheckMark'
import { findingRoute, provenanceSourceOf } from '@/features/checks/model'
import type { CheckFinding } from '@/features/checks/model'

/**
 * One finding: state, provenance, sentence, evidence, and somewhere to go.
 *
 * Provenance is rendered on every row without exception. It is not decoration - this dashboard is
 * meant to become part of the permanent build record, and a record that cannot distinguish a
 * generator-authored warning from a dashboard inference is worse than no record. The `Provenance`
 * primitive separates the two by glyph and border style rather than by colour, so the distinction
 * survives print and export.
 *
 * The link is a router `Link` rather than a bare `<a href="#...">` because the target of a step,
 * report or config anchor is only mounted while its spine node is selected: the route has to move
 * the selection, then scroll. A finding that names a species opens the species detail instead,
 * since that panel is driven from the store rather than by a hash.
 */
export interface CheckRowProps {
  finding: CheckFinding
  /** Flashes the row a deep link points at. */
  highlighted?: boolean
  /** Drops the evidence and the link, for a dense in-context list. */
  compact?: boolean
}

const EVIDENCE_INLINE_LIMIT = 2

const EvidenceList = ({ evidence }: { evidence: readonly string[] }) => (
  <ul className="mt-0.5 list-none space-y-0.5 p-0">
    {evidence.map(line => (
      <li key={line} className="pb-ident text-ink-faint text-2xs">
        {line}
      </li>
    ))}
  </ul>
)

export const CheckRow = ({ finding, highlighted = false, compact = false }: CheckRowProps) => {
  const selectSpecies = useSelectSpecies()
  const evidence = finding.evidence
  const showEvidence = !compact && evidence.length > 0

  return (
    <li
      id={checkElementId(finding.id)}
      data-pb-anchor=""
      data-check-id={finding.id}
      data-check-state={finding.state}
      data-check-weight={finding.weight}
      data-check-origin={finding.origin}
      className={clsx(
        'flex items-baseline gap-2 py-1',
        highlighted && 'pb-hairline-accent -mx-1 px-1'
      )}
    >
      <span className="shrink-0">
        <CheckMark finding={finding} />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-ink text-xs">{finding.label}</span>
          <Provenance source={provenanceSourceOf(finding)} detail={finding.source} />
        </div>

        {finding.origin === 'generator' ? (
          <LongMessage
            message={finding.explanation}
            className="text-ink-muted mt-0.5 block max-w-prose text-xs"
          />
        ) : (
          <p className="text-ink-muted mt-0.5 max-w-prose text-xs">{finding.explanation}</p>
        )}

        {showEvidence &&
          (evidence.length > EVIDENCE_INLINE_LIMIT ? (
            <Disclosure
              bare
              className="mt-0.5"
              panelClassName="px-0 py-0"
              summary={<span className="text-ink-muted text-2xs">Evidence</span>}
              count={`${evidence.length} lines`}
            >
              <EvidenceList evidence={evidence} />
            </Disclosure>
          ) : (
            <EvidenceList evidence={evidence} />
          ))}

        {!compact && (
          <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3">
            {finding.oscode !== null && (
              <button
                type="button"
                onClick={() => selectSpecies(finding.oscode)}
                className="text-accent hover:text-accent-hover text-2xs"
              >
                Open {finding.oscode} →
              </button>
            )}
            <Link
              to={findingRoute(finding)}
              className="text-accent hover:text-accent-hover text-2xs"
            >
              {finding.anchorLabel} →
            </Link>
          </div>
        )}
      </div>
    </li>
  )
}
