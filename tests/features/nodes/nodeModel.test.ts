import { describe, expect, it } from 'vitest'
import { getFixtureReport } from '@/features/build/fixtures'
import type { NodeTrackingSummary } from '@/features/build/model'
import {
  buildNodeTypes,
  speciesCoverageFact,
  trackingHeadlineSentence,
  zeroTypeSentence,
} from '@/features/nodes/model'
import { buildDistribution } from '@/features/species/model/distribution'

const tracking = (): NodeTrackingSummary => getFixtureReport('real').nodeTracking

describe('buildNodeTypes', () => {
  it('reads the five node types from Appendix A.6, ranked by rate', () => {
    const model = buildNodeTypes(tracking())

    expect(model.rows.map(row => row.nodeType)).toEqual([
      'SPECIATION',
      'LEAF',
      'DUPLICATION',
      'HORIZ_TRANSFER',
      'UNKNOWN',
    ])
    expect(model.rows.map(row => row.pct)).toEqual([95.4, 92.7, 85.4, 83.3, 0])
    expect(model.rows.map(row => row.total)).toEqual([958_465, 1_742_145, 325_035, 5_724, 347])
  })

  it('separates the measured zero so a chart can label what it cannot draw', () => {
    const model = buildNodeTypes(tracking())

    expect(model.zeroRows.map(row => row.nodeType)).toEqual(['UNKNOWN'])
    expect(model.unreadable).toEqual([])
    // The leader and every zero get a direct label; the middle three do not.
    expect(model.labelled).toEqual(['SPECIATION', 'UNKNOWN'])
    expect(model.rows[4].markLabel).toBe('0 % of 347 nodes')
    expect(zeroTypeSentence(model.rows[4])).toContain('0 of 347 nodes')
    expect(zeroTypeSentence(model.rows[4])).toContain('measured zero, not a missing measurement')
  })

  it('keeps a type with no percentage out of the zero bucket', () => {
    const model = buildNodeTypes({
      ...tracking(),
      byType: [{ nodeType: 'FUTURE', mapped: null, total: null, pct: null, recomputedPct: null }],
    })

    expect(model.zeroRows).toEqual([])
    expect(model.unreadable.map(row => row.nodeType)).toEqual(['FUTURE'])
  })
})

describe('trackingHeadlineSentence', () => {
  it('states the overall rate and the spread of the species distribution', () => {
    const summary = tracking()
    const sentence = trackingHeadlineSentence(summary, buildDistribution(summary))

    expect(sentence).toContain('92.7 %')
    expect(sentence).toContain('3,031,716')
    expect(sentence).toContain('median is 99.5 %')
    expect(sentence).toContain('median absolute deviation of 0.4 %')
    expect(sentence).toContain('117 of them sit at or above 90 %')
  })
})

describe('speciesCoverageFact', () => {
  it('derives that the species rows are a LEAF distribution, by addition', () => {
    const summary = tracking()
    const fact = speciesCoverageFact(summary, buildDistribution(summary))

    expect(fact.speciesNodeTotal).toBe(1_742_145)
    expect(fact.leafTotal).toBe(1_742_145)
    expect(fact.matchedType).toBe('LEAF')
    expect(fact.sentence).toContain('131 species rows sum to 1,742,145')
    expect(fact.sentence).toContain('exactly the LEAF total')
    expect(fact.sentence).toContain('all 5 node types')
    expect(fact.sentence).toContain('Two different denominators, not a contradiction')
  })

  it('claims no node type when the sum matches none of them', () => {
    const summary = tracking()
    const trimmed: NodeTrackingSummary = {
      ...summary,
      bySpecies: summary.bySpecies.slice(0, 10),
    }
    const fact = speciesCoverageFact(trimmed, buildDistribution(trimmed))

    expect(fact.matchedType).toBeNull()
    expect(fact.sentence).toContain('matches no single node-type total')
  })
})
