/**
 * The metric definitions registry.
 *
 * One place holds the user-facing label and the short explanation for every number the dashboard
 * shows, so summaries, charts, tables, tooltips, exports and derived checks cannot describe the
 * same value two different ways.
 *
 * Its main job is the terminology problem: this report carries six distinct sequence counts that
 * all reduce to the word "sequences" if nobody stops it. Labelling a bare number "Sequences" is a
 * defect, so the six ids in `SEQUENCE_METRIC_IDS` each carry a label that names the concept.
 */

import { metricAnchor } from './anchors'
import type { MetricId } from './types'

export type MetricUnit = 'count' | 'percent' | 'percentage-points' | 'ratio' | 'duration'

/** Grouping used by the definitions panel and by the "which sequences?" disambiguation. */
export type MetricFamily = 'sequences' | 'families' | 'nodes' | 'species' | 'trees' | 'pipeline'

export interface MetricDefinition {
  id: MetricId
  /** Never just "Sequences" for a sequence count. */
  label: string
  /** A compact form for axis ticks and dense tables. */
  shortLabel: string
  definition: string
  unit: MetricUnit
  family: MetricFamily
  /** Where in the report the value comes from, for provenance in exports. */
  source: string
  /** Present only where a value is routinely confused with another one. */
  ambiguityNote?: string
}

