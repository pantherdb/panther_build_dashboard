import { describe, expect, it } from 'vitest'
import { getFixtureReport } from '@/features/build/fixtures'
import { configAnchor, phaseAnchor, reportAnchor, stepAnchor } from '@/features/build/model'
import { CHECK_RULES, runChecks } from '@/features/checks/model'
import type { CheckFinding } from '@/features/checks/model'

/**
 * Every rule against the real report, asserting the state AND the anchor.
 *
 * The anchor is half of what makes a check useful - the brief's whole complaint about `warnings[]`
 * is that a string does not point anywhere - so a rule that produces the right verdict and links to
 * the wrong place is only half working, and these assertions treat it that way.
 *
 * The numbers are Appendix A of `.plans/feature/01-report-model.md` and are not re-derived here. If
 * one of these fails, either the fixture changed or a rule is reading the wrong field; a test that
 * recomputed the expected value from the same code path could not tell the difference.
 */

const real = () => runChecks(getFixtureReport('real'))

const find = (checks: readonly CheckFinding[], id: string): CheckFinding => {
  const finding = checks.find(candidate => candidate.id === id)
  if (finding === undefined) throw new Error(`no finding with id ${id}`)
  return finding
}

describe('the rule registry', () => {
  it('has a unique id per rule and produces uniquely identified findings', () => {
    const ruleIds = CHECK_RULES.map(rule => rule.id)
    expect(new Set(ruleIds).size).toBe(ruleIds.length)

    const { checks, suppressed } = real()
    const ids = [...checks, ...suppressed].map(finding => finding.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('pairs state with weight, so a note can never inflate the issue count', () => {
    const { checks } = real()
    for (const finding of checks) {
      if (finding.weight === 'issue') expect(finding.state).toBe('warn')
      if (finding.weight === 'verified') expect(finding.state).toBe('pass')
      if (finding.weight === 'note') expect(finding.state).toBe('pass')
      if (finding.weight === 'absent') expect(finding.state).toBe('absent')
    }
  })

  it('anchors every finding with a builder-produced anchor and a label', () => {
    for (const finding of real().checks) {
      expect(finding.anchor.startsWith('#')).toBe(true)
      expect(finding.anchorLabel.length).toBeGreaterThan(0)
      expect(finding.source.length).toBeGreaterThan(0)
    }
  })
})

describe('the issue count on the captured report', () => {
  it('counts warnings only: seven issues, four of them the generator’s own', () => {
    const { summary } = real()
    // 4 generator warnings (proteomes x3, progress x1) plus 3 kept derived issues: node-type
    // coverage, the artifact-order pair the generator did not describe, and the dirty source tree.
    // The fourth candidate derived issue - proteome-majority-release - stands down for
    // generator-proteomes-1, so it is not among these seven.
    expect(summary.issues).toBe(7)
    expect(summary.generatorIssues).toBe(4)
    expect(summary.derivedIssues).toBe(3)
    // Passing and notable findings are shown in full and counted separately.
    expect(summary.verified).toBe(8)
    expect(summary.notes).toBe(7)
    expect(summary.absent).toBe(0)
  })

  it('names the genuine warnings and nothing else', () => {
    const issues = real()
      .checks.filter(finding => finding.weight === 'issue')
      .map(finding => finding.id)
      .sort()

    expect(issues).toEqual([
      'config.source-dirty',
      'generator.warning:generator-progress-4',
      'generator.warning:generator-proteomes-1',
      'generator.warning:generator-proteomes-2',
      'generator.warning:generator-proteomes-3',
      'nodes.type-coverage',
      'timing.artifact-order:setup-resource-download--organism-dat',
    ])
  })
})

describe('freshness', () => {
  it('reads Current as positive evidence, anchored to the newest artifact’s step', () => {
    const report = getFixtureReport('real')
    const finding = find(runChecks(report).checks, 'freshness.report')

    expect(finding.state).toBe('pass')
    expect(finding.weight).toBe('verified')
    // Appendix A.3: the report is 84.3 h newer than the newest artifact.
    expect(finding.explanation).toContain('84.3h')
    expect(finding.anchor).toBe(stepAnchor(report.freshness.newestArtifactStepId ?? ''))
    expect(finding.evidence.join(' ')).toContain('2026-09-05 05:22:23 UTC')
  })

  it('warns on the stale state instead of passing', () => {
    const finding = find(runChecks(getFixtureReport('stale')).checks, 'freshness.report')
    expect(finding.state).toBe('warn')
    expect(finding.weight).toBe('issue')
  })
})

describe('node-type coverage', () => {
  it('warns on UNKNOWN at 0 of 347, anchored to node forward tracking', () => {
    const finding = find(real().checks, 'nodes.type-coverage')

    expect(finding.state).toBe('warn')
    expect(finding.label).toContain('UNKNOWN')
    // Appendix A.6.
    expect(finding.explanation).toContain('UNKNOWN mapped 0 of 347 nodes')
    expect(finding.explanation).toContain('3,031,716')
    expect(finding.anchor).toBe(reportAnchor('node_tracking'))
    expect(finding.phaseId).toBe('node-forward-tracking')
  })

  it('does not warn about the other four node types, which are all above 83 %', () => {
    const finding = find(real().checks, 'nodes.type-coverage')
    expect(finding.evidence).toEqual([
      'DUPLICATION: 277,511 of 325,035 (85.4 %)',
      'HORIZ_TRANSFER: 4,769 of 5,724 (83.3 %)',
      'LEAF: 1,614,152 of 1,742,145 (92.7 %)',
      'SPECIATION: 914,535 of 958,465 (95.4 %)',
      'UNKNOWN: 0 of 347 (0 %)',
    ])
  })
})

describe('artifact ordering', () => {
  it('reports the pair the generator did not, anchored to the step itself', () => {
    const report = getFixtureReport('real')
    const finding = find(
      runChecks(report).checks,
      'timing.artifact-order:setup-resource-download--organism-dat'
    )

    expect(finding.state).toBe('warn')
    expect(finding.explanation).toContain('organism.dat')
    expect(finding.explanation).toContain('download_resources.touch')
    expect(finding.anchor).toBe(stepAnchor('setup-resource-download--organism-dat'))
    // The two out-of-order pairs of Appendix A.3: one reported here, one by the generator.
    expect(report.timing.outOfOrder).toHaveLength(2)
  })

  it('does not claim a stale artifact, because artifact times are not an execution log', () => {
    const finding = find(
      real().checks,
      'timing.artifact-order:setup-resource-download--organism-dat'
    )
    expect(finding.explanation).toContain('ran concurrently')
  })
})

describe('holes behind the frontier', () => {
  it('records the hole as an observation, not as an issue', () => {
    const finding = find(real().checks, 'pipeline.holes:sequence-to-family-mapping')

    expect(finding.weight).toBe('note')
    expect(finding.state).toBe('pass')
    expect(finding.explanation).toContain('validate_idmapping_step, validate_blast_step')
    expect(finding.explanation).toContain('not where the build stopped')
    expect(finding.anchor).toBe(phaseAnchor('sequence-to-family-mapping'))
  })
})

describe('the source tree and the config ledger', () => {
  it('counts the dirty source tree, anchored to the ledger field', () => {
    const finding = find(real().checks, 'config.source-dirty')

    expect(finding.state).toBe('warn')
    expect(finding.tier).toBe('mismatch')
    expect(finding.anchor).toBe(configAnchor('panther_build_dirty'))
    expect(finding.explanation).toContain('08e5f7104459f448e8222eaa3ea2c85320a8821b')
  })

  it('passes on an empty unresolved_vars, which is positive evidence', () => {
    const finding = find(real().checks, 'config.unresolved-vars')

    expect(finding.state).toBe('pass')
    expect(finding.weight).toBe('verified')
    expect(finding.evidence).toContain('unresolved_vars: []')
  })
})
