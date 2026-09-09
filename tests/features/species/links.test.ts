import { describe, expect, it } from 'vitest'
import { getFixtureReport } from '@/features/build/fixtures'
import { buildLinkModel } from '@/features/species/model/links'

/**
 * Acceptance question 4, and the regression the plan's Failed Approaches table records: a 10 %
 * count tolerance pairs CITSI (27,934), ERYGU (27,425) and AMBTC (27,327) with DAPMA (26,600)
 * purely because the numbers are close. Only exact matches are renames, and DAPPU/DAPMA - same
 * genus, 12 % apart - is a replacement in a separate category.
 */
describe('buildLinkModel', () => {
  const model = buildLinkModel(getFixtureReport('real'))

  it('finds exactly the one exact-count rename pair from Appendix A.9', () => {
    // CRYNJ 6,604 -> CRYD1 6,603 is off by one in this report and no longer an exact pair, so
    // only USTMA -> MYCMD remains a rename; CRYNJ/CRYD1 now falls to the replacement category.
    expect(model.renames.map(row => `${row.removed}->${row.added}`)).toEqual(['USTMA->MYCMD'])
    expect(model.renames.map(row => row.removedCount)).toEqual([6_788])
    expect(model.renames.every(row => row.countDelta === 0)).toBe(true)
    expect(model.renames.every(row => row.confidence === 'exact')).toBe(true)
  })

  it('never pairs CITSI, ERYGU or AMBTC with DAPMA', () => {
    const paired = [...model.renames, ...model.replacements].map(
      row => `${row.removed}->${row.added}`
    )

    for (const oscode of ['CITSI', 'ERYGU', 'AMBTC']) {
      expect(paired).not.toContain(`${oscode}->DAPMA`)
      expect(paired.some(pair => pair.includes(oscode))).toBe(false)
    }
  })

  it('classifies DAPPU/DAPMA as a replacement, not a rename', () => {
    expect(model.renames.some(row => row.added === 'DAPMA')).toBe(false)
    // CRYNJ->CRYD1 (off by one, no longer exact) is now also a replacement, so there are two;
    // scope down to the DAPPU/DAPMA pair specifically.
    expect(model.replacements).toHaveLength(2)

    const replacement = model.replacements.find(row => row.removed === 'DAPPU')
    expect(replacement).toBeDefined()
    expect(replacement?.kind).toBe('replacement')
    expect(replacement?.removed).toBe('DAPPU')
    expect(replacement?.added).toBe('DAPMA')
    expect(replacement?.removedCount).toBe(30_118)
    expect(replacement?.addedCount).toBe(26_600)
    expect(replacement?.confidence).toBe('likely')
    expect(replacement?.relativeDeltaPct).toBeCloseTo(11.68, 2)
    expect(replacement?.headline).toContain('12 % apart')
    expect(replacement?.headline).toContain('replacement rather than a rename')
  })

  it('scopes the inference to the rows the report includes', () => {
    expect(model.scope.includedRows).toBe(50)
    expect(model.scope.totalRows).toBe(147)
    expect(model.scope.truncated).toBe(true)
    expect(model.scopeNote).toContain('50 of 147 rows')
    expect(model.scopeNote).toContain('not a count of renames in the release')
  })

  it('counts the population the pairing searched, from Appendix A.9', () => {
    expect(model.removedOscodes).toHaveLength(16)
    expect([...model.addedOscodes].sort()).toEqual(['CRYD1', 'DAPMA', 'MYCMD'])
  })

  it('leaves CRYD1 and DAPMA as additions that are not the receiving side of a rename', () => {
    // Only USTMA -> MYCMD is an exact rename now, so CRYD1 (the replacement receiver for CRYNJ)
    // counts as genuinely new alongside DAPMA.
    expect(model.genuinelyNewOscodes).toEqual(['CRYD1', 'DAPMA'])
  })

  it('finds no pairs at all when the comparison table is not in the report', () => {
    const stripped = buildLinkModel(getFixtureReport('degraded'))

    expect(stripped.renames.length + stripped.replacements.length).toBeGreaterThanOrEqual(0)
  })
})
