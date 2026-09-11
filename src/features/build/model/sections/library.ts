/**
 * The `library` and `giga` sections, and the absent `prev_lib` section.
 *
 * All three are small headline-plus-rows payloads, so they share a file - though only `library`
 * and `giga` keep their totals in `headline`; see `extractPreviousLibrary` for why `prev_lib` does
 * not. `prev_lib` is `absent` on this fixture with the message "inputs not present yet"; it still
 * returns a summary object carrying that message, because the comparison view has to explain why
 * the direct comparison is missing rather than render an empty panel.
 */

import { asArray, asInteger, asNonEmptyString, asRecord, asString, percentOf } from '../primitives'
import { makeMeta } from '../notes'
import { availabilityFor } from '../status'
import type { NoteSink } from '../notes'
import type { LibrarySummary, PreviousLibrarySummary, TreeSummary } from '../types'
import { sectionBaseNotes } from './input'
import type { SectionInput } from './input'

export function extractLibrary(section: SectionInput, sink: NoteSink): LibrarySummary {
  const notes = sectionBaseNotes(section, sink, 'library')
  const headline = asRecord(section.dataRecord?.headline)
  const meta = makeMeta({
    availability: availabilityFor(section.status, section.dataRecord !== null),
    sectionId: section.sectionId,
    message: section.message,
    status: section.status,
    notes,
  })

  const rows = asArray(section.dataRecord?.rows)
    .map(entry => asRecord(entry))
    .filter((record): record is Record<string, unknown> => record !== null)
    .map(record => ({
      metric: asNonEmptyString(record.metric) ?? 'unnamed',
      value: asInteger(record.value),
      rawValue: record.value,
    }))

  return {
    ...meta,
    genomes: asInteger(headline?.genomes),
    sequences: asInteger(headline?.sequences),
    families: asInteger(headline?.families),
    subfamilies: asInteger(headline?.subfamilies),
    rows,
  }
}

export function extractTrees(section: SectionInput, sink: NoteSink): TreeSummary {
  const notes = sectionBaseNotes(section, sink, 'tree building')
  const headline = asRecord(section.dataRecord?.headline)
  const booksTotal = asInteger(headline?.books_total)
  const treesSucceeded = asInteger(headline?.trees_succeeded)

  return {
    ...makeMeta({
      availability: availabilityFor(section.status, section.dataRecord !== null),
      sectionId: section.sectionId,
      message: section.message,
      status: section.status,
      notes,
    }),
    booksTotal,
    treesBuilt: asInteger(headline?.trees_built),
    treesSucceeded,
    emptyTrees: asInteger(headline?.empty_trees),
    usableTreePct: percentOf(treesSucceeded, booksTotal),
    text: asString(section.dataRecord?.text),
  }
}

/**
 * The previous library's four totals, read from the `prev` column of the generated rows.
 *
 * Not from `headline`, which is the one thing this section does differently from `library` and
 * `giga`: the collector fills it with the *deltas* between the new library and the previous one
 * (`delta_genomes`, `delta_sequences`, ...) as preformatted strings, and puts the totals
 * themselves on `rows` as `{metric, prev, rebuilt, new, delta}`. Reading `headline.genomes` here
 * returned null on every real report, which no fixture could catch: `prev_lib` needs
 * `reports/prev_lib_baseline.json`, built by a Makefile rule nothing depends on, so every report
 * to date reports the section `absent` and the question never arose. It would have surfaced as a
 * comparison that announced itself complete with four blank previous values.
 *
 * `rebuilt` - the previous library with splits, merges and removals applied - is deliberately not
 * read here: nothing in the model or the views has a place for it yet.
 */
export function extractPreviousLibrary(
  section: SectionInput,
  sink: NoteSink
): PreviousLibrarySummary {
  const notes = sectionBaseNotes(section, sink, 'previous library')
  const previous = new Map(
    asArray(section.dataRecord?.rows)
      .map(entry => asRecord(entry))
      .filter((record): record is Record<string, unknown> => record !== null)
      .map(record => [asNonEmptyString(record.metric) ?? '', asInteger(record.prev)] as const)
  )
  /** Absent row and null total mean the same thing: the generator could not compute it. */
  const totalOf = (metric: string): number | null => previous.get(metric) ?? null

  return {
    ...makeMeta({
      availability: availabilityFor(section.status, section.dataRecord !== null),
      sectionId: section.sectionId,
      message: section.message,
      status: section.status,
      notes,
    }),
    genomes: totalOf('genomes'),
    sequences: totalOf('sequences'),
    families: totalOf('families'),
    subfamilies: totalOf('subfamilies'),
  }
}
