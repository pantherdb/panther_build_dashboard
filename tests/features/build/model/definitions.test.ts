import { describe, expect, it } from 'vitest'
import {
  getMetricDefinition,
  METRIC_DEFINITIONS,
  METRIC_IDS,
  metricDefinitionAnchor,
  metricIdForReportKey,
  metricLabel,
  metricsInFamily,
  parseAnchor,
  SEQUENCE_METRIC_IDS,
} from '@/features/build/model'
import type { MetricId } from '@/features/build/model'
import { getFixtureReport } from '@/features/build/fixtures'

/**
 * Phase 7 of `.plans/feature/01-report-model.md`: the metric definitions registry.
 *
 * Its job is Appendix A.4, the terminology problem: this report carries six distinct counts that all
 * reduce to the word "sequences" if nobody stops it. Labelling a bare number "Sequences" is a
 * defect, so no sequence metric may carry that label and no two may share one.
 */

const report = getFixtureReport('real')

describe('registry completeness', () => {
  it('defines every metric id exactly once', () => {
    expect(new Set(METRIC_IDS).size).toBe(METRIC_IDS.length)
    for (const id of METRIC_IDS) {
      const definition = getMetricDefinition(id)
      expect(definition.id).toBe(id)
      expect(definition.label.length).toBeGreaterThan(0)
      expect(definition.shortLabel.length).toBeGreaterThan(0)
      expect(definition.definition.length).toBeGreaterThan(20)
      expect(definition.source.length).toBeGreaterThan(0)
    }
    expect(Object.keys(METRIC_DEFINITIONS).sort()).toEqual([...METRIC_IDS].sort())
  })

  it('never gives a curated id a dot, which is what makes generator namespacing structural', () => {
    // `generatorDefinitionId` joins a section id and a term with a dot precisely so it can never
    // collide with a curated id - "namespacing, not precedence". That guarantee only holds if no
    // curated id ever contains one; this is what keeps it a fact about the registry, not a
    // convention someone could break by adding a poorly-named metric.
    for (const id of METRIC_IDS) {
      expect(id).not.toContain('.')
    }
  })

  it('groups every metric into a family the definitions panel can render', () => {
    const families = ['sequences', 'families', 'nodes', 'species', 'trees', 'pipeline'] as const
    const covered = families.flatMap(family => metricsInFamily(family).map(entry => entry.id))
    expect(new Set(covered).size).toBe(METRIC_IDS.length)
  })
})

describe('Appendix A.4 - the six sequence counts', () => {
  it('names six distinct concepts', () => {
    expect(SEQUENCE_METRIC_IDS).toHaveLength(6)
    expect(new Set(SEQUENCE_METRIC_IDS).size).toBe(6)
  })

  it('gives none of them the bare label "Sequences"', () => {
    const labels = SEQUENCE_METRIC_IDS.map(metricLabel)
    expect(new Set(labels).size).toBe(6)
    for (const label of labels) {
      expect(label.toLowerCase()).not.toBe('sequences')
      expect(label.length).toBeGreaterThan('sequences'.length)
    }
  })

  it('explains why each one differs from the others', () => {
    for (const id of SEQUENCE_METRIC_IDS) {
      expect(getMetricDefinition(id).ambiguityNote, id).toBeDefined()
    }
  })

  it('lines the six labels up with the six values in the report', () => {
    const values = new Map(
      report.consistency.sequenceCounts.map(entry => [entry.metricId, entry.value])
    )
    expect([...values.keys()]).toEqual([...SEQUENCE_METRIC_IDS])
    expect(values.get('prevLibSequences')).toBe(2692827)
    expect(values.get('inputReferenceSequences')).toBe(2298433)
    expect(values.get('finalStageSequences')).toBe(2292530)
    expect(values.get('assignedSequences')).toBe(1813607)
    expect(values.get('librarySequences')).toBe(1742145)
    expect(values.get('leafNodesMapped')).toBe(1614152)
    // Six different numbers, so no two of them can be the same measurement.
    expect(new Set(values.values()).size).toBe(6)
  })
})

describe('the reclustering sequence counts', () => {
  it('disambiguates the two reclustering sequence counts', () => {
    const inherited = METRIC_DEFINITIONS.reclusteredIntoExistingFamilies
    const created = METRIC_DEFINITIONS.reclusteredIntoNewFamilies
    expect(inherited.family).toBe('sequences')
    expect(created.family).toBe('sequences')
    // The whole point: a reader must be able to tell them apart from the label alone.
    expect(inherited.label).not.toBe(created.label)
    expect(inherited.ambiguityNote).toBeDefined()
    expect(created.ambiguityNote).toBeDefined()
  })
})

describe('report keys map onto registry ids', () => {
  it('resolves every metric key the real report emits', () => {
    const unregistered = report.otherReports.metrics.filter(metric => metric.metricId === null)
    expect(unregistered).toEqual([])
    expect(metricIdForReportKey('prev_lib_sequences')).toBe('prevLibSequences')
    expect(metricIdForReportKey('new_lib_sequences')).toBe('inputReferenceSequences')
  })

  it('returns null for an unknown key instead of inventing a definition', () => {
    expect(metricIdForReportKey('pfam_domains_matched')).toBeNull()
  })

  it('keeps species_total and species_reported as different concepts', () => {
    // Appendix A.6: 131 tracked species against a 147 denominator is not a contradiction.
    expect(metricLabel('speciesReported')).not.toBe(metricLabel('speciesTotal'))
    expect(getMetricDefinition('speciesReported').ambiguityNote).toContain('denominator')
    expect(report.nodeTracking.speciesReported).toBe(131)
    expect(report.otherReports.values.species_total).toBe(147)
  })

  it('marks the assignment gain as percentage points, not a percentage change', () => {
    const definition = getMetricDefinition('assignmentGainPoints')
    expect(definition.unit).toBe('percentage-points')
    expect(definition.ambiguityNote).toContain('Percentage points')
    expect(report.mapping.assignmentGainPoints).toBe(13.5)
  })
})

describe('definition anchors', () => {
  it('point at the metric anchor this module owns, so a tooltip and an export agree', () => {
    for (const id of METRIC_IDS as readonly MetricId[]) {
      const anchor = metricDefinitionAnchor(id)
      expect(parseAnchor(anchor)?.kind).toBe('metric')
    }
  })
})
