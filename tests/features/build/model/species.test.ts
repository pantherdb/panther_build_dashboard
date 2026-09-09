import { describe, expect, it } from 'vitest'
import {
  createNoteSink,
  detectSpeciesLinks,
  isAggregateOscode,
  REPLACEMENT_COUNT_TOLERANCE,
  REPLACEMENT_PREFIX_LENGTH,
} from '@/features/build/model'
import type { SpeciesCountChange } from '@/features/build/model'
import { getFixtureReport } from '@/features/build/fixtures'

/**
 * The species cross-section join, and the rename-detection rule from the Failed Approaches table in
 * `.plans/feature/01-report-model.md`.
 *
 * Rename detection requires an EXACT count match. A 10 % tolerance produces seven candidate pairs
 * on this fixture of which five are nonsense - it pairs CITSI, ERYGU and AMBTC with DAPMA, and
 * cross-pairs USTMA/CRYD1 and CRYNJ/MYCMD. Replacement is therefore a separate, lower-confidence
 * category, and the tests below encode both the rule and the reason for it.
 */

const report = getFixtureReport('real')

function change(
  oscode: string,
  previous: number | null,
  current: number | null
): SpeciesCountChange {
  return {
    oscode,
    previousCount: previous,
    currentCount: current,
    countDiff: previous === null || current === null ? null : current - previous,
    fractionChange: null,
    percentChange: null,
    reportedPctChange: null,
    isRemoval: previous !== null && previous > 0 && current === 0,
    isAddition: previous === 0 && current !== null && current > 0,
  }
}

describe('detectSpeciesLinks', () => {
  it('claims a rename only on an exact count match', () => {
    const { renames, replacements } = detectSpeciesLinks([
      change('USTMA', 6788, 0),
      change('MYCMD', 0, 6788),
    ])
    expect(renames).toHaveLength(1)
    expect(renames[0]).toMatchObject({
      kind: 'rename',
      removed: 'USTMA',
      added: 'MYCMD',
      countDelta: 0,
      confidence: 'exact',
    })
    expect(replacements).toEqual([])
  })

  it('refuses a near-miss that a 10 % tolerance would have accepted', () => {
    // AMBTC 27,327 -> 0 against DAPMA 0 -> 26,600 is 2.7 % apart and biologically unrelated.
    const { renames, replacements } = detectSpeciesLinks([
      change('AMBTC', 27327, 0),
      change('DAPMA', 0, 26600),
    ])
    expect(renames).toEqual([])
    // Different genus prefixes, so it is not even a replacement candidate.
    expect(replacements).toEqual([])
  })

  it('leaves an ambiguous count unpaired rather than guessing', () => {
    const sink = createNoteSink()
    const { renames } = detectSpeciesLinks(
      [change('AAAAA', 1000, 0), change('BBBBB', 1000, 0), change('CCCCC', 0, 1000)],
      sink
    )
    expect(renames).toEqual([])
    expect(sink.notes.some(note => note.message.includes('ambiguous'))).toBe(true)
  })

  it('calls a same-genus near match a replacement, at lower confidence', () => {
    const { renames, replacements } = detectSpeciesLinks([
      change('DAPPU', 30118, 0),
      change('DAPMA', 0, 26600),
    ])
    expect(renames).toEqual([])
    expect(replacements).toHaveLength(1)
    expect(replacements[0]).toMatchObject({
      kind: 'replacement',
      removed: 'DAPPU',
      added: 'DAPMA',
      confidence: 'likely',
      countDelta: -3518,
    })
    expect(replacements[0].evidence.join(' ')).toContain('same genus')
  })

  it('rejects a same-genus pair too far apart in size', () => {
    const outside = Math.ceil(10000 * (1 - REPLACEMENT_COUNT_TOLERANCE)) - 1
    const { replacements } = detectSpeciesLinks([
      change('DAPPU', 10000, 0),
      change('DAPMA', 0, outside),
    ])
    expect(replacements).toEqual([])
  })

  it('does not let one addition absorb several removals', () => {
    const { replacements } = detectSpeciesLinks([
      change('DAPPU', 10000, 0),
      change('DAPXX', 10100, 0),
      change('DAPMA', 0, 10050),
    ])
    expect(replacements).toHaveLength(1)
    expect(replacements[0].removed).toBe('DAPXX')
  })

  it('uses a three-character oscode prefix as its genus signal', () => {
    expect(REPLACEMENT_PREFIX_LENGTH).toBe(3)
    const { replacements } = detectSpeciesLinks([
      change('CRYNJ', 6604, 0),
      change('CRYD1', 0, 6600),
    ])
    expect(replacements).toHaveLength(1)
  })

  it('ignores a removal or addition with no usable count', () => {
    const { renames, replacements } = detectSpeciesLinks([
      change('AAAAA', null, 0),
      change('BBBBB', 0, null),
    ])
    expect(renames).toEqual([])
    expect(replacements).toEqual([])
  })
})

