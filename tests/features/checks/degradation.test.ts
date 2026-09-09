import { describe, expect, it } from 'vitest'
import { FIXTURE_STATE_KEYS, getFixtureReport } from '@/features/build/fixtures'
import { runChecks } from '@/features/checks/model'
import type { CheckFinding } from '@/features/checks/model'

/**
 * What happens when the report is missing something.
 *
 * The specific failure guarded against here: a check whose inputs were removed reporting `pass`.
 * That is worse than no check at all, because it is positive evidence for something nobody
 * measured. `stripSection('node_tracking')` removes the LEAF totals and the per-node-type figures,
 * and both dependent checks must become `absent` with a stated reason.
 */

const find = (checks: readonly CheckFinding[], id: string): CheckFinding => {
  const finding = checks.find(candidate => candidate.id === id)
  if (finding === undefined) throw new Error(`no finding with id ${id}`)
  return finding
}

describe("stripSection('node_tracking')", () => {
  const result = () => runChecks(getFixtureReport('missingNodeTracking'))

  it('turns the leaf/library check absent rather than passing it', () => {
    const finding = find(result().checks, 'consistency.leaf-library')

    expect(finding.state).toBe('absent')
    expect(finding.weight).toBe('absent')
    expect(finding.absentReason).toBe('inputs-missing')
    expect(finding.explanation).toContain('LEAF nodes')
    expect(finding.explanation).toContain('not a clean bill of health')
  })

  it('turns node-type coverage absent rather than reporting full coverage', () => {
    const finding = find(result().checks, 'nodes.type-coverage')

    expect(finding.state).toBe('absent')
    expect(finding.absentReason).toBe('inputs-missing')
    expect(finding.explanation).toContain('Absence is not coverage')
  })

  it('leaves the checks that do not depend on it passing, and does not count the gap as an issue', () => {
    const { summary, checks } = result()

    expect(find(checks, 'consistency.family-agreement').state).toBe('pass')
    expect(find(checks, 'consistency.tree-completeness').state).toBe('pass')
    expect(summary.absent).toBe(2)
    // Six issues rather than seven (Appendix A.6/rules.test.ts): stripping node_tracking takes
    // out the UNKNOWN node-type warning, the one derived issue that depends on it. The 4
    // generator issues (proteomes x3, progress x1) and the other 2 kept derived issues
    // (artifact ordering, the dirty source tree) are unaffected.
    expect(summary.issues).toBe(6)
  })

  it('says which source was missing where a check could still run on what was left', () => {
    const finding = find(result().checks, 'consistency.species-denominator')

    expect(finding.state).toBe('pass')
    expect(finding.explanation).toContain('Species in node forward tracking')
    expect(finding.explanation).toContain('not part of the comparison')
    expect(finding.evidence).toContain(
      'Species in node forward tracking is not in this report, so it was not compared.'
    )
  })

  it('drops the LEAF count from the sequence terminology list without failing the check', () => {
    const finding = find(result().checks, 'terminology.sequence-counts')

    expect(finding.state).toBe('pass')
    expect(finding.label).toBe('5 sequence counts, 5 distinct values')
  })
})

describe('every fixture state', () => {
  it('runs without throwing and produces internally consistent counts', () => {
    for (const key of FIXTURE_STATE_KEYS) {
      const { checks, summary, suppressed } = runChecks(getFixtureReport(key))

      expect(summary.total).toBe(checks.length)
      expect(summary.issues).toBe(checks.filter(finding => finding.weight === 'issue').length)
      expect(summary.issues).toBe(summary.generatorIssues + summary.derivedIssues)
      expect(summary.suppressed).toBe(suppressed.length)
      expect(summary.issues + summary.verified + summary.notes + summary.absent).toBe(summary.total)

      for (const finding of suppressed) expect(finding.supersededBy).not.toBeNull()
    }
  })

  it('is deterministic: the same report twice produces the same findings', () => {
    const first = runChecks(getFixtureReport('real'))
    const second = runChecks(getFixtureReport('real'))
    expect(second).toEqual(first)
  })

  it('reports the failed state’s failure without losing the derived checks', () => {
    const { checks, summary } = runChecks(getFixtureReport('failed'))

    expect(summary.verified).toBeGreaterThan(0)
    expect(checks.some(finding => finding.weight === 'issue')).toBe(true)
  })

  it('keeps working on the fully degraded state, where the schema is newer than supported', () => {
    const { checks } = runChecks(getFixtureReport('degraded'))
    expect(checks.length).toBeGreaterThan(0)
  })
})
