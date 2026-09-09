import { describe, expect, it } from 'vitest'
import { getFixtureReport } from '@/features/build/fixtures'
import { buildSearchIndex, searchEntries } from '@/features/search/model/searchIndex'
import type { SearchEntryKind } from '@/features/search/model/searchIndex'

/**
 * The index's scope and its ranking.
 *
 * The counts are asserted because scope is the design decision: 62 steps and 14 phases alone make a
 * nav box, and it is the 131 tracked species, the 59 configuration variables and the findings that
 * make the palette the fastest route to a fact. If a later change quietly stops indexing the config,
 * these numbers are what notices.
 */

const index = buildSearchIndex(getFixtureReport('real'))

const first = (query: string, kind?: SearchEntryKind) => {
  const { hits } = searchEntries(index, query)
  const match = kind === undefined ? hits[0] : hits.find(hit => hit.entry.kind === kind)
  expect(match, `no ${kind ?? 'result'} for "${query}"`).toBeDefined()
  return match!.entry
}

describe('index composition', () => {
  it('covers the declared pipeline: 14 phases and 62 steps (Appendix A.1)', () => {
    expect(index.countsByKind.phase).toBe(14)
    expect(index.countsByKind.step).toBe(62)
  })

  it('covers all nine report sections (Appendix A.1)', () => {
    expect(index.countsByKind.report).toBe(9)
  })

  it('covers every species any source mentions, not only the 131 tracked ones', () => {
    // Appendix A.6: node forward tracking reports 131 species. Appendix A.10: the comparison table
    // covers 147 across both releases, of which 50 rows are included. The join is the union.
    expect(index.countsByKind.species).toBe(147)
  })

  it('covers the ~59 configuration variables (Appendix A.8)', () => {
    expect(index.countsByKind.config).toBe(59)
  })

  it('covers the generator warning and the dashboard-derived facts', () => {
    // Four generator warnings in this report (three from proteomes, one stale-artifact warning on
    // progress), plus six derived consistency facts.
    expect(index.countsByKind.check).toBe(10)
    const origins = index.entries.filter(entry => entry.kind === 'check').map(e => e.origin)
    expect(origins.filter(origin => origin === 'generator')).toHaveLength(4)
    expect(origins.filter(origin => origin === 'derived')).toHaveLength(6)
  })

  it('gives every entry a unique id and a hash anchor', () => {
    const ids = index.entries.map(entry => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const entry of index.entries) {
      expect(entry.route).toMatch(/^\/build#[a-z0-9-]+--/)
      expect(entry.route.endsWith(entry.elementId)).toBe(true)
    }
  })
})

describe('finding things', () => {
  it('finds a step by its goal', () => {
    const entry = first('validate_blast', 'step')
    expect(entry.title).toBe('validate_blast_step')
    expect(entry.detail).toContain('Sequence-to-family mapping')
    expect(entry.elementId).toBe('step--sequence-to-family-mapping--validate-blast-step')
  })

  it('finds a species by oscode, with the context that explains its 0 %', () => {
    // Acceptance question 3: DAPMA is new in this build, so 0 % forward tracking is expected.
    const entry = first('DAPMA', 'species')
    expect(entry.title).toBe('DAPMA')
    expect(entry.detail).toContain('0.0% node forward tracking')
    expect(entry.detail).toContain('new in this build')
    expect(entry.oscode).toBe('DAPMA')
  })

  it('finds a rename pair from either side (acceptance question 4)', () => {
    const removed = first('USTMA', 'species')
    expect(removed.detail).toContain('renamed to MYCMD')
    const added = first('MYCMD', 'species')
    expect(added.detail).toContain('renamed from USTMA')
  })

  it('finds a configuration variable and shows its value', () => {
    const entry = first('QFO_DATA_DIR', 'config')
    expect(entry.title).toBe('QFO_DATA_DIR')
    // QFO_DATA_DIR now points at the 2026_02 release path (the ref_prot_2026_01 mismatch this
    // used to demonstrate no longer exists in the data - see Appendix A.8).
    expect(entry.detail).toContain('QfO_release_2026_02')
    expect(entry.elementId).toBe('config--qfo-data-dir')
  })

  it('finds a configuration variable that only exists in the captured config.mk', () => {
    const entry = first('MAFFT_BINARIES', 'config')
    expect(entry.detail).toContain('declared with an empty value')
    // No row of its own in the ledger, so it lands on the section that carries the file.
    expect(entry.elementId).toBe('report--config-ledger')
  })

  it('finds the generator warning and lands it on the step it names', () => {
    const entry = first('possibly stale', 'check')
    expect(entry.origin).toBe('generator')
    expect(entry.elementId).toMatch(/^step--library-export-products--/)
  })

  it('finds a dashboard-derived fact and states it as a fact, not a verdict', () => {
    const entry = first('family count', 'check')
    expect(entry.origin).toBe('derived')
    // Appendix A.7: four sources agree at 15,795.
    expect(entry.detail).toContain('15,795')
    expect(entry.detail).toContain('derived by the dashboard')
    expect(entry.detail).not.toMatch(/\bpass\b|\bwarn\b/)
  })

  it('finds a report section by id as well as by title', () => {
    expect(first('node_tracking', 'report').title).toBe('Node forward tracking')
    expect(first('Tree building', 'report').title).toBe('Tree building (GIGA)')
  })

  it('lands a section that is never mounted under its own id on the phase that carries it', () => {
    // other_reports shares a renderer with prev_lib, which the spine de-duplicates.
    const entry = index.entries.find(candidate => candidate.id === 'report:other_reports')
    expect(entry?.elementId).toBe('phase--previous-library-rebuild')
    expect(entry?.detail).toContain('shown with the phase that carries it')

    // progress IS the spine rather than a report hanging from it.
    const progress = index.entries.find(candidate => candidate.id === 'report:progress')
    expect(progress?.elementId).toMatch(/^phase--/)
  })
})

describe('ranking and matching', () => {
  it('prefers a match on the name over a match on the context', () => {
    const { hits } = searchEntries(index, 'DAPMA')
    expect(hits[0].entry.kind).toBe('species')
    expect(hits[0].entry.title).toBe('DAPMA')
  })

  it('requires every token, so two words narrow rather than widen', () => {
    const one = searchEntries(index, 'library').total
    const two = searchEntries(index, 'library export').total
    expect(two).toBeLessThan(one)
    expect(two).toBeGreaterThan(0)
  })

  it('is case-insensitive', () => {
    expect(searchEntries(index, 'dapma').total).toBe(searchEntries(index, 'DAPMA').total)
  })

  it('returns nothing for an empty query and nothing for an unmatched one', () => {
    expect(searchEntries(index, '   ').hits).toEqual([])
    expect(searchEntries(index, 'zzzznotinthisreport').hits).toEqual([])
  })

  it('caps the result list while still reporting the full total', () => {
    const { hits, total } = searchEntries(index, 'e', 10)
    expect(hits).toHaveLength(10)
    expect(total).toBeGreaterThan(10)
  })
})

describe('degraded reports', () => {
  it('indexes an unrecognised section like any other', () => {
    const unknown = buildSearchIndex(getFixtureReport('unknownSection'))
    const { hits } = searchEntries(unknown, 'Pfam')
    expect(hits.some(hit => hit.entry.title === 'Pfam domain coverage')).toBe(true)
    expect(unknown.countsByKind.report).toBe(11)
  })

  it('drops a derived fact whose evidence section was stripped, rather than linking to nothing', () => {
    const stripped = buildSearchIndex(getFixtureReport('missingNodeTracking'))
    const ids = stripped.entries.map(entry => entry.id)
    expect(ids).not.toContain('check:derived-leaf-library-agreement')
    expect(ids).toContain('check:derived-family-agreement')
  })

  it('still builds an index when a section carries an unrecognised status', () => {
    const unknownStatus = buildSearchIndex(getFixtureReport('unknownStatus'))
    const entry = unknownStatus.entries.find(item => item.id === 'report:node_tracking')
    expect(entry?.detail).toContain('Unknown status: degraded')
  })
})
