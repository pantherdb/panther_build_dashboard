import { describe, expect, it } from 'vitest'
import { createNoteSink, extractUnplacedFragments, toSectionInput } from '@/features/build/model'
import type { RawSection } from '@/features/build/model'
import { getFixtureReport } from '@/features/build/fixtures'
import { gigaUsfPayload } from '@/features/build/fixtures/transforms'

const sectionOf = (data: unknown, overrides: Partial<RawSection> = {}) =>
  toSectionInput(
    { id: 'giga_usf', title: 'Unplaced fragments', status: 'ok', data, ...overrides } as RawSection,
    1
  )

const extract = (data: unknown, overrides: Partial<RawSection> = {}) =>
  extractUnplacedFragments(sectionOf(data, overrides), createNoteSink())

describe('extractUnplacedFragments', () => {
  it('reads the headline', () => {
    const summary = extract(gigaUsfPayload())
    expect(summary.familiesWithUnplaced).toBe(3)
    expect(summary.unplacedTotal).toBe(9)
    expect(summary.unassignedInMapping).toBe(9)
    expect(summary.membersTruncated).toBe(true)
  })

  it('joins each family row to its members, null where the report left them out', () => {
    const byFamily = new Map(extract(gigaUsfPayload()).families.map(row => [row.family, row]))
    expect(byFamily.get('PTHR10001')?.members).toEqual(['HUMAN|HGNC=7|UniProtKB=P00007'])
    expect(byFamily.get('PTHR10000')?.members).toBeNull()
  })

  it('does not treat a family named "constructor" as having members via the prototype chain', () => {
    const payload = gigaUsfPayload()
    const [families, species] = payload.tables as Array<Record<string, unknown>>
    const withPrototypeFamily = {
      ...families,
      rows: [{ family: 'constructor', unplaced: 1 }, ...(families.rows as unknown[])],
    }
    const summary = extract({ ...payload, tables: [withPrototypeFamily, species] })
    expect(summary.families.find(row => row.family === 'constructor')?.members).toBeNull()
  })

  it('keeps an unmeasured fraction null, not zero', () => {
    const row = extract(gigaUsfPayload()).families.find(entry => entry.family === 'PTHR10002')
    expect(row?.treeLeaves).toBeNull()
    expect(row?.unplacedFraction).toBeNull()
  })

  it('reads the species table by name, not position', () => {
    const payload = gigaUsfPayload()
    const tables = [
      { name: 'Something new', columns: [], rows: [] },
      ...(payload.tables as unknown[]),
    ]
    expect(extract({ ...payload, tables }).bySpecies.map(row => row.oscode)).toEqual([
      'HUMAN',
      'MOUSE',
    ])
  })

  it('is absent, not zero, when the section is absent', () => {
    const summary = extract(null, { status: 'absent', message: 'inputs not present yet' })
    expect(summary.familiesWithUnplaced).toBeNull()
    expect(summary.families).toEqual([])
    expect(summary.availability).toBe('absent')
    expect(summary.inputMismatchFamilies).toBeNull()
  })

  it('skips a family row without a family id and says so', () => {
    const payload = gigaUsfPayload()
    const [families, species] = payload.tables as Array<Record<string, unknown>>
    const bad = { ...families, rows: [{ unplaced: 3 }, ...(families.rows as unknown[])] }
    const sink = createNoteSink()
    const summary = extractUnplacedFragments(
      sectionOf({ ...payload, tables: [bad, species] }),
      sink
    )
    expect(summary.families).toHaveLength(3)
  })

  it('is on the report under the gigaUsf fixture state, and absent on the real one', () => {
    expect(getFixtureReport('gigaUsf').unplacedFragments.familiesWithUnplaced).toBe(3)
    expect(getFixtureReport('real').unplacedFragments.availability).toBe('absent')
  })

  describe('the sidecar reference (new contract)', () => {
    it('is null on the old in-report shape', () => {
      expect(extract(gigaUsfPayload()).sidecar).toBeNull()
    })

    it('reads file, bytes and sha256 when the section carries a sidecar reference', () => {
      const payload = {
        ...gigaUsfPayload(),
        sidecar: { file: 'build_state.giga_usf.json', bytes: 683, sha256: 'abc123' },
      }
      expect(extract(payload).sidecar).toEqual({
        file: 'build_state.giga_usf.json',
        bytes: 683,
        sha256: 'abc123',
      })
    })

    it('is null rather than a half-built object when the reference has no file name', () => {
      const payload = { ...gigaUsfPayload(), sidecar: { bytes: 683, sha256: 'abc123' } }
      expect(extract(payload).sidecar).toBeNull()
    })

    it('reads bytes/sha256 as null, not throwing, when they are missing', () => {
      const payload = { ...gigaUsfPayload(), sidecar: { file: 'build_state.giga_usf.json' } }
      expect(extract(payload).sidecar).toEqual({
        file: 'build_state.giga_usf.json',
        bytes: null,
        sha256: null,
      })
    })

    it('has an empty family list on a main report using the new contract (no family table)', () => {
      const summary = extract({
        text: '1 book had sequences GIGA could not place.',
        headline: {
          books_scanned: 1,
          families_with_unplaced: 1,
          unplaced_total: 4,
          unassigned_in_mapping: 4,
        },
        tables: [
          {
            name: 'Unplaced fragments by species',
            columns: ['oscode', 'unplaced', 'families'],
            rows: [{ oscode: 'HUMAN', unplaced: 4, families: 1 }],
            truncated: false,
            total_rows: 1,
          },
        ],
        sidecar: { file: 'build_state.giga_usf.json', bytes: 200, sha256: 'deadbeef' },
        warnings: [],
      })
      expect(summary.families).toEqual([])
      expect(summary.sidecar?.file).toBe('build_state.giga_usf.json')
      expect(summary.bySpecies.map(row => row.oscode)).toEqual(['HUMAN'])
    })

    it('is on the report under the gigaUsfSidecar fixture state, referencing the frozen fixture file', () => {
      const summary = getFixtureReport('gigaUsfSidecar').unplacedFragments
      expect(summary.familiesWithUnplaced).toBe(2)
      expect(summary.families).toEqual([]) // old-shape reading finds no family table - by design
      expect(summary.sidecar).toEqual({
        file: 'build_state.giga_usf.json',
        bytes: 512,
        sha256: 'fixture-sha256',
      })
    })
  })

  describe('input_seqs on a family row (pipeline issue: proteome/input counts)', () => {
    it('is null on the old in-report shape, which never carries the field', () => {
      const row = extract(gigaUsfPayload()).families.find(entry => entry.family === 'PTHR10000')
      expect(row?.inputSeqs).toBeNull()
    })

    it('reads input_seqs when a family row carries it', () => {
      const payload = gigaUsfPayload()
      const [families, species] = payload.tables as Array<Record<string, unknown>>
      const withInputSeqs = {
        ...families,
        rows: (families.rows as Record<string, unknown>[]).map(row =>
          row.family === 'PTHR10000' ? { ...row, input_seqs: 24 } : row
        ),
      }
      const row = extract({ ...payload, tables: [withInputSeqs, species] }).families.find(
        entry => entry.family === 'PTHR10000'
      )
      expect(row?.inputSeqs).toBe(24)
    })
  })

  describe('the headline input_mismatch_families (pipeline issue: proteome/input counts)', () => {
    it('is null when the report headline does not carry it', () => {
      expect(extract(gigaUsfPayload()).inputMismatchFamilies).toBeNull()
    })

    it('reads it as an integer when present', () => {
      const payload = gigaUsfPayload()
      const summary = extract({
        ...payload,
        headline: { ...payload.headline, input_mismatch_families: 3 },
      })
      expect(summary.inputMismatchFamilies).toBe(3)
    })
  })

  describe('the "Unplaced fragments by proteome" table (pipeline issue: proteome/input counts)', () => {
    const proteomeTablePayload = () => {
      const payload = gigaUsfPayload()
      const [families] = payload.tables as Array<Record<string, unknown>>
      return {
        ...payload,
        tables: [
          families,
          {
            name: 'Unplaced fragments by proteome',
            columns: [
              'oscode',
              'proteome_seqs',
              'giga_input_seqs',
              'unplaced',
              'families',
              'unplaced_pct_of_proteome',
              'unplaced_pct_of_giga_input',
            ],
            rows: [
              {
                oscode: 'HUMAN',
                proteome_seqs: 20000,
                giga_input_seqs: 19000,
                unplaced: 4,
                families: 3,
                unplaced_pct_of_proteome: 0.02,
                unplaced_pct_of_giga_input: 0.021,
              },
              {
                oscode: 'DANRE',
                proteome_seqs: 15000,
                giga_input_seqs: 14000,
                unplaced: 0,
                families: 0,
                unplaced_pct_of_proteome: 0,
                unplaced_pct_of_giga_input: 0,
              },
            ],
            truncated: false,
            total_rows: 2,
          },
        ],
      }
    }

    it('reads every new field when the proteome table is present', () => {
      const bySpecies = extract(proteomeTablePayload()).bySpecies
      expect(bySpecies).toEqual([
        {
          oscode: 'HUMAN',
          unplaced: 4,
          families: 3,
          proteomeSeqs: 20000,
          gigaInputSeqs: 19000,
          unplacedPctOfProteome: 0.02,
          unplacedPctOfGigaInput: 0.021,
        },
        {
          oscode: 'DANRE',
          unplaced: 0,
          families: 0,
          proteomeSeqs: 15000,
          gigaInputSeqs: 14000,
          unplacedPctOfProteome: 0,
          unplacedPctOfGigaInput: 0,
        },
      ])
    })

    it('includes a zero-unplaced oscode rather than dropping it', () => {
      const bySpecies = extract(proteomeTablePayload()).bySpecies
      expect(bySpecies.find(row => row.oscode === 'DANRE')?.unplaced).toBe(0)
    })

    it('prefers the proteome table over the old species table when both are present', () => {
      const payload = proteomeTablePayload()
      const withSpeciesToo = {
        ...payload,
        tables: [
          ...payload.tables,
          {
            name: 'Unplaced fragments by species',
            columns: ['oscode', 'unplaced', 'families'],
            rows: [{ oscode: 'MOUSE', unplaced: 99, families: 99 }],
            truncated: false,
            total_rows: 1,
          },
        ],
      }
      const bySpecies = extract(withSpeciesToo).bySpecies
      expect(bySpecies.map(row => row.oscode)).toEqual(['HUMAN', 'DANRE'])
    })

    it('falls back to the old "Unplaced fragments by species" table when no proteome table exists, leaving the new fields null', () => {
      const bySpecies = extract(gigaUsfPayload()).bySpecies
      expect(bySpecies).toEqual([
        {
          oscode: 'HUMAN',
          unplaced: 4,
          families: 3,
          proteomeSeqs: null,
          gigaInputSeqs: null,
          unplacedPctOfProteome: null,
          unplacedPctOfGigaInput: null,
        },
        {
          oscode: 'MOUSE',
          unplaced: 5,
          families: 1,
          proteomeSeqs: null,
          gigaInputSeqs: null,
          unplacedPctOfProteome: null,
          unplacedPctOfGigaInput: null,
        },
      ])
    })
  })
})
