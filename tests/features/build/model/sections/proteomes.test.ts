import { describe, expect, it } from 'vitest'
import { createNoteSink, extractProteomes, toSectionInput } from '@/features/build/model'
import type { RawSection } from '@/features/build/model'
import { getFixtureReport } from '@/features/build/fixtures'

/**
 * Per-proteome source provenance (pipeline issue #65).
 *
 * Before #65 a build recorded one QfO release for the whole library, and that was never true: the
 * QfO and Reference Proteome releases routinely differ, and a hand-swapped species can come from a
 * third. `RP_taxonomy_organism_lib.txt` carries the truth per proteome, so these tests pin the two
 * readings a single header line cannot express - the release composition, and which proteomes sit
 * off their source's majority release.
 */

const ROSTER_COLUMNS = [
  'up',
  'oscode',
  'taxid',
  'name',
  'source',
  'version',
  'prev_up',
  'prev_source',
  'prev_version',
  'change',
]

function rosterTable(rows: Record<string, unknown>[], extra: Record<string, unknown> = {}) {
  return {
    name: 'Reference proteomes',
    columns: ROSTER_COLUMNS,
    rows,
    truncated: false,
    total_rows: rows.length,
    ...extra,
  }
}

function sectionOf(data: unknown, overrides: Record<string, unknown> = {}) {
  return toSectionInput(
    {
      id: 'proteomes',
      title: 'Reference proteomes',
      status: 'ok',
      data,
      ...overrides,
    } as RawSection,
    1
  )
}

describe('release composition', () => {
  it('groups the roster by source and release, marking the off-majority bucket', () => {
    const summary = extractProteomes(
      sectionOf({
        tables: [
          rosterTable([
            { oscode: 'MOUSE', source: 'QfO', version: '2026_02' },
            { oscode: 'HUMAN', source: 'QfO', version: '2026_02' },
            { oscode: 'CAEBR', source: 'RefProt', version: '2026_02' },
            { oscode: 'DANRE', source: 'RefProt', version: '2026_02' },
            { oscode: 'ARATH', source: 'RefProt', version: '2026_01' },
          ]),
        ],
      }),
      createNoteSink()
    )

    expect(summary.composition).toEqual([
      { source: 'QfO', release: '2026_02', count: 2, isSourceMajority: true },
      { source: 'RefProt', release: '2026_02', count: 2, isSourceMajority: true },
      { source: 'RefProt', release: '2026_01', count: 1, isSourceMajority: false },
    ])
    expect(summary.offMajorityCount).toBe(1)
  })

  it('claims no majority for a source whose releases tie, rather than picking one', () => {
    const summary = extractProteomes(
      sectionOf({
        tables: [
          rosterTable([
            { oscode: 'ARATH', source: 'RefProt', version: '2026_01' },
            { oscode: 'BOVIN', source: 'RefProt', version: '2026_02' },
          ]),
        ],
      }),
      createNoteSink()
    )

    expect(summary.composition.map(bucket => bucket.isSourceMajority)).toEqual([false, false])
    // Nothing is "off the majority" when there is no majority to be off from.
    expect(summary.offMajorityCount).toBe(0)
  })

  it('falls back to the generator bucket metrics when the roster is truncated', () => {
    const summary = extractProteomes(
      sectionOf({
        rows: [
          { metric: 'proteomes_total', value: 131 },
          { metric: 'QfO 2026_02', value: 67 },
          { metric: 'RefProt 2026_01', value: 24 },
          { metric: 'RefProt 2026_02', value: 40 },
        ],
        tables: [
          rosterTable([{ oscode: 'MOUSE', source: 'QfO', version: '2026_02' }], {
            truncated: true,
            total_rows: 131,
          }),
        ],
      }),
      createNoteSink()
    )

    // Counting a subset would report 1 QfO proteome for a 131-proteome library.
    expect(summary.composition).toEqual([
      { source: 'QfO', release: '2026_02', count: 67, isSourceMajority: true },
      { source: 'RefProt', release: '2026_02', count: 40, isSourceMajority: true },
      { source: 'RefProt', release: '2026_01', count: 24, isSourceMajority: false },
    ])
    expect(summary.roster.truncation.truncated).toBe(true)
  })

  it('labels the composition for a header that can no longer name one release', () => {
    const summary = extractProteomes(
      sectionOf({
        tables: [
          rosterTable([
            { oscode: 'MOUSE', source: 'QfO', version: '2026_02' },
            { oscode: 'ARATH', source: 'RefProt', version: '2026_01' },
          ]),
        ],
      }),
      createNoteSink()
    )

    expect(summary.compositionLabel).toBe('QfO 2026_02 (1) · RefProt 2026_01 (1)')
  })
})

