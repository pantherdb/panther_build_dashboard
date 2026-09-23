/**
 * The PANTHER long id, `ORGCODE|source=ID|UniProtKB=ACCESSION`, split for display.
 *
 * Split on the FIRST `=` of each field, not every one: MGI gene ids carry their own `=`
 * (`MGI=MGI=1914945`), and a naive split loses the id's prefix. Anything that does not look
 * like a long id keeps its raw text and gets nulls, so a malformed line still shows.
 */
export interface LongId {
  raw: string
  oscode: string | null
  geneSource: string | null
  geneId: string | null
  accession: string | null
}

function splitField(field: string | undefined): [string, string] | null {
  if (!field) return null
  const at = field.indexOf('=')
  return at < 0 ? null : [field.slice(0, at), field.slice(at + 1)]
}

export function parseLongId(raw: string): LongId {
  const [org, gene, uniprot] = raw.split('|')
  const geneField = splitField(gene)
  const uniprotField = splitField(uniprot)
  return {
    raw,
    oscode: org || null,
    geneSource: geneField?.[0] ?? null,
    geneId: geneField?.[1] ?? null,
    accession: uniprotField && uniprotField[0] === 'UniProtKB' ? uniprotField[1] : null,
  }
}

export const uniprotUrl = (accession: string): string =>
  `https://www.uniprot.org/uniprotkb/${encodeURIComponent(accession)}/entry`
