import clsx from 'clsx'
import { Tooltip } from '@mantine/core'
import { useMetricDefinition } from '@/@panther.core/components/metricDefinitions'

/**
 * A bucket string with its definition attached.
 *
 * A report is often full of vocabulary a reader cannot decode from the string alone - short
 * identifiers a producer enumerates but never explains inline. The producer has always known what
 * those mean; this is where the meaning surfaces, from whatever definitions registry the caller
 * wires up (see `MetricDefinitionsProvider`).
 *
 * Three cases, not a pile of ternaries:
 * - Resolved: dotted-underline + tooltip, showing `label` when the caller supplied one, else the
 *   registry's own label.
 * - Unresolved with a curated `label`: that text is prose the caller wrote, not a raw identifier -
 *   it renders like ordinary text, never in the identifier's mono treatment.
 * - Unresolved with no `label`: `fallback` renders VERBATIM in mono. It is deliberately not
 *   humanised into prose - turning a raw identifier into title case invents a definition rather
 *   than admitting there is none, which is the failure the definitions registry exists to prevent.
 *
 * Neither unresolved case is focusable or shows a tooltip: there is nothing to reveal, and a focus
 * stop that opens nothing is worse than none.
 */
export interface DefinedTermProps {
  /** Registry key. How a caller derives or namespaces it is the caller's concern, not this one's. */
  definitionId: string
  /** The report's own string, shown verbatim (in mono) when nothing defines it and no `label` is given. */
  fallback: string
  /**
   * Curated prose supplied by the caller, shown instead of the registry's label whether or not the
   * definition resolves. A caller that already has a better reading than the registry's own entry -
   * or than the raw source string - passes it here, so it survives even if a definition later
   * resolves for the same id. It is prose, never an identifier, so it never takes `fallback`'s mono
   * styling.
   */
  label?: string
  className?: string
}

export const DefinedTerm = ({ definitionId, fallback, label, className }: DefinedTermProps) => {
  const definition = useMetricDefinition(definitionId)

  if (definition === null) {
    // Unresolved: never focusable, never a tooltip. But the text differs in kind, not just
    // content - `label` is curated prose and must not take the raw-identifier mono treatment that
    // `fallback` (the report's own string) keeps.
    return label !== undefined ? (
      <span className={className}>{label}</span>
    ) : (
      <span className={clsx('pb-ident', className)}>{fallback}</span>
    )
  }

  return (
    <Tooltip label={definition.description}>
      <span
        tabIndex={0}
        className={clsx(
          'decoration-ink-faint cursor-help underline decoration-dotted underline-offset-2',
          'focus-visible:outline-accent rounded-xs focus-visible:outline-2',
          className
        )}
      >
        {label ?? definition.label}
      </span>
    </Tooltip>
  )
}
