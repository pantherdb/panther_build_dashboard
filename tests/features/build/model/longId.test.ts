import { describe, expect, it } from 'vitest'
import { parseLongId, uniprotUrl } from '@/features/build/model/longId'

describe('parseLongId', () => {
  it('splits the three fields of a PANTHER long id', () => {
    expect(parseLongId('HUMAN|HGNC=1084|UniProtKB=Q12983')).toEqual({
      raw: 'HUMAN|HGNC=1084|UniProtKB=Q12983',
      oscode: 'HUMAN',
      geneSource: 'HGNC',
      geneId: '1084',
      accession: 'Q12983',
    })
  })

  it('keeps an = inside the gene id (MGI ids carry one)', () => {
    const id = parseLongId('MOUSE|MGI=MGI=1914945|UniProtKB=Q99LX8')
    expect(id.geneSource).toBe('MGI')
    expect(id.geneId).toBe('MGI=1914945')
  })

  it('degrades to nulls on something that is not a long id, keeping the raw text', () => {
    expect(parseLongId('garbage')).toEqual({
      raw: 'garbage',
      oscode: 'garbage',
      geneSource: null,
      geneId: null,
      accession: null,
    })
  })

  it('does not invent an accession when the UniProtKB field is missing', () => {
    expect(parseLongId('HUMAN|HGNC=1').accession).toBeNull()
  })

  it('links an accession to UniProt', () => {
    expect(uniprotUrl('Q12983')).toBe('https://www.uniprot.org/uniprotkb/Q12983/entry')
  })
})
