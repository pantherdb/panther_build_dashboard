/**
 * The previous-library comparison, assembled rather than read from one section.
 *
 * `prev_lib` is `absent` on this fixture ("inputs not present yet"), yet `other_reports` carries
 * previous-versus-new sequence counts, a 50-of-147 species table and previous-UniProt agreement.
 * Tying the comparison view to a single section would therefore show nothing when a usable
 * comparison exists. Every source is recorded on `contributors`, and availability comes out
 * `partial` - not `absent` - so the UI can say which halves of the comparison it has.
 */

import { fractionChange, roundTo } from './primitives'
import { isAggregateOscode } from './sections/otherReports'
import { makeMeta } from './notes'
import type { NoteSink } from './notes'
import type {
  ComparisonContributor,
  ComparisonGap,
  ComparisonMetric,
  ComparisonSummary,
  LibrarySummary,
  MappingSummary,
  MetricId,
  NodeTrackingSummary,
  OtherReportsSummary,
  PreviousLibrarySummary,
  SpeciesCrossSection,
  UniprotMatchRow,
} from './types'

export interface ComparisonInput {
  previousLibrary: PreviousLibrarySummary
  library: LibrarySummary
  otherReports: OtherReportsSummary
  nodeTracking: NodeTrackingSummary
  mapping: MappingSummary
  species: SpeciesCrossSection
  sink: NoteSink
}

function metric(
  metricId: MetricId,
  previousMetricId: MetricId,
  previous: number | null,
  current: number | null,
  previousSource: string | null,
  currentSource: string | null
): ComparisonMetric {
  const fraction = fractionChange(previous, current)
  return {
    metricId,
    previousMetricId,
    previous,
    current,
    delta: previous === null || current === null ? null : current - previous,
    percentChange: fraction === null ? null : roundTo(fraction * 100, 1),
    previousSource,
    currentSource,
  }
}

export function buildComparison(input: ComparisonInput): ComparisonSummary {
  const { previousLibrary, library, otherReports, nodeTracking, mapping, species, sink } = input

  const previousLibraryPresent = previousLibrary.availability === 'available'
  const otherReportsPresent = otherReports.availability === 'available'

  const contributors: ComparisonContributor[] = [
    {
      sectionId: 'prev_lib',
      what: 'Direct previous-library totals (genomes, sequences, families, subfamilies)',
      present: previousLibraryPresent,
      note: previousLibrary.message,
    },
    {
      sectionId: 'other_reports',
      what: 'Previous-versus-new sequence counts, the species count table and UniProt agreement',
      present: otherReportsPresent,
      note: otherReports.speciesCounts.truncation.truncated
        ? otherReports.speciesCounts.truncation.label
        : null,
    },
    {
      sectionId: 'library',
      what: 'Current-library totals for the new side of every comparison',
      present: library.availability === 'available',
      note: null,
    },
    {
      sectionId: 'mapping',
      what: 'Current reference-proteome input sequence count',
      present: mapping.availability === 'available',
      note: null,
    },
    {
      sectionId: 'node_tracking',
      what: 'Per-species forward-tracking coverage used by the species cross-section',
      present: nodeTracking.availability === 'available',
      note: null,
    },
  ]

  const metrics: ComparisonMetric[] = [
    metric(
      'inputReferenceSequences',
      'prevLibSequences',
      otherReports.values.prev_lib_sequences ?? null,
      otherReports.values.new_lib_sequences ?? mapping.inputSequences,
      'other_reports.prev_lib_sequences',
      otherReports.values.new_lib_sequences === undefined
        ? 'mapping.rows[0].total_seqs'
        : 'other_reports.new_lib_sequences'
    ),
    metric(
      'librarySequences',
      'librarySequences',
      previousLibrary.sequences,
      library.sequences,
      previousLibraryPresent ? 'prev_lib.sequences' : null,
      'library.sequences'
    ),
    metric(
      'families',
      'families',
      previousLibrary.families,
      library.families,
      previousLibraryPresent ? 'prev_lib.families' : null,
      'library.families'
    ),
    metric(
      'subfamilies',
      'subfamilies',
      previousLibrary.subfamilies,
      library.subfamilies,
      previousLibraryPresent ? 'prev_lib.subfamilies' : null,
      'library.subfamilies'
    ),
    metric(
      'genomes',
      'genomes',
      previousLibrary.genomes,
      library.genomes,
      previousLibraryPresent ? 'prev_lib.genomes' : null,
      'library.genomes'
    ),
  ]

  const uniprotTotals: UniprotMatchRow | null =
    otherReports.uniprotMatch.rows.find(row => isAggregateOscode(row.oscode)) ?? null

  const contributed = contributors.filter(contributor => contributor.present)
  const notes: string[] = []
  let availability: ComparisonSummary['availability']
  let gap: ComparisonGap | null

  if (contributed.length === 0) {
    availability = 'absent'
    gap = 'noSources'
    notes.push('No section in this report carries previous-library information.')
  } else if (!previousLibraryPresent) {
    availability = 'partial'
    gap = 'previousLibraryAbsent'
    notes.push(
      'The direct previous-library section is absent, so the comparison is assembled from the ' +
        `remaining sources: ${contributed.map(entry => entry.sectionId).join(', ')}.`
    )
    if (previousLibrary.message !== null) {
      notes.push(`The generator's reason for the absent section: ${previousLibrary.message}`)
    }
  } else if (
    otherReports.speciesCounts.truncation.truncated ||
    otherReports.uniprotMatch.truncation.truncated
  ) {
    availability = 'partial'
    gap = 'tablesTruncated'
    notes.push('Comparison tables are truncated, so per-species coverage is incomplete.')
  } else {
    availability = 'available'
    gap = null
  }

  if (availability === 'partial') {
    sink.add(
      'info',
      'join:comparison',
      'The previous-library comparison is assembled from more than one source and is partial.',
      contributed.map(entry => entry.sectionId).join(', ')
    )
  }

  return {
    ...makeMeta({ availability, sectionId: null, notes }),
    gap,
    contributors,
    metrics,
    speciesCounts: otherReports.speciesCounts,
    uniprotAgreement: otherReports.uniprotMatch,
    uniprotTotals,
    renames: species.renames,
    replacements: species.replacements,
    addedOscodes: otherReports.speciesCounts.rows
      .filter(row => row.isAddition)
      .map(row => row.oscode),
    removedOscodes: otherReports.speciesCounts.rows
      .filter(row => row.isRemoval)
      .map(row => row.oscode),
    previousLibrary,
  }
}
