import { describe, expect, it } from 'vitest'
import { parseConfigFile, releaseTokenOf } from '@/features/build/model'
import { getFixtureReport } from '@/features/build/fixtures'

/**
 * Appendix A.8 of `.plans/feature/01-report-model.md`: the three configuration tiers.
 *
 * The section carries two views of the same configuration, and both matter. A mismatch finding rests
 * on the literal captured `config.mk` - specifically the commented-out `#export QFO_DATA_DIR=...`
 * line - so commented lines are parsed and kept as evidence rather than skipped. And the release
 * token a value references drives the lineage tier, so it must not fire on a CPU count.
 */

const report = getFixtureReport('real')

describe('parsing the captured config.mk', () => {
  it('separates active exports from commented-out ones, keeping line numbers', () => {
    const parsed = parseConfigFile(
      ['#export A=one', 'export B=two', '  export C = three  ', 'not an export', 'export D='].join(
        '\n'
      )
    )
    expect(parsed.commented).toEqual([
      { key: 'A', value: 'one', origin: 'file', commentedOut: true, line: 1 },
    ])
    expect(parsed.active.map(entry => [entry.key, entry.value, entry.line])).toEqual([
      ['B', 'two', 2],
      ['C', 'three', 3],
      // A declared-but-empty value is a real observation, not a missing one.
      ['D', '', 5],
    ])
  })

  it('returns empty lists rather than throwing when no file was captured', () => {
    expect(parseConfigFile(null)).toEqual({ active: [], commented: [] })
  })

  it('keeps the commented-out QFO_DATA_DIR line, though QFO_RELEASE_VERSION no longer resolves', () => {
    // Pipeline issue #65 retired QFO_RELEASE_VERSION (see
    // panther_build/.specs/2026-08-27-proteome-version-provenance-design.md §8): the config ledger
    // no longer carries it, so there is nothing left to compare the active QFO_DATA_DIR against.
    // The commented-out line is still captured verbatim - parsing it is not conditional on anyone
    // reading it - and `consistency.checks/model/rules/proteomeMajorityRelease.ts` is what reads
    // the per-proteome release provenance that replaced this comparison.
    expect(report.config.commentedEntries).toHaveLength(1)
    expect(report.config.commentedEntries[0]).toMatchObject({
      key: 'QFO_DATA_DIR',
      value: 'QfO_release_2026_02/external_data/qfo_reference_proteome',
      commentedOut: true,
      line: 1,
    })
    expect(report.consistency.qfoDeclaredRelease).toBeNull()
    expect(report.consistency.qfoActiveDataDir).toBe(
      'QfO_release_2026_02_w_select_2026_01/external_data/qfo_reference_proteome'
    )
    expect(report.consistency.qfoReleaseMatchesDataDir).toBeNull()
    expect(report.consistency.qfoCommentedEvidence).toHaveLength(1)
  })

  it('records the declared-but-empty key rather than dropping it', () => {
    expect(report.config.emptyValueKeys).toEqual(['MAFFT_BINARIES'])
  })
})

describe('releaseTokenOf', () => {
  it('prefers an explicit PANTHER token over anything else in the path', () => {
    // Account directories like `huaiyumi_14` would otherwise be read as a release.
    expect(releaseTokenOf('/project2/huaiyumi_14/hm/debert/PANTHER19.0/library_building')).toBe(
      '19'
    )
    expect(
      releaseTokenOf('/project2/pdthomas_136/panther/famlib/dev/UPL/PANTHER17.0/lib_17.0')
    ).toBe('17')
    expect(releaseTokenOf('.../PANTHER18.0/library_building/Protein_Class_18.0')).toBe('18')
  })

  it('falls back to a release-encoding filename', () => {
    expect(releaseTokenOf('all_seqs_19.fasta')).toBe('19')
    expect(releaseTokenOf('pthr19_filtered_blast.fasta')).toBe('19')
    expect(releaseTokenOf('gene_node_19_no_XENTR.dat')).toBe('19')
    expect(releaseTokenOf('sfToSeq_19_XENTR_dropped')).toBe('19')
    expect(releaseTokenOf('/a/b/Pthr_GO_19.0.tsv')).toBe('19')
    expect(releaseTokenOf('20.0')).toBe('20')
  })

  it('does not read a version of something else as a release', () => {
    // Every one of these is a real value in this fixture's config.mk.
    expect(releaseTokenOf('64')).toBeNull()
    expect(releaseTokenOf('36.0')).toBeNull()
    expect(releaseTokenOf('2026_02')).toBeNull()
    expect(releaseTokenOf('3.6.9')).toBeNull()
    expect(releaseTokenOf('009232848')).toBeNull()
    expect(releaseTokenOf('48495')).toBeNull()
    expect(releaseTokenOf('pdthomas_136')).toBeNull()
    expect(releaseTokenOf('config.mk')).toBeNull()
  })
})

