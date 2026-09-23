import { describe, expect, it } from 'vitest'
import { getFixtureReport } from '@/features/build/fixtures'
import { parseUsfSidecar } from '@/features/build/model'

/**
 * `parseUsfSidecar` decides whether a fetched sidecar file actually belongs to the report on
 * screen - same `section_id`, `target` and `generated_at` - before trusting a single row out of
 * it. A well-formed sidecar for a DIFFERENT report is not this report's data, no matter how
 * well-formed; a sidecar that fails to parse at all is a distinct failure ("mismatched" vs.
 * "parse-error"), so a reader is told which one happened rather than just "no families".
 */

const report = getFixtureReport('real')
const raw = report.raw as { target: string; generated_at: string }

function sidecarDoc(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    target: raw.target,
    generated_at: raw.generated_at,
    section_id: 'giga_usf',
    data: {
      families: [
        {
          family: 'PTHR10000',
          unplaced: 6,
          tree_leaves: 20,
          unplaced_fraction: 0.2308,
          members: ['HUMAN|HGNC=1|UniProtKB=P00001', 'MOUSE|MGI=MGI=2|UniProtKB=Q00002'],
        },
        {
          family: 'PTHR10001',
          unplaced: 1,
          tree_leaves: 50,
          unplaced_fraction: 0.0196,
          members: ['HUMAN|HGNC=3|UniProtKB=P00003'],
        },
      ],
    },
    ...overrides,
  }
}

describe('parseUsfSidecar', () => {
  it('parses every family row, members inline, when the envelope matches the report', () => {
    const result = parseUsfSidecar(sidecarDoc(), report)
    expect(result.status).toBe('ready')
    expect(result.families).toHaveLength(2)
    expect(result.families[0]).toEqual({
      family: 'PTHR10000',
      unplaced: 6,
      treeLeaves: 20,
      unplacedFraction: 0.2308,
      inputSeqs: null,
      members: ['HUMAN|HGNC=1|UniProtKB=P00001', 'MOUSE|MGI=MGI=2|UniProtKB=Q00002'],
    })
  })

  it('reads input_seqs when a family row carries it, null when it does not', () => {
    const doc = sidecarDoc()
    ;(doc.data.families[0] as Record<string, unknown>).input_seqs = 26
    const result = parseUsfSidecar(doc, report)
    expect(result.families[0].inputSeqs).toBe(26)
    expect(result.families[1].inputSeqs).toBeNull()
  })

  it('never emits members: null - the sidecar contract has no cap', () => {
    const result = parseUsfSidecar(sidecarDoc(), report)
    expect(result.families.every(row => Array.isArray(row.members))).toBe(true)
  })

  it('keeps the families in the order the file gave them (sorting is already done upstream)', () => {
    const result = parseUsfSidecar(sidecarDoc(), report)
    expect(result.families.map(row => row.family)).toEqual(['PTHR10000', 'PTHR10001'])
  })

  it('is mismatched when the target differs', () => {
    const result = parseUsfSidecar(sidecarDoc({ target: 'some_other_target' }), report)
    expect(result.status).toBe('mismatched')
    expect(result.families).toEqual([])
  })

  it('is mismatched when generated_at differs', () => {
    const result = parseUsfSidecar(sidecarDoc({ generated_at: '2099-01-01T00:00:00Z' }), report)
    expect(result.status).toBe('mismatched')
  })

  it('is mismatched when section_id is not giga_usf', () => {
    const result = parseUsfSidecar(sidecarDoc({ section_id: 'giga' }), report)
    expect(result.status).toBe('mismatched')
  })

  it('is a parse error when the payload is not an object', () => {
    expect(parseUsfSidecar('not json', report)).toEqual({ status: 'parse-error', families: [] })
    expect(parseUsfSidecar(null, report)).toEqual({ status: 'parse-error', families: [] })
    expect(parseUsfSidecar([1, 2, 3], report)).toEqual({ status: 'parse-error', families: [] })
  })

  it('is a parse error when the envelope has no target/generated_at/section_id to check', () => {
    const result = parseUsfSidecar({ data: { families: [] } }, report)
    expect(result.status).toBe('parse-error')
  })

  it('is a parse error when the envelope matches but data.families is unreadable', () => {
    const result = parseUsfSidecar(sidecarDoc({ data: 'oops' }), report)
    expect(result.status).toBe('parse-error')
  })

  it('skips a family row with no family id or count rather than failing the whole file', () => {
    const doc = sidecarDoc()
    ;(doc.data.families as unknown[]).unshift({ unplaced: 3 })
    const result = parseUsfSidecar(doc, report)
    expect(result.status).toBe('ready')
    expect(result.families).toHaveLength(2)
  })

  it('does not treat a family named "constructor" as having members via the prototype chain', () => {
    const doc = sidecarDoc()
    ;(doc.data.families as unknown[]).unshift({
      family: 'constructor',
      unplaced: 1,
      members: ['HUMAN|HGNC=9|UniProtKB=P00009'],
    })
    const result = parseUsfSidecar(doc, report)
    expect(result.families.find(row => row.family === 'constructor')?.members).toEqual([
      'HUMAN|HGNC=9|UniProtKB=P00009',
    ])
  })
})
