import { describe, expect, it } from 'vitest'
import { getFixtureReport } from '@/features/build/fixtures'
import { parseBuildState } from '@/features/build/model'
import type { ReportRegistryEntry } from '@/features/build/model'
import {
  isNamedVariableKey,
  readGenericSection,
  resolveMetricId,
  variableAnchorIds,
} from '@/features/reports/model/genericView'

/**
 * The structural reading, exercised against payload shapes the report is allowed to contain but
 * this fixture does not: a `data` that is null, an array, a scalar, or an object of keys nobody has
 * ever seen. A future generator will emit at least one of these, and the alternative to handling
 * them is a blank panel that reads as "nothing here".
 */

const stateWith = (...sections: Record<string, unknown>[]) => ({
  schema_version: 1,
  target: 'target',
  generated_at: '2026-08-20T23:26:31Z',
  sections,
})

function entryFor(section: Record<string, unknown>): ReportRegistryEntry {
  const report = parseBuildState(stateWith(section))
  const entry = report.reports.find(item => item.sectionId === section.id)
  if (entry === undefined) throw new Error(`no registry entry for ${String(section.id)}`)
  return entry
}

function realEntry(sectionId: string): ReportRegistryEntry {
  const entry = getFixtureReport('real').reports.find(item => item.sectionId === sectionId)
  if (entry === undefined) throw new Error(`no ${sectionId} in the real fixture`)
  return entry
}

/** A section with the given id and `data` payload, read through the real parse path. */
function entryWith(sectionId: string, data: Record<string, unknown>): ReportRegistryEntry {
  return entryFor({ id: sectionId, status: 'ok', data })
}

describe('readGenericSection', () => {
  it('reads a null payload as empty rather than throwing or inventing zeros', () => {
    const reading = readGenericSection(entryFor({ id: 'future_null', status: 'ok', data: null }))

    expect(reading.isEmpty).toBe(true)
    expect(reading.headline).toEqual([])
    expect(reading.tables).toEqual([])
    expect(reading.payloadTable).toBeNull()
    expect(reading.payloadScalar).toBeNull()
  })

  it('reads an array payload as a table instead of discarding it', () => {
    const reading = readGenericSection(
      entryFor({
        id: 'future_array',
        status: 'ok',
        data: [
          { pfam_id: 'PF00069', sequences: 41203 },
          { pfam_id: 'PF00005', sequences: 28714 },
        ],
      })
    )

    expect(reading.payloadTable?.rows).toHaveLength(2)
    expect(reading.payloadTable?.columns).toEqual(['pfam_id', 'sequences'])
    expect(reading.isEmpty).toBe(false)
  })

  it('keeps a scalar payload verbatim', () => {
    const reading = readGenericSection(
      entryFor({ id: 'future_scalar', status: 'ok', data: 'nothing to report this run' })
    )

    expect(reading.payloadScalar?.formatted).toBe('nothing to report this run')
  })

  it('preserves every data key it did not consume, including nested ones', () => {
    const reading = readGenericSection(
      entryFor({
        id: 'future_keys',
        status: 'ok',
        data: {
          headline: { trees_scored: 15797 },
          record_count: 3,
          provenance: { tool: 'hmmer', version: '3.4' },
          empty_block: {},
        },
      })
    )

    const paths = reading.preserved.map(field => field.path)
    expect(paths).toContain('record_count')
    expect(paths).toContain('provenance.tool')
    expect(paths).toContain('provenance.version')
    expect(paths).toContain('empty_block')
    expect(reading.headline.map(field => field.key)).toEqual(['trees_scored'])
  })

  it('preserves the configuration ledger’s resolved block, which the model’s own extra drops', () => {
    const entry = realEntry('config_ledger')
    const reading = readGenericSection(entry)
    const paths = reading.preserved.map(field => field.path)

    expect(Object.keys(entry.generic.extra)).not.toContain('current')
    expect(paths).toContain('current.QFO_DATA_DIR')
    expect(paths).toContain('current.config_file_contents')
    expect(paths).toContain('record_count')
  })

  it('does not preserve the generator-definitions map as raw fields, since the tooltip already renders it', () => {
    // Regression for the second consumed-keys list drifting from the model's `GENERIC_DATA_KEYS`:
    // every section carrying `definitions` was dumping its whole vocabulary back onto the page as
    // `definitions.<term>` "preserved fields" - the same prose `DefinedTerm`'s tooltip already shows.
    const reading = readGenericSection(
      entryFor({
        id: 'future_definitions',
        status: 'ok',
        data: {
          headline: { total: 4 },
          definitions: {
            new_family: { label: 'Became a new family', definition: 'Minted a new PANTHER id.' },
          },
        },
      })
    )

    const paths = reading.preserved.map(field => field.path)
    expect(paths.some(path => path.startsWith('definitions'))).toBe(false)
  })

  it('reads a section carrying only text', () => {
    const reading = readGenericSection(
      entryFor({ id: 'future_text', status: 'ok', data: { text: 'One line of prose.' } })
    )

    expect(reading.text).toBe('One line of prose.')
    expect(reading.textIsBlock).toBe(false)
    expect(reading.isEmpty).toBe(false)
  })

  it('treats multi-line text as a captured snapshot rather than prose', () => {
    const reading = readGenericSection(realEntry('config_ledger'))
    expect(reading.textIsBlock).toBe(true)
  })

  it('carries the ragged-row COUNT and the truncation totals through to the view', () => {
    // Appendix A.10: UniRules gaining in more than one family is 20 of 808 with ragged_rows 808.
    const reading = readGenericSection(realEntry('other_reports'))
    const uniRules = reading.tables.find(table => table.name.startsWith('UniRules'))

    expect(uniRules?.includedRows).toBe(20)
    expect(uniRules?.totalRows).toBe(808)
    expect(uniRules?.raggedRows).toBe(808)

    const speciesCounts = reading.tables.find(table => table.name.startsWith('Sequence counts'))
    expect(speciesCounts?.includedRows).toBe(50)
    expect(speciesCounts?.totalRows).toBe(147)
  })

  it('does not restate a headline value as a row as well', () => {
    // library carries genomes/sequences/families/subfamilies in BOTH headline and rows.
    const reading = readGenericSection(realEntry('library'))

    expect(reading.headline.map(field => field.key)).toEqual([
      'genomes',
      'sequences',
      'families',
      'subfamilies',
    ])
    expect(reading.rows).toEqual([])
  })
})