const DEFINITIONS: MetricDefinition[] = [
  /* -- the six sequence counts --------------------------------------------------------- */
  {
    id: 'prevLibSequences',
    label: 'Previous-library reference sequences',
    shortLabel: 'Prev. reference seqs',
    definition:
      'Reference/input sequences that fed the previous library build. A baseline for comparison, ' +
      'not a count of anything in this build.',
    unit: 'count',
    family: 'sequences',
    source: 'other_reports.prev_lib_sequences',
    ambiguityNote:
      'Larger than every count in this build because the previous release used a different ' +
      'reference-proteome set.',
  },
  {
    id: 'inputReferenceSequences',
    label: 'Reference-proteome input sequences',
    shortLabel: 'Input seqs',
    definition:
      'Sequences in the reference proteomes this build started from. Equals the first mapping ' +
      'stage total, and is the denominator for assignment percentages early in the pipeline.',
    unit: 'count',
    family: 'sequences',
    source: 'mapping.rows[stage=id].total_seqs / other_reports.new_lib_sequences',
    ambiguityNote: 'This is the input, not what ended up in the library.',
  },
  {
    id: 'finalStageSequences',
    label: 'Sequences at the final mapping stage',
    shortLabel: 'Final-stage seqs',
    definition:
      'Sequences still present after trimming, de-duplication and single-genome family removal, ' +
      'measured at the last mapping stage.',
    unit: 'count',
    family: 'sequences',
    source: 'mapping.rows[stage=post_giga].total_seqs',
    ambiguityNote:
      'Lower than the input count because of trimming and de-duplication losses, not because ' +
      'sequences failed.',
  },
  {
    id: 'assignedSequences',
    label: 'Sequences assigned to a family',
    shortLabel: 'Assigned seqs',
    definition:
      'Sequences that received a family assignment at the final mapping stage, by any mechanism.',
    unit: 'count',
    family: 'sequences',
    source: 'mapping.rows[stage=post_giga].assigned',
    ambiguityNote: 'A subset of the final-stage sequences, not of the built library.',
  },
  {
    id: 'librarySequences',
    label: 'Sequences in the built library',
    shortLabel: 'Library seqs',
    definition: 'Sequences represented in the library this build produced.',
    unit: 'count',
    family: 'sequences',
    source: 'library.sequences',
    ambiguityNote:
      'Differs from the assigned count because the library is assembled from books and trees, ' +
      'not directly from the mapping table.',
  },
  {
    id: 'leafNodesMapped',
    label: 'LEAF nodes mapped forward',
    shortLabel: 'LEAF mapped',
    definition:
      'Leaf nodes from the previous library that were successfully mapped forward onto this ' +
      'library. Nodes, not sequences, though the LEAF denominator equals library sequences.',
    unit: 'count',
    family: 'nodes',
    source: 'node_tracking.by_type[LEAF].mapped',
    ambiguityNote:
      'The LEAF total matching library sequences exactly is a consistency signal, not a ' +
      'duplication of the same metric.',
  },

  /*
   * -- reclustering: a seventh and eighth sequence count --------------------------------
   *
   * Not added to `SEQUENCE_METRIC_IDS`: that list is the fixed set behind the sequence-terminology
   * check (`consistency.sequenceCounts`, `sequenceTerminology.ts`), which compares six figures that
   * are all restatements of the same pipeline pass and could plausibly be mistaken for each other.
   * These two are a partition of one TribeMCL outcome, not another view of that same six, so they
   * get their own disambiguation here without joining that check's fixed roster.
   */
  {
    id: 'reclusteredIntoExistingFamilies',
    label: 'Sequences clustered into existing families',
    shortLabel: 'Into existing fams',
    definition:
      'Sequences that were unassigned after HMM scoring, were clustered by TribeMCL, and landed ' +
      'in a family that already existed in the PREVIOUS library — the cluster reclaimed that ' +
      'family rather than creating one.',
    unit: 'count',
    family: 'sequences',
    source: 'recluster.headline.sequences_in_inherited_families',
    ambiguityNote:
      'Reclaiming is not creating. Disjoint from the sequences in families this build minted; ' +
      'the report calls these "inherited" because the family is inherited from the previous library.',
  },
  {
    id: 'reclusteredIntoNewFamilies',
    label: 'Sequences in newly created families',
    shortLabel: 'Into new fams',
    definition:
      'Sequences that were unassigned after HMM scoring, were clustered by TribeMCL, and became ' +
      'the founding members of a PANTHER family this build created.',
    unit: 'count',
    family: 'sequences',
    source: 'recluster.headline.sequences_in_new_families',
    ambiguityNote:
      'These are the sequences the families-created figure is built from. Disjoint from the ' +
      'sequences that went into families reclaimed from the previous library.',
  },

  /* -- the rest ------------------------------------------------------------------------ */
  {
    id: 'unassignedSequences',
    label: 'Unassigned sequences',
    shortLabel: 'Unassigned',
    definition: 'Sequences with no family assignment at the given mapping stage.',
    unit: 'count',
    family: 'sequences',
    source: 'mapping.rows[].unassigned',
  },
  {
    id: 'families',
    label: 'Families',
    shortLabel: 'Families',
    definition: 'PANTHER families (books) in the library.',
    unit: 'count',
    family: 'families',
    source: 'library.families / mapping.rows[].n_families',
  },
  {
    id: 'subfamilies',
    label: 'Subfamilies',
    shortLabel: 'Subfamilies',
    definition: 'PANTHER subfamilies in the library.',
    unit: 'count',
    family: 'families',
    source: 'library.subfamilies',
  },
  {
    id: 'genomes',
    label: 'Genomes in the library',
    shortLabel: 'Genomes',
    definition: 'Genomes (proteomes) represented in the built library.',
    unit: 'count',
    family: 'species',
    source: 'library.genomes',
  },
  {
    id: 'speciesReported',
    label: 'Species in node forward tracking',
    shortLabel: 'Species tracked',
    definition: 'Species for which node forward tracking reported a figure.',
    unit: 'count',
    family: 'species',
    source: 'node_tracking.headline.species_reported',
    ambiguityNote:
      'A different denominator from the species-comparison table total, which counts species ' +
      'across both releases.',
  },
  {
    id: 'speciesTotal',
    label: 'Species across both releases',
    shortLabel: 'Species (both)',
    definition:
      'Species appearing in either the previous or the current release, so it exceeds the ' +
      'number of genomes in this library.',
    unit: 'count',
    family: 'species',
    source: 'other_reports.species_total',
  },
  {
    id: 'pctAssigned',
    label: 'Assignment rate',
    shortLabel: 'Assigned %',
    definition: 'Assigned sequences as a percentage of the sequences present at that stage.',
    unit: 'percent',
    family: 'sequences',
    source: 'mapping.rows[].pct_assigned',
  },
  {
    id: 'assignmentGainPoints',
    label: 'Assignment gain',
    shortLabel: 'Gain (pp)',
    definition:
      'Change in the assignment rate from the first to the last mapping stage, in percentage ' +
      'points.',
    unit: 'percentage-points',
    family: 'sequences',
    source: 'derived from mapping.rows[]',
    ambiguityNote: 'Percentage points, not a percentage change.',
  },
  {
    id: 'nodesMapped',
    label: 'Nodes mapped forward',
    shortLabel: 'Nodes mapped',
    definition: 'Previous-library nodes of any type mapped forward onto this library.',
    unit: 'count',
    family: 'nodes',
    source: 'node_tracking.headline.nodes_mapped',
  },
  {
    id: 'nodesTotal',
    label: 'Previous-library nodes',
    shortLabel: 'Nodes total',
    definition: 'Nodes in the previous library that forward tracking attempted to map.',
    unit: 'count',
    family: 'nodes',
    source: 'node_tracking.headline.nodes_total',
  },
  {
    id: 'pctNodesMapped',
    label: 'Node forward-tracking rate',
    shortLabel: 'Nodes mapped %',
    definition: 'Mapped nodes as a percentage of previous-library nodes.',
    unit: 'percent',
    family: 'nodes',
    source: 'node_tracking.headline.pct_mapped',
    ambiguityNote:
      'A species new to this build has no previous nodes, so 0 % is expected rather than a ' +
      'failure.',
  },
  {
    id: 'booksTotal',
    label: 'Books submitted to tree building',
    shortLabel: 'Books',
    definition: 'Books GIGA was asked to build a tree for.',
    unit: 'count',
    family: 'trees',
    source: 'giga.headline.books_total',
  },
  {
    id: 'treesSucceeded',
    label: 'Books with a usable tree',
    shortLabel: 'Trees usable',
    definition: 'Books that came back with a non-empty tree.',
    unit: 'count',
    family: 'trees',
    source: 'giga.headline.trees_succeeded',
  },
  {
    id: 'emptyTrees',
    label: 'Empty trees',
    shortLabel: 'Empty trees',
    definition: 'Books whose tree came back empty.',
    unit: 'count',
    family: 'trees',
    source: 'giga.headline.empty_trees',
  },
  {
    id: 'prevUniprotProteomes',
    label: 'Proteomes compared to previous UniProt IDs',
    shortLabel: 'Proteomes compared',
    definition: 'Proteomes for which previous-release UniProt identifier agreement was measured.',
    unit: 'count',
    family: 'species',
    source: 'other_reports.prev_uniprot_proteomes',
  },
  {
    id: 'prevUniprotTotalSeqs',
    label: 'Sequences checked for UniProt agreement',
    shortLabel: 'Seqs checked',
    definition: 'Sequences included in the previous-UniProt identifier comparison.',
    unit: 'count',
    family: 'sequences',
    source: 'other_reports.prev_uniprot_total_seqs',
  },
  {
    id: 'prevUniprotSameUniprot',
    label: 'Sequences keeping the same UniProt ID',
    shortLabel: 'Same UniProt',
    definition: 'Sequences whose UniProt identifier is unchanged from the previous release.',
    unit: 'count',
    family: 'sequences',
    source: 'other_reports.prev_uniprot_same_uniprot',
  },
  {
    id: 'prevUniprotPctSame',
    label: 'UniProt ID agreement',
    shortLabel: 'Same UniProt %',
    definition: 'Share of compared sequences keeping their previous UniProt identifier.',
    unit: 'percent',
    family: 'sequences',
    source: 'other_reports.prev_uniprot_pct_same',
  },
  {
    id: 'uniRulesInMultipleFamilies',
    label: 'UniRules gaining in more than one family',
    shortLabel: 'Multi-family UniRules',
    definition: 'UniRules that now apply across more than one family.',
    unit: 'count',
    family: 'families',
    source: 'other_reports.unirules_in_multiple_families',
  },
  {
    id: 'blastSequencesChecked',
    label: 'Sequences checked in the BLAST QC pass',
    shortLabel: 'BLAST checked',
    definition: 'Sequences examined by the BLAST length-consistency check.',
    unit: 'count',
    family: 'sequences',
    source: 'other_reports.blast_sequences_checked',
  },
  {
    id: 'blastLengthsCompared',
    label: 'Length comparisons made',
    shortLabel: 'Lengths compared',
    definition: 'Sequence-length comparisons the BLAST QC pass was able to make.',
    unit: 'count',
    family: 'sequences',
    source: 'other_reports.blast_lengths_compared',
  },
  {
    id: 'blastLengthRatioOutliers',
    label: 'Length-ratio outliers',
    shortLabel: 'Length outliers',
    definition: 'Comparisons whose length ratio fell outside the accepted range.',
    unit: 'count',
    family: 'sequences',
    source: 'other_reports.blast_length_ratio_outliers',
  },
  {
    id: 'blastAvgLenQuotient',
    label: 'Average length quotient',
    shortLabel: 'Avg len quotient',
    definition: 'Mean ratio of compared sequence lengths; 1.0 means no systematic drift.',
    unit: 'ratio',
    family: 'sequences',
    source: 'other_reports.blast_avg_len_quotient',
  },
  {
    id: 'phasesComplete',
    label: 'Phases complete',
    shortLabel: 'Phases done',
    definition: 'Pipeline phases in which every step finished.',
    unit: 'count',
    family: 'pipeline',
    source: 'progress.headline.phases_complete',
  },
  {
    id: 'stepsComplete',
    label: 'Steps complete',
    shortLabel: 'Steps done',
    definition: 'Pipeline steps whose goal artifact exists.',
    unit: 'count',
    family: 'pipeline',
    source: 'progress.headline.steps_complete',
  },
  {
    id: 'stepsTotal',
    label: 'Steps declared',
    shortLabel: 'Steps total',
    definition: 'Steps the pipeline declares across every phase.',
    unit: 'count',
    family: 'pipeline',
    source: 'progress.headline.steps_total',
  },
  {
    id: 'reportLeadTime',
    label: 'Report lead time',
    shortLabel: 'Lead time',
    definition:
      'How long after the newest artifact the report was generated. Positive means the report ' +
      'describes every artifact it knows about.',
    unit: 'duration',
    family: 'pipeline',
    source: 'derived from generated_at and the newest step mtime',
  },
]

