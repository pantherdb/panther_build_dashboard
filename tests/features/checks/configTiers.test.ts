import { describe, expect, it } from 'vitest'
import { buildStateSource, getFixtureReport, stripSection } from '@/features/build/fixtures'
import { configAnchor, parseBuildState, reportAnchor } from '@/features/build/model'
import { runChecks } from '@/features/checks/model'
import type { CheckFinding } from '@/features/checks/model'

/**
 * Appendix A.8 - the three configuration tiers.
 *
 * The failure this file exists to prevent is recorded in the plan's Failed Approaches: flagging every
 * value that references an older release produces about twenty-five findings on this config and
 * buries the one real mismatch. So the assertions are as much about what does NOT warn as about
 * what does.
 */

const run = (key: 'real' | 'warning' = 'real') => runChecks(getFixtureReport(key))

const find = (checks: readonly CheckFinding[], id: string): CheckFinding => {
  const finding = checks.find(candidate => candidate.id === id)
  if (finding === undefined) throw new Error(`no finding with id ${id}`)
  return finding
}

/**
 * The `proteomes` section's own warnings removed, but its roster tables left intact. Isolates what
 * the dashboard computes on its own from what the generator's warning also happens to say, so a
 * test against this state cannot pass by the derived finding standing down in favour of the
 * generator's copy.
 */
function withoutProteomeWarnings() {
  const state = JSON.parse(JSON.stringify(buildStateSource)) as typeof buildStateSource
  const sections = (state as { sections: { id?: string; data?: { warnings?: unknown } }[] }).sections
  const section = sections.find(entry => entry.id === 'proteomes')
  if (section?.data !== undefined) section.data.warnings = []
  return parseBuildState(state)
}

describe('mismatch tier', () => {
  it('holds only the one counted configuration finding', () => {
    const mismatches = run()
      .byTier.mismatch.map(finding => finding.id)
      .sort()
    expect(mismatches).toEqual(['config.source-dirty'])
  })
})

describe('proteome release against its source majority', () => {
  // Replaces `config.qfo-release`, the old mismatch tier's one real finding. QFO_RELEASE_VERSION
  // was retired by pipeline issue #65 (see
  // panther_build/.specs/2026-08-27-proteome-version-provenance-design.md §8) and QFO_DATA_DIR no
  // longer disagrees with anything there is left to declare, so there is nothing left to compare.
  // The report now stamps a source and release per proteome instead, and the comparable fact is
  // which proteomes are not on their source's majority release - not a config-tier finding, so it
  // carries no `tier` and sits in the `consistency` category instead of `config`.

  it('computes 24 off-majority proteomes from the roster rows, independent of the generator’s own wording', () => {
    const finding = find(
      runChecks(withoutProteomeWarnings()).checks,
      'consistency.proteome-majority-release'
    )

    expect(finding.state).toBe('warn')
    expect(finding.weight).toBe('issue')
    expect(finding.tier).toBeNull()
    expect(finding.label).toBe("24 proteomes are off their source's majority release")
    expect(finding.explanation).toContain(
      "24 of 131 stamped proteomes are not on the release most of their source's roster came from"
    )
    expect(finding.explanation).toContain(
      'Deliberate for a hand-swapped proteome; otherwise a stamping error'
    )
    expect(finding.anchor).toBe(reportAnchor('proteomes'))

    // The generator's own warning names only the first eight strays and elides the rest; the
    // dashboard's evidence, computed straight from the roster rows, names every one of the 24.
    const named = finding.evidence.filter(line => line.includes('(majority 2026_02)'))
    expect(named).toHaveLength(24)
    expect(finding.evidence).toContain('QfO 2026_02: 67 (majority)')
    expect(finding.evidence).toContain('RefProt 2026_02: 40 (majority)')
    expect(finding.evidence).toContain('RefProt 2026_01: 24 (off majority)')
    expect(finding.evidence).toContain('ARATH: RefProt 2026_01 (majority 2026_02)')
  })

  it('is superseded by the generator’s own warning naming the same source and majority release', () => {
    const result = run()

    expect(
      result.checks.some(finding => finding.id === 'consistency.proteome-majority-release')
    ).toBe(false)
    const stoodDown = result.suppressed.find(
      finding => finding.id === 'consistency.proteome-majority-release'
    )
    expect(stoodDown?.state).toBe('warn')
    expect(stoodDown?.supersededBy).toBe('generator.warning:generator-proteomes-1')

    // The generator's message survives verbatim, and names the same source and majority release
    // the derived finding's `evidenceTokens` rest on.
    const generator = find(result.checks, 'generator.warning:generator-proteomes-1')
    expect(generator.explanation).toContain(
      "24 proteome(s) are not on their source's majority release"
    )
    expect(generator.explanation).toContain('RefProt 2026_01, majority 2026_02')
    expect(generator.origin).toBe('generator')
  })

  it('degrades to absent when the roster carries no per-proteome source/release stamp', () => {
    const report = parseBuildState(stripSection('proteomes')(buildStateSource))
    const finding = find(runChecks(report).checks, 'consistency.proteome-majority-release')

    expect(finding.state).toBe('absent')
    expect(finding.weight).toBe('absent')
    expect(finding.absentReason).toBe('inputs-missing')
  })
})

