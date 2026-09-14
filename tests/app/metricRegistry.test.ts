import { describe, expect, it } from 'vitest'
import { buildMetricRegistry } from '@/app/metricRegistry'
import { generatorDefinitionId } from '@/features/build/model'
import { getFixtureReport } from '@/features/build/fixtures'

/**
 * Curated and generated definitions in one registry (spec §6.2).
 *
 * Namespacing rather than precedence: a generator term is keyed `section.term` and a curated id is
 * camelCase, so collision is structurally impossible and there is no rule anyone has to remember.
 */
describe('buildMetricRegistry', () => {
  it('keeps every curated definition', () => {
    const registry = buildMetricRegistry(getFixtureReport('real'))
    expect(registry.assignedSequences?.label).toBe('Sequences assigned to a family')
  })

  it('namespaces a generator term by its section id', () => {
    expect(generatorDefinitionId('recluster', 'new_family')).toBe('recluster.new_family')
  })

  it('returns only curated definitions when the report is null', () => {
    const registry = buildMetricRegistry(null)
    expect(registry.assignedSequences).toBeDefined()
    expect(Object.keys(registry).some(key => key.includes('.'))).toBe(false)
  })
})