describe('resolveMetricId', () => {
  it('resolves an other_reports key through the model’s own mapping', () => {
    expect(resolveMetricId('prev_lib_sequences')).toBe('prevLibSequences')
  })

  it('resolves a key through the registry’s declared source path for that section', () => {
    expect(resolveMetricId('sequences', 'library')).toBe('librarySequences')
    expect(resolveMetricId('books_total', 'giga')).toBe('booksTotal')
  })

  it('refuses to resolve a bare ambiguous key with no section context', () => {
    expect(resolveMetricId('sequences')).toBeNull()
  })

  it('refuses to guess where two definitions claim one section-and-key', () => {
    // mapping.rows[stage=id].total_seqs and mapping.rows[stage=post_giga].total_seqs both end in
    // total_seqs; picking either would label one of the six sequence counts as another.
    expect(resolveMetricId('total_seqs', 'mapping')).toBeNull()
  })

  it('leaves an unfamiliar future key unresolved rather than inventing a label', () => {
    expect(resolveMetricId('sequences_with_domain', 'pfam_coverage')).toBeNull()
    expect(resolveMetricId('median_support', 'tree_quality')).toBeNull()
  })
})

describe('named variables and anchors', () => {
  it('recognises a SHOUTY_CASE key as a variable name', () => {
    expect(isNamedVariableKey('QFO_DATA_DIR')).toBe(true)
    expect(isNamedVariableKey('PTHR_VERSION')).toBe(true)
    expect(isNamedVariableKey('sequences')).toBe(false)
    expect(isNamedVariableKey('generated_at')).toBe(false)
  })

  it('anchors each configuration variable exactly once, though two blocks carry it', () => {
    const reading = readGenericSection(realEntry('config_ledger'))
    const ids = variableAnchorIds(reading)
    const values = Object.values(ids)

    expect(values).toContain('config--qfo-data-dir')
    expect(new Set(values).size).toBe(values.length)
    // PTHR_VERSION appears in the ledger rows AND in the resolved block.
    expect(values.filter(id => id === 'config--pthr-version')).toHaveLength(1)
  })
})

describe('generator definitions on headline fields', () => {
  it('sets a namespaced definitionId for a key the section defines', () => {
    const view = readGenericSection(
      entryWith('recluster', {
        headline: { families_created: 153 },
        definitions: {
          families_created: {
            label: 'New families created',
            definition: 'Families minted by reclustering.',
          },
        },
      })
    )
    const field = view.headline.find(entry => entry.key === 'families_created')
    expect(field?.definitionId).toBe('recluster.families_created')
  })

  it('leaves definitionId null for a key the section does not define', () => {
    const view = readGenericSection(
      entryWith('recluster', {
        headline: { clusters_formed: 41234 },
        definitions: {
          families_created: { label: 'New families created', definition: 'x' },
        },
      })
    )
    expect(view.headline.find(entry => entry.key === 'clusters_formed')?.definitionId).toBeNull()
  })

  it('sets definitionId on rows[].metric keys too, not only headline keys', () => {
    const view = readGenericSection(
      entryWith('recluster', {
        rows: [{ metric: 'families_created', value: 153 }],
        definitions: {
          families_created: { label: 'New families created', definition: 'x' },
        },
      })
    )
    expect(view.rows[0]?.definitionId).toBe('recluster.families_created')
  })

  it('never lets a generator definition displace a curated metric', () => {
    // `genomes` resolves to a curated metric via the library section's source path.
    const view = readGenericSection(
      entryWith('library', {
        headline: { genomes: 131 },
        definitions: { genomes: { label: 'WRONG', definition: 'WRONG' } },
      })
    )
    const field = view.headline.find(entry => entry.key === 'genomes')
    expect(field?.metricId).not.toBeNull()
  })

  it('degrades to null rather than throwing when definitions are malformed', () => {
    const view = readGenericSection(
      entryWith('recluster', { headline: { families_created: 153 }, definitions: 'nonsense' })
    )
    expect(view.headline.find(entry => entry.key === 'families_created')?.definitionId).toBeNull()
  })

  it('prefers the curated reclustering metric over the generator definition', () => {
    const view = readGenericSection(
      entryWith('recluster', {
        headline: { sequences_in_inherited_families: 4312 },
        definitions: {
          sequences_in_inherited_families: { label: 'GENERATOR', definition: 'GENERATOR' },
        },
      })
    )
    const field = view.headline.find(entry => entry.key === 'sequences_in_inherited_families')
    expect(field?.metricId).toBe('reclusteredIntoExistingFamilies')
    expect(field?.definitionId).toBeNull()
  })
})
