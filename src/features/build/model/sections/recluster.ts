/**
 * The `recluster` section: what TribeMCL reclustering created.
 *
 * The typed reading exists for one reason the generic view cannot serve - the glance panel leads
 * the build record with the number of families this build created, and a panel cannot lead with an
 * `unknown`. The section BODY still renders generically; there is no bespoke view. So this
 * extractor is deliberately thin: the headline, and the outcome table the panel's bar draws from.
 *
 * Absent is never zero. A build that has not reached reclustering has created no families YET,
 * which is a different claim from having created none, and the panel must be able to tell them
 * apart.
 */

import { asArray, asInteger, asNonEmptyString, asRecord, asStringArray } from '../primitives'
import { makeMeta } from '../notes'
import { availabilityFor } from '../status'
import type { NoteSink } from '../notes'
import type { ReclusterOutcome, ReclusterSummary } from '../types'
import { sectionBaseNotes } from './input'
import type { SectionInput } from './input'

export function extractRecluster(section: SectionInput, sink: NoteSink): ReclusterSummary {
  const scope = `section:${section.sectionId}`
  const hasData = section.dataRecord !== null
  const notes = sectionBaseNotes(section, sink, 'reclustering statistics')

  const meta = makeMeta({
    availability: availabilityFor(section.status, hasData),
    sectionId: section.sectionId,
    message: section.message,
    status: section.status,
    notes,
  })

  const headline = asRecord(section.dataRecord?.headline)

  // The cluster-outcome table, by name rather than by position: a collector may add a table
  // before it, and reading `tables[0]` would then silently draw the panel's bar from the wrong one.
  const outcomeTable = asArray(section.dataRecord?.tables)
    .map(entry => asRecord(entry))
    .find(record => asNonEmptyString(record?.name) === 'Cluster outcomes')

  const outcomes: ReclusterOutcome[] = asArray(outcomeTable?.rows)
    .map(entry => asRecord(entry))
    .filter((record): record is Record<string, unknown> => {
      if (record === null) {
        sink.add('warning', scope, 'A cluster-outcome row is not an object; skipped.')
        return false
      }
      return true
    })
    .map(record => ({
      outcome: asNonEmptyString(record.outcome) ?? 'UNKNOWN',
      clusters: asInteger(record.clusters),
      sequences: asInteger(record.sequences),
    }))

  return {
    ...meta,
    familiesCreated: asInteger(headline?.families_created),
    sequencesInNewFamilies: asInteger(headline?.sequences_in_new_families),
    familiesInherited: asInteger(headline?.families_inherited),
    sequencesInInheritedFamilies: asInteger(headline?.sequences_in_inherited_families),
    clustersFormed: asInteger(headline?.clusters_formed),
    sequencesOffered: asInteger(headline?.sequences_offered),
    newFamilyIdMin: asNonEmptyString(headline?.new_family_id_min),
    newFamilyIdMax: asNonEmptyString(headline?.new_family_id_max),
    outcomes,
    warnings: asStringArray(section.dataRecord?.warnings),
  }
}
