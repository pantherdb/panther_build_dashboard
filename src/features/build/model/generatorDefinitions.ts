/**
 * Generator-supplied vocabulary, flattened into definitions-registry entries.
 *
 * The dashboard curates labels for the figures it has always shown; this covers the bucket strings
 * it has always shown BARE - `applied_under_ht`, `zero_seqs_matched`, `(other)`. The meanings were
 * always written down, as comments in the pipeline; this is the path by which they reach a reader.
 */
import { generatorDefinitionId } from './definitions'
import type { BuildReport } from './types'
import type { MetricDefinitionRegistry } from '@/@panther.core/components'

export function generatorDefinitions(report: BuildReport): MetricDefinitionRegistry {
  const entries: Record<string, MetricDefinitionRegistry[string]> = {}
  for (const section of report.reports) {
    for (const entry of section.generic.definitions) {
      const id = generatorDefinitionId(section.sectionId, entry.term)
      entries[id] = {
        id,
        label: entry.label,
        description: entry.definition,
        source: `${section.sectionId}.definitions.${entry.term}`,
      }
    }
  }
  return entries
}
