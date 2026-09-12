import { METRIC_DEFINITIONS, generatorDefinitions } from '@/features/build/model'
import type { BuildReport } from '@/features/build/model'
import type { MetricDefinitionRegistry } from '@/@panther.core/components'

/**
 * Adapts the model's metric definitions to the registry the shared primitives consume.
 *
 * The two shapes differ deliberately: the model's entry carries domain fields (`family`,
 * `ambiguityNote`, `shortLabel`) that a primitive has no business knowing, and the primitive's
 * entry carries only what it renders. This adapter is the single crossing point, mounted once in
 * `App`, so `MetricValue` anywhere in the tree gets the same label and the same explanation - which
 * is what stops any screen from labelling one of the six sequence counts "Sequences".
 *
 * It also merges the vocabulary the GENERATOR supplied. Those ids are namespaced `section.term`,
 * so they extend the registry and can never displace a curated entry. A null report yields the
 * curated half alone, which is what renders before a report has parsed.
 */
export const curatedRegistry: MetricDefinitionRegistry = Object.fromEntries(
  Object.values(METRIC_DEFINITIONS).map(definition => [
    definition.id,
    {
      id: definition.id,
      label: definition.label,
      description:
        definition.ambiguityNote === undefined
          ? definition.definition
          : `${definition.definition} ${definition.ambiguityNote}`,
      source: definition.source,
    },
  ])
)

export function buildMetricRegistry(report: BuildReport | null): MetricDefinitionRegistry {
  if (report === null) return curatedRegistry
  return { ...curatedRegistry, ...generatorDefinitions(report) }
}