describe('lineage tier', () => {
  it('passes on the PREV_* set instead of flagging its nineteen 19.0 references', () => {
    const finding = find(run().checks, 'config.lineage')

    expect(finding.state).toBe('pass')
    expect(finding.weight).toBe('verified')
    expect(finding.tier).toBe('lineage')
    expect(finding.label).toBe('Previous-release lineage is consistent at PANTHER19.0')
    expect(finding.explanation).toContain('19 PREV_* variables consistently reference PANTHER19.0')
    expect(finding.explanation).toContain('2 PREV_PREV_* variables reference PANTHER17.0')
    expect(finding.explanation).toContain('does not count as an issue')
  })

  it('notes that 18.0 would be the naive expectation without calling 17.0 an error', () => {
    const finding = find(run().checks, 'config.lineage')

    expect(finding.explanation).toContain('PANTHER18.0 would be the naive expectation')
    expect(finding.explanation).toContain('deliberate choice of an older baseline')
    expect(finding.state).not.toBe('warn')
  })

  it('produces no warning for any of the twenty-one lineage variables', () => {
    const report = getFixtureReport('real')
    const lineageKeys = [
      ...report.config.previousLineage.map(entry => entry.key),
      ...report.config.previousPreviousLineage.map(entry => entry.key),
    ]
    expect(lineageKeys).toHaveLength(21)

    // Scoped to findings this dashboard derives, not to every generator warning that happens to
    // land on a PREV_* key. The `proteomes` section's own second warning ("the previous roster
    // predates issue #65") literally names PREV_RP_TAX_TXT - one of the 21 - and is correctly
    // anchored to it by the generic generator-warning anchoring in anchoring.ts, but that is a
    // genuine data-staleness warning from the generator, not the "flags every 19.0 reference"
    // failure mode this test guards against, which is specific to the derived lineage rule.
    const warnedKeys = run()
      .checks.filter(
        finding =>
          finding.origin === 'dashboard' && finding.weight === 'issue' && finding.configKey !== null
      )
      .map(finding => finding.configKey)

    for (const key of lineageKeys) expect(warnedKeys).not.toContain(key)
  })
})

describe('notable tier', () => {
  it('is exactly the six values Appendix A.8 names, and none of them is a warning', () => {
    const notable = run().byTier.notable
    expect(notable.map(finding => finding.configKey)).toEqual([
      'PC_CLASS',
      'PC_RELATIONSHIP',
      'PTHR_FULLGO_ANNOT_TSV',
      'PREV_GENE_NODE_DAT',
      'PREV_SF_TO_SEQ',
      'MAFFT_BINARIES',
    ])
    for (const finding of notable) {
      expect(finding.weight).toBe('note')
      expect(finding.state).toBe('pass')
      expect(finding.anchor).toBe(configAnchor(finding.configKey ?? ''))
      // Each carries a sentence, not a label: the point is to explain it years later.
      expect(finding.explanation.length).toBeGreaterThan(80)
    }
  })

  it('explains the Protein Class inheritance from PANTHER18.0', () => {
    const finding = find(run().checks, 'config.notable:PC_CLASS')
    expect(finding.label).toBe('PC_CLASS is inherited from PANTHER18.0')
    expect(finding.explanation).toContain('curated infrequently')
    expect(finding.evidence[0]).toContain('PANTHER18.0/library_building/Protein_Class_18.0')
  })

  it('explains the annotation input whose filename encodes 19.0', () => {
    const finding = find(run().checks, 'config.notable:PTHR_FULLGO_ANNOT_TSV')
    expect(finding.label).toBe('PTHR_FULLGO_ANNOT_TSV names release 19 in its filename')
    expect(finding.evidence[1]).toBe('Filename encodes release 19: Pthr_GO_19.0.tsv.')
  })

  it('reads the XENTR drop from the two inputs that name it, and links them', () => {
    const geneNode = find(run().checks, 'config.notable:PREV_GENE_NODE_DAT')
    const sfToSeq = find(run().checks, 'config.notable:PREV_SF_TO_SEQ')

    expect(geneNode.label).toBe('PREV_GENE_NODE_DAT excludes XENTR')
    expect(geneNode.oscode).toBe('XENTR')
    expect(geneNode.explanation).toContain('PREV_SF_TO_SEQ names the same oscode')
    expect(sfToSeq.explanation).toContain('PREV_GENE_NODE_DAT names the same oscode')
  })

  it('reports MAFFT_BINARIES as declared-but-empty, naming the sibling that is set', () => {
    const finding = find(run().checks, 'config.notable:MAFFT_BINARIES')
    expect(finding.label).toBe('MAFFT_BINARIES is declared but empty')
    expect(finding.evidence[0]).toBe('MAFFT_BINARIES=(empty)')
    expect(finding.explanation).toContain('MAFFT_PATH does carry a value')
  })
})

// The old "generator's own configuration warning" block tested `config.qfo-release` being
// superseded by a synthetic QFO_RELEASE_VERSION warning on the `warning` fixture state. That
// premise is gone along with the rule; the equivalent case for what replaced it -
// `consistency.proteome-majority-release` standing down for the generator's own proteomes
// warning - is covered above, on the real report, where the same warning already occurs.
