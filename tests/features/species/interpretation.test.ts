import { describe, expect, it } from 'vitest'
import { getFixtureReport } from '@/features/build/fixtures'
import type { BuildReport, SpeciesRecord } from '@/features/build/model'
import { readSpecies, readingContext } from '@/features/species/model/interpretation'
import type { ReadingContext, SpeciesReading } from '@/features/species/model/interpretation'

const reportFor = (key: 'real' | 'missingNodeTracking'): BuildReport => getFixtureReport(key)

const read = (report: BuildReport, oscode: string): SpeciesReading => {
  const record = report.species.byOscode[oscode]
  expect(record, `no joined record for ${oscode}`).toBeDefined()
  return readSpecies(record as SpeciesRecord, readingContext(report))
}

const contextOf = (report: BuildReport): ReadingContext => readingContext(report)

/**
 * The reading is the product here, so these tests read like the acceptance walkthrough: DAPMA's 0 %
 * has to come back EXPLAINED with both corroborating sources named, FELCA's 65 % has to come back
 * NOT EXPLAINED, and a species the truncated tables never mention has to come back with neither.
 */
describe('readSpecies — acceptance question 3', () => {
  const report = reportFor('real')

  it('explains DAPMA’s 0 % instead of flagging it as the worst species', () => {
    const reading = read(report, 'DAPMA')

    expect(reading.kind).toBe('zero-new')
    expect(reading.verdict).toBe('expected')
    expect(reading.confidence).toBe('confirmed')
    expect(reading.headline).toContain('0 % node forward tracking is expected for DAPMA')
    expect(reading.headline).toContain('two independent sources')
    expect(reading.headline).toContain('no previous nodes to track forward')
    expect(reading.headline).toContain('10,544')
  })

  it('names both sources that corroborate DAPMA being new, with their own tables', () => {
    const reading = read(report, 'DAPMA')
    const texts = reading.evidence.map(line => line.text).join(' | ')

    expect(texts).toContain('0 of 10,544 nodes mapped forward')
    expect(texts).toContain('Previous count 0, current count 26,600')
    expect(texts).toContain('26,600 had no previous match at all')

    const tables = reading.evidence.map(line => `${line.sectionId}:${line.tableName ?? ''}`)
    expect(tables).toContain('node_tracking:by_species')
    expect(tables).toContain('other_reports:Sequence counts by species, previous vs new')
    expect(tables).toContain('other_reports:Previous-UniProt-ID match by proteome')
  })

  it('does not explain FELCA away: an established previous proteome at 65 %', () => {
    const reading = read(report, 'FELCA')

    expect(reading.kind).toBe('low-established')
    expect(reading.verdict).toBe('unexplained')
    expect(reading.headline).toContain('64.9 %')
    expect(reading.headline).toContain('17,711')
    expect(reading.headline).toContain('6,211')
    expect(reading.headline).toContain('19,653')
    expect(reading.headline).toContain('19,179')
    expect(reading.headline).toContain('Newness does not explain this one')
  })

  it('leaves PHANO and POPTR unexplained too, so the tail is not uniformly excused', () => {
    for (const oscode of ['PHANO', 'POPTR', 'TOBAC', 'BOVIN']) {
      expect(read(report, oscode).verdict, oscode).toBe('unexplained')
    }
  })

  it('says "unknown" for a species the truncated comparison table never mentions', () => {
    // ECOLI is one of the 131 tracked species and is in neither the 50-row nor the 20-row table.
    const record = report.species.byOscode.ECOLI as SpeciesRecord
    const reading = read(report, 'ECOLI')

    expect(record.counts.present).toBe(false)
    expect(record.uniprot.present).toBe(false)
    expect(record.isNewInBuild).toBe(false)
    expect(reading.headline).not.toContain('new in this build')
    // It tracks 99.9 % forward, so the reading is simply nominal - not a claim of newness.
    expect(reading.verdict).toBe('nominal')
  })

  it('reads a rename receiver as a rename rather than as a new species', () => {
    const reading = read(report, 'MYCMD')

    expect(reading.kind).toBe('renamed-in')
    expect(reading.verdict).toBe('expected')
    expect(reading.headline).toContain('previous count of 0')
    expect(reading.headline).toContain('99.7 %')
    expect(reading.headline).toContain('USTMA')
    expect(reading.headline).toContain('rename rather than an addition')
  })

  it('reads the removed side of a rename as a rename, not a loss', () => {
    const reading = read(report, 'USTMA')

    expect(reading.kind).toBe('removed')
    expect(reading.verdict).toBe('expected')
    expect(reading.headline).toContain('MYCMD')
    expect(reading.headline).toContain('rename rather than a loss')
  })

  it('reads DAPPU as a candidate replacement and never as a rename', () => {
    const reading = read(report, 'DAPPU')

    expect(reading.headline).toContain('DAPMA')
    expect(reading.headline).toContain('candidate replacement rather than a rename')
    expect(reading.caveat).toContain('weaker reading than a rename')
    expect(
      report.species.renames.some(link => link.removed === 'DAPPU' || link.added === 'DAPPU')
    ).toBe(false)
  })

  it('reports the two context tables’ coverage so a reader can scope any claim', () => {
    const context = contextOf(report)

    expect(context.counts.label).toBe('50 of 147 rows')
    expect(context.counts.truncated).toBe(true)
    expect(context.uniprot.label).toBe('20 of 132 rows')
    expect(context.uniprot.truncated).toBe(true)
    expect(context.threshold).toBe(90)
  })
})

describe('readSpecies — stripSection(node_tracking)', () => {
  const report = reportFor('missingNodeTracking')

  it('still reads DAPMA as new from the two remaining sources', () => {
    const reading = read(report, 'DAPMA')

    expect(contextOf(report).trackingAvailable).toBe(false)
    expect(reading.kind).toBe('tracking-absent')
    expect(reading.verdict).toBe('insufficient-evidence')
    expect(reading.headline).toContain('no node forward tracking section')

    const record = report.species.byOscode.DAPMA as SpeciesRecord
    expect(record.isNewInBuild).toBe(true)
    expect(record.newInBuildConfidence).toBe('confirmed')
    expect(reading.evidence.map(line => line.text).join(' | ')).toContain(
      'Previous count 0, current count 26,600'
    )
  })

  it('does not invent a zero rate for a species that lost its tracking row', () => {
    const reading = read(report, 'FELCA')

    expect(reading.headline).not.toContain('0 %')
    expect(reading.verdict).toBe('insufficient-evidence')
  })
})
