import { describe, expect, it } from 'vitest'
import { getFixtureReport } from '@/features/build/fixtures'
import { reportAnchor } from '@/features/build/model'
import { runChecks } from '@/features/checks/model'
import type { CheckFinding } from '@/features/checks/model'

/**
 * Appendix A.7 - the checks that PASS, with their real numbers.
 *
 * These are the reason the layer shows passing checks at all: on this report the positive findings
 * are the strongest evidence the build is sound. An exact leaf/library agreement and a four-way
 * family agreement are not decoration, they are what a release reviewer is looking for, and a
 * regression that quietly turned one of them into "absent" would remove the evidence while leaving
 * the page looking healthy.
 */

const checks = (): CheckFinding[] => runChecks(getFixtureReport('real')).checks

const find = (id: string): CheckFinding => {
  const finding = checks().find(candidate => candidate.id === id)
  if (finding === undefined) throw new Error(`no finding with id ${id}`)
  return finding
}

describe('A.7 leaf/library agreement', () => {
  it('passes with both totals at 1,742,145 exactly', () => {
    const finding = find('consistency.leaf-library')

    expect(finding.state).toBe('pass')
    expect(finding.weight).toBe('verified')
    expect(finding.label).toBe('LEAF node total matches library sequences exactly')
    expect(finding.explanation).toContain('1,742,145')
    expect(finding.evidence).toEqual([
      'LEAF nodes: 1,742,145 (node_tracking.by_type[LEAF].total)',
      'Library sequences: 1,742,145 (library.sequences)',
    ])
    expect(finding.anchor).toBe(reportAnchor('node_tracking'))
  })
})

describe('A.7 four-way family agreement', () => {
  it('passes at 15,795 across the final mapping stage, library, books and trees', () => {
    const finding = find('consistency.family-agreement')

    expect(finding.state).toBe('pass')
    expect(finding.label).toBe('Family counts agree across 4 sources')
    expect(finding.explanation).toContain('15,795')
    expect(finding.evidence.slice(0, 4)).toEqual([
      'Final mapping stage: 15,795 (mapping.rows[stage=post_giga].n_families)',
      'Library: 15,795 (library.families)',
      'GIGA books: 15,795 (giga.books_total)',
      'Trees succeeded: 15,795 (giga.trees_succeeded)',
    ])
  })

  it('explains reclustering at 15,834 instead of flagging it', () => {
    const finding = find('consistency.family-agreement')

    // 39 higher, and the reason is stage order: trimming runs after reclustering.
    expect(finding.explanation).toContain('Reclustering reports 15,834, 39 higher')
    expect(finding.explanation).toContain('expected rather than a disagreement')
    expect(finding.explanation).toContain('pass1_trim')
    expect(finding.evidence).toContain(
      'Reclustering stage (recluster): 15,834 — mapping.rows[stage=recluster].n_families'
    )
    // It is not a warning, and it does not become one by being mentioned.
    expect(finding.weight).toBe('verified')
  })
})

describe('A.7 tree completeness', () => {
  it('passes at 15,795 of 15,795 with 0 empty', () => {
    const finding = find('consistency.tree-completeness')

    expect(finding.state).toBe('pass')
    expect(finding.explanation).toBe(
      '15,795 of 15,795 books have a non-empty tree and 0 came back empty. Nothing was lost ' +
        'between family assignment and tree building.'
    )
    expect(finding.anchor).toBe(reportAnchor('giga'))
  })
})

describe('the species denominators', () => {
  it('passes at 131 three ways and explains the 147 rather than warning', () => {
    const finding = find('consistency.species-denominator')

    expect(finding.state).toBe('pass')
    expect(finding.label).toBe('Species counts agree at 131')
    expect(finding.explanation).toContain('147')
    expect(finding.explanation).toContain('different denominator rather than a discrepancy')
    expect(finding.evidence).toContain(
      'Species across both releases: 147 (other_reports.species_total)'
    )
  })
})

describe('sequence terminology', () => {
  it('passes with all six counts named by concept, none of them "Sequences"', () => {
    const finding = find('terminology.sequence-counts')

    expect(finding.state).toBe('pass')
    expect(finding.label).toBe('6 sequence counts, 6 distinct values')
    // Appendix A.4, in order, each labelled from the metric definitions registry.
    expect(finding.evidence).toEqual([
      'Previous-library reference sequences: 2,692,827 (other_reports.prev_lib_sequences)',
      'Reference-proteome input sequences: 2,298,433 (mapping.rows[0].total_seqs)',
      'Sequences at the final mapping stage: 2,292,530 (mapping.rows[stage=post_giga].total_seqs)',
      'Sequences assigned to a family: 1,813,607 (mapping.rows[stage=post_giga].assigned)',
      'Sequences in the built library: 1,742,145 (library.sequences)',
      'LEAF nodes mapped forward: 1,614,152 (node_tracking.by_type[LEAF].mapped)',
    ])
    for (const line of finding.evidence) {
      expect(line.split(':')[0]).not.toBe('Sequences')
    }
  })
})

describe('every passing finding', () => {
  it('is derived by the dashboard and states where its numbers came from', () => {
    for (const finding of checks().filter(candidate => candidate.weight === 'verified')) {
      expect(finding.origin).toBe('dashboard')
      expect(finding.source.length).toBeGreaterThan(0)
    }
  })
})