export const METRIC_DEFINITIONS: Record<MetricId, MetricDefinition> = DEFINITIONS.reduce(
  (acc, definition) => {
    acc[definition.id] = definition
    return acc
  },
  {} as Record<MetricId, MetricDefinition>
)

export const METRIC_IDS: readonly MetricId[] = DEFINITIONS.map(definition => definition.id)

/**
 * The six counts this fixture presents that all sound like "sequences". Any screen showing one of
 * these must use its registry label.
 */
export const SEQUENCE_METRIC_IDS: readonly MetricId[] = [
  'prevLibSequences',
  'inputReferenceSequences',
  'finalStageSequences',
  'assignedSequences',
  'librarySequences',
  'leafNodesMapped',
]

export function getMetricDefinition(id: MetricId): MetricDefinition {
  return METRIC_DEFINITIONS[id]
}

export function metricLabel(id: MetricId): string {
  return METRIC_DEFINITIONS[id].label
}

export function metricsInFamily(family: MetricFamily): MetricDefinition[] {
  return DEFINITIONS.filter(definition => definition.family === family)
}

/** Deep link to a metric's definition, so a tooltip and an export can point at the same place. */
export function metricDefinitionAnchor(id: MetricId): string {
  return metricAnchor(id)
}

/** Maps an `other_reports.rows[].metric` key onto a registry id, or `null` when unregistered. */
const OTHER_REPORT_METRIC_IDS: Record<string, MetricId> = {
  prev_lib_sequences: 'prevLibSequences',
  new_lib_sequences: 'inputReferenceSequences',
  species_total: 'speciesTotal',
  prev_uniprot_proteomes: 'prevUniprotProteomes',
  prev_uniprot_total_seqs: 'prevUniprotTotalSeqs',
  prev_uniprot_same_uniprot: 'prevUniprotSameUniprot',
  prev_uniprot_pct_same: 'prevUniprotPctSame',
  unirules_in_multiple_families: 'uniRulesInMultipleFamilies',
  blast_sequences_checked: 'blastSequencesChecked',
  blast_lengths_compared: 'blastLengthsCompared',
  blast_length_ratio_outliers: 'blastLengthRatioOutliers',
  blast_avg_len_quotient: 'blastAvgLenQuotient',
}

export function metricIdForReportKey(key: string): MetricId | null {
  return OTHER_REPORT_METRIC_IDS[key] ?? null
}

/**
 * The registry key a generator-supplied term takes.
 *
 * Namespaced by section so the 433 lines of curated camelCase ids above can never be displaced,
 * and so two collectors may define the same word - `applied` means one thing under forced
 * subfamily roots and could mean another elsewhere - without interfering.
 */
export function generatorDefinitionId(sectionId: string, term: string): string {
  return `${sectionId}.${term}`
}