describe('aggregate rows are not species', () => {
  it('recognises the labels a report may use for a total', () => {
    expect(isAggregateOscode('TOTAL')).toBe(true)
    expect(isAggregateOscode(' total ')).toBe(true)
    expect(isAggregateOscode('ALL')).toBe(true)
    expect(isAggregateOscode('HUMAN')).toBe(false)
  })

  it('keeps the UniProt TOTAL row out of the join but available as a total', () => {
    expect(report.species.records.some(record => record.oscode === 'TOTAL')).toBe(false)
    expect(report.comparison.uniprotTotals?.sameUniprot).toBe(2028319)
    expect(report.ingestNotes.some(note => note.message.includes('aggregate row'))).toBe(true)
  })
})

describe('the joined record', () => {
  it('tags every field with the section it came from and whether it was present', () => {
    const dapma = report.species.byOscode.DAPMA
    expect(dapma.nodeTracking.origin).toMatchObject({
      sectionId: 'node_tracking',
      tableName: 'by_species',
      present: true,
      truncated: false,
    })
    expect(dapma.counts.origin).toMatchObject({
      sectionId: 'other_reports',
      present: true,
      truncated: true,
    })
    expect(dapma.uniprot.origin.truncated).toBe(true)
  })

  it('says which sources do not cover a species, and why that means unknown', () => {
    const human = report.species.byOscode.HUMAN
    expect(human.counts.present).toBe(true)
    expect(human.uniprot.present).toBe(false)
    expect(human.uniprot.value).toBeNull()
    expect(human.missingFrom.join(' ')).toContain('truncated, so absence means unknown')
  })

  it('covers exactly the 147 species the report says exist across both releases', () => {
    // 131 in this library plus the 16 removals inside the truncated count table.
    expect(report.species.oscodeCount).toBe(147)
    expect(report.species.oscodeCount).toBe(report.otherReports.values.species_total)
    expect(report.species.removedOscodes).toHaveLength(16)
  })

  it('reports the join as partial while any contributing table is truncated', () => {
    expect(report.species.availability).toBe('partial')
    expect(report.species.notes.join(' ')).toContain('not zero')
  })

  it('links a removed species to the oscode that replaced it, in both directions', () => {
    expect(report.species.byOscode.USTMA.renamedTo).toBe('MYCMD')
    expect(report.species.byOscode.MYCMD.renameOf).toBe('USTMA')
    expect(report.species.byOscode.MYCMD.links.map(link => link.kind)).toEqual(['rename'])
    expect(report.species.byOscode.DAPMA.links.map(link => link.kind)).toEqual(['replacement'])
  })

  it('explains a rename-linked addition rather than calling it a new species outright', () => {
    expect(report.species.byOscode.MYCMD.evidence.join(' ')).toContain(
      'rather than a genuinely new'
    )
  })
})

describe('the node-tracking species table is leaf-scoped', () => {
  it('sums to the LEAF node totals, not to the all-node headline', () => {
    const mapped = report.nodeTracking.bySpecies.reduce(
      (total, species) => total + (species.mapped ?? 0),
      0
    )
    const total = report.nodeTracking.bySpecies.reduce(
      (sum, species) => sum + (species.total ?? 0),
      0
    )
    const leaf = report.nodeTracking.byType.find(entry => entry.nodeType === 'LEAF')
    expect(mapped).toBe(leaf?.mapped)
    expect(total).toBe(leaf?.total)
    // Which is why it does not add up to the 2,830,262 / 3,026,743 headline.
    expect(mapped).not.toBe(report.nodeTracking.nodesMapped)
  })
})