describe('what the previous roster can support', () => {
  it('reports the previous roster as unstamped when no row names a previous source', () => {
    const summary = extractProteomes(
      sectionOf({
        tables: [
          rosterTable([
            { oscode: 'MOUSE', source: 'QfO', version: '2026_02', prev_up: 'UP000000589' },
            { oscode: 'ARATH', source: 'RefProt', version: '2026_01', prev_up: 'UP000006548' },
          ]),
        ],
      }),
      createNoteSink()
    )

    // A pre-#65 roster has no source/release columns, so `version_changed: 0` means
    // "not measurable", not "nothing moved". The view has to be able to say which.
    expect(summary.previousRosterStamped).toBe(false)
  })

  it('reports it as stamped when a carried-over proteome names its previous source', () => {
    const summary = extractProteomes(
      sectionOf({
        tables: [
          rosterTable([
            { oscode: 'MOUSE', source: 'QfO', version: '2026_02', prev_up: '', prev_source: '' },
            {
              oscode: 'ARATH',
              source: 'RefProt',
              version: '2026_01',
              prev_up: 'UP000006548',
              prev_source: 'RefProt',
              prev_version: '2026_01',
            },
          ]),
        ],
      }),
      createNoteSink()
    )

    expect(summary.previousRosterStamped).toBe(true)
  })
})

describe('change categories', () => {
  it('reads each category from the headline metrics', () => {
    const summary = extractProteomes(
      sectionOf({
        rows: [
          { metric: 'proteomes_total', value: 131 },
          { metric: 'proteomes_new', value: 2 },
          { metric: 'proteomes_up_changed', value: 8 },
          { metric: 'proteomes_source_changed', value: 0 },
          { metric: 'proteomes_version_changed', value: 0 },
          { metric: 'proteomes_same_up', value: 121 },
          { metric: 'proteomes_unchanged', value: 0 },
          { metric: 'proteomes_dropped', value: 15 },
        ],
      }),
      createNoteSink()
    )

    expect(summary.total).toBe(131)
    expect(summary.changeCounts).toEqual({
      new: 2,
      upChanged: 8,
      sourceChanged: 0,
      versionChanged: 0,
      sameUp: 121,
      unchanged: 0,
      dropped: 15,
    })
  })
})

describe('degraded sections', () => {
  it('returns an empty but valid summary when the generator reported the section absent', () => {
    const summary = extractProteomes(
      sectionOf(null, { status: 'absent', message: 'inputs not present yet' }),
      createNoteSink()
    )

    expect(summary.availability).toBe('absent')
    expect(summary.message).toBe('inputs not present yet')
    expect(summary.composition).toEqual([])
    expect(summary.compositionLabel).toBeNull()
    expect(summary.total).toBeNull()
    expect(summary.roster.rows).toEqual([])
  })

  it('survives a payload that is a string rather than an object', () => {
    const summary = extractProteomes(sectionOf('not a record'), createNoteSink())

    expect(summary.composition).toEqual([])
    expect(summary.total).toBeNull()
  })
})

describe('on the captured report', () => {
  const report = getFixtureReport('real')

  it('reads 131 proteomes across three source and release buckets', () => {
    expect(report.proteomes.total).toBe(131)
    expect(report.proteomes.composition).toEqual([
      { source: 'QfO', release: '2026_02', count: 67, isSourceMajority: true },
      { source: 'RefProt', release: '2026_02', count: 40, isSourceMajority: true },
      { source: 'RefProt', release: '2026_01', count: 24, isSourceMajority: false },
    ])
    expect(report.proteomes.offMajorityCount).toBe(24)
    expect(report.proteomes.previousRosterStamped).toBe(false)
    expect(report.proteomes.dropped.rows).toHaveLength(15)
    expect(report.proteomes.warnings).toHaveLength(3)
  })

  it('is a known section bound to the phase that downloads the proteomes', () => {
    const entry = report.reports.find(item => item.sectionId === 'proteomes')

    expect(entry?.known).toBe(true)
    expect(entry?.placement).toBe('phase')
    expect(entry?.phaseIds).toContain('setup-resource-download')
  })
})