describe('the lineage tier', () => {
  it('reads PREV_* as 19.0 and PREV_PREV_* as 17.0, internally consistent', () => {
    expect(report.config.previousLineage).toHaveLength(19)
    expect(new Set(report.config.previousLineage.map(entry => entry.release))).toEqual(
      new Set(['19'])
    )
    expect(report.config.previousPreviousLineage.map(entry => entry.key).sort()).toEqual([
      'PREV_PREV_DEV_LIB',
      'PREV_PREV_NODE_DAT',
    ])
    expect(new Set(report.config.previousPreviousLineage.map(entry => entry.release))).toEqual(
      new Set(['17'])
    )
  })

  it('lists only values that really do reference a release', () => {
    const byKey = new Map(report.config.releaseReferences.map(entry => [entry.key, entry.release]))
    // Notable: Protein Class inputs inherited from PANTHER18.0.
    expect(byKey.get('PC_CLASS')).toBe('18')
    expect(byKey.get('PC_RELATIONSHIP')).toBe('18')
    expect(byKey.get('PTHR_FULLGO_ANNOT_TSV')).toBe('19')
    expect(byKey.get('PTHR_VERSION')).toBe('20')
    // Not a release reference in any sense.
    expect(byKey.has('BLAST_CPUS')).toBe(false)
    expect(byKey.has('PFAM_VERSION')).toBe(false)
    expect(byKey.has('QFO_RELEASE_VERSION')).toBe(false)
    expect([...new Set(byKey.values())].sort()).toEqual(['17', '18', '19', '20'])
  })

  it('keeps the XENTR-dropped previous inputs visible as notable', () => {
    expect(report.config.values.PREV_GENE_NODE_DAT).toBe('gene_node_19_no_XENTR.dat')
    expect(report.config.values.PREV_SF_TO_SEQ).toBe('sfToSeq_19_XENTR_dropped')
  })
})

describe('provenance', () => {
  it('reports the source revision and the dirty tree', () => {
    expect(report.config.sourceRevision).toBe('08e5f7104459f448e8222eaa3ea2c85320a8821b')
    expect(report.config.sourceDirty).toBe(true)
    expect(report.identity.sourceDirty).toBe(true)
  })

  it('reads the config snapshot as taken at build start, not at report time', () => {
    // Appendix A.3: it equals the mtime of the first step's artifact.
    expect(report.config.generatedAt.iso).toBe('2026-09-03T23:07:21.000Z')
    const first = report.pipeline.steps.find(step => step.goal === 'download_resources.touch')
    expect(Math.floor(first?.timing.artifactAt.epochSeconds ?? 0)).toBe(
      report.config.generatedAt.epochSeconds
    )
    // And the report's own generated_at is a different, later instant - which is the whole point
    // of the test: the config was captured when the build started, not when the report was written.
    expect(report.identity.generatedAt.iso).toBe('2026-09-08T17:40:14.000Z')
    expect(report.identity.generatedAt.epochSeconds as number).toBeGreaterThan(
      report.config.generatedAt.epochSeconds as number
    )
  })

  it('reports no unresolved variables, which is positive evidence', () => {
    expect(report.config.unresolvedVars).toEqual([])
    expect(report.consistency.unresolvedVars).toEqual([])
  })
})
