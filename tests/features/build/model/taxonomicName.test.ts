import { describe, expect, it } from 'vitest'
import { humaniseTaxonomicName, taxonomicNameByOscode } from '@/features/build/model'
import type { ProteomeRosterRow } from '@/features/build/model'

/**
 * The roster stores names lowercase with underscores ("homo_sapiens",
 * "fusobacterium_nucleatum_subsp._nucleatum") - `create_taxonomy.pl`'s own convention. Only the
 * first letter is capitalised; a subspecies qualifier keeps its own casing and punctuation rather
 * than being title-cased into nonsense.
 */

const row = (overrides: Partial<ProteomeRosterRow> = {}): ProteomeRosterRow => ({
  up: null,
  oscode: null,
  taxid: null,
  name: null,
  source: null,
  version: null,
  prevUp: null,
  prevSource: null,
  prevVersion: null,
  change: null,
  ...overrides,
})

describe('humaniseTaxonomicName', () => {
  it('replaces underscores with spaces and capitalises only the first letter', () => {
    expect(humaniseTaxonomicName('homo_sapiens')).toBe('Homo sapiens')
  })

  it('keeps a subspecies qualifier verbatim, punctuation and casing included', () => {
    expect(humaniseTaxonomicName('fusobacterium_nucleatum_subsp._nucleatum')).toBe(
      'Fusobacterium nucleatum subsp. nucleatum'
    )
  })

  it('keeps a pv. qualifier verbatim', () => {
    expect(humaniseTaxonomicName('xanthomonas_campestris_pv._campestris')).toBe(
      'Xanthomonas campestris pv. campestris'
    )
  })

  it('is the identity on an empty string, not a thrown error', () => {
    expect(humaniseTaxonomicName('')).toBe('')
  })
})

describe('taxonomicNameByOscode', () => {
  it('maps oscode to the humanised name', () => {
    const map = taxonomicNameByOscode([row({ oscode: 'HUMAN', name: 'homo_sapiens' })])
    expect(map.get('HUMAN')).toBe('Homo sapiens')
  })

  it('skips a row with no oscode or no name - there is nothing to key or show either way', () => {
    const map = taxonomicNameByOscode([
      row({ oscode: null, name: 'homo_sapiens' }),
      row({ oscode: 'MOUSE', name: null }),
    ])
    expect(map.size).toBe(0)
  })

  it('is empty for an empty roster', () => {
    expect(taxonomicNameByOscode([]).size).toBe(0)
  })
})
