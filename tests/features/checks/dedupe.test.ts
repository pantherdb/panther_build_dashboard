import { describe, expect, it } from 'vitest'
import { getFixtureReport } from '@/features/build/fixtures'
import { stepAnchor } from '@/features/build/model'
import { runChecks } from '@/features/checks/model'

/**
 * Deduplication against the generator's own warnings.
 *
 * The fixture has two out-of-order artifact pairs and the generator warned about one of them. Both
 * appearing as findings would double-count the same evidence and inflate the issue number a
 * reviewer reads; dropping the generator's copy would edit the report. So the generator's message
 * survives and the dashboard's duplicate stands down, visibly.
 */

describe('the stale-artifact finding', () => {
  const result = () => runChecks(getFixtureReport('real'))

  it('is reported once, by the generator', () => {
    const { checks } = result()
    const ordering = checks.filter(finding => finding.ruleId === 'timing.artifact-order')

    expect(ordering).toHaveLength(1)
    expect(ordering[0].id).toBe('timing.artifact-order:setup-resource-download--organism-dat')

    // 4 generator warnings now reach the checks layer (proteomes x3, progress x1); only the
    // progress one describes this stale-artifact pair.
    const generator = checks.filter(finding => finding.origin === 'generator')
    expect(generator).toHaveLength(4)
    const staleArtifact = generator.find(
      finding => finding.id === 'generator.warning:generator-progress-4'
    )
    expect(staleArtifact?.explanation).toContain('PANTHER20.0_HMM_classifications is older than')
  })

  it('keeps the suppressed derived copy, pointing at what superseded it', () => {
    const { suppressed, summary } = result()

    // 2 suppressed now: this artifact-order pair, and the derived proteome-majority-release
    // finding standing down for generator-proteomes-1 (Appendix A.8/configTiers.test.ts).
    expect(summary.suppressed).toBe(2)
    const artifactPair = suppressed.find(finding => finding.ruleId === 'timing.artifact-order')
    expect(artifactPair?.id).toBe(
      'timing.artifact-order:library-export-products--ftp-panther-hmm-classification-files-panther20-0-hmm-classifications'
    )
    expect(artifactPair?.supersededBy).toBe('generator.warning:generator-progress-4')
    expect(artifactPair?.origin).toBe('dashboard')
  })

  it('records on the generator finding that the dashboard agreed independently', () => {
    const generator = result().checks.find(finding => finding.origin === 'generator')
    expect(generator?.evidence.join(' ')).toContain('reached the same finding independently')
  })

  it('anchors the generator message to the step goal it names, not to its section', () => {
    const generator = result().checks.find(
      finding => finding.id === 'generator.warning:generator-progress-4'
    )

    expect(generator?.anchor).toBe(
      stepAnchor(
        'library-export-products--ftp-panther-hmm-classification-files-panther20-0-hmm-classifications'
      )
    )
    expect(generator?.stepId).not.toBeNull()
    expect(generator?.phaseId).toBe('library-export-products')
    expect(generator?.evidence[0]).toContain('step goal named in the message')
  })
})

describe('generator warnings across the warning state', () => {
  const result = () => runChecks(getFixtureReport('warning'))

  it('turns every warning string into a generator-sourced finding', () => {
    const { checks } = result()
    const generator = checks.filter(finding => finding.origin === 'generator')

    // 4 pre-existing (proteomes x3, progress x1) plus 3 synthetic (progress, node_tracking,
    // config_ledger) that `toWarning()` appends on top of them.
    expect(generator).toHaveLength(7)
    for (const finding of generator) {
      expect(finding.state).toBe('warn')
      expect(finding.weight).toBe('issue')
      expect(finding.explanation.length).toBeGreaterThan(0)
      expect(finding.source).toMatch(/^sections\[.+\]\.warnings\[\]$/)
    }
  })

  it('anchors by step goal, config key and section, saying which was matched', () => {
    const { checks } = result()
    const byId = new Map(checks.map(finding => [finding.id, finding]))

    // Warning ids number sequentially across all sections in report order (config_ledger,
    // proteomes, progress, ...), so the synthetic step-goal warning `toWarning()` appends to
    // `progress` lands after the 3 proteomes warnings and the pre-existing stale-artifact one.
    const step = byId.get('generator.warning:generator-progress-6')
    expect(step?.stepId).toBe('sequence-to-family-mapping--refproteomepanthermapping-updated-hmm')
    expect(step?.evidence[0]).toContain('step goal')

    // `config_ledger` is processed first, so its synthetic warning keeps id 1 regardless of what
    // is appended later. QFO_RELEASE_VERSION was retired (Appendix A.8), so `toWarning()` now
    // names SPECIES_TREE, a config key that still exists, instead.
    const config = byId.get('generator.warning:generator-config_ledger-1')
    expect(config?.configKey).toBe('SPECIES_TREE')
    expect(config?.evidence[0]).toContain('configuration key')

    // The node-tracking warning names no entity, so it stays on its section and says so.
    const section = byId.get('generator.warning:generator-node_tracking-7')
    expect(section?.anchor).toBe('#report--node-tracking')
    expect(section?.evidence[0]).toContain('anchored to the section that emitted it')
  })

  it('suppresses both derived findings the generator already described', () => {
    const { suppressed } = result()
    // `config.qfo-release` no longer exists; its replacement, `consistency.proteome-majority-
    // release`, stands down for generator-proteomes-2 (config_ledger's synthetic warning now
    // occupies slot 1) the same way it does on the real report (configTiers.test.ts).
    expect(suppressed.map(finding => finding.id).sort()).toEqual([
      'consistency.proteome-majority-release',
      'timing.artifact-order:library-export-products--ftp-panther-hmm-classification-files-panther20-0-hmm-classifications',
    ])
  })
})
