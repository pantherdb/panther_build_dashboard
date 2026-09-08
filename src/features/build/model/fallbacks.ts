/**
 * Empty-but-valid summaries for every part of the report.
 *
 * `parseBuildState` is total: an extractor that throws degrades its own part and nothing else, and
 * the report is still returned. That only works if every part has a shape to fall back to. These
 * factories provide it, always as objects carrying an `Availability` and a reason, so a view never
 * meets `null` where it expected a summary.
 */

import { errorMeta, makeMeta } from './notes'
import { absentTable } from './tables'
import { ABSENT_TIME_POINT } from './timing'
import type {
  BuildIdentity,
  ComparisonSummary,
  ConfigSummary,
  ConsistencyFacts,
  FreshnessSummary,
  HealthSummary,
  LibrarySummary,
  MappingSummary,
  NodeTrackingSummary,
  OtherReportsSummary,
  PipelineSummary,
  PreviousLibrarySummary,
  ProteomeRosterRow,
  ProteomesSummary,
  SpeciesCrossSection,
  SpeciesCountChange,
  SummaryMeta,
  TreeSummary,
  UniprotMatchRow,
  UniRuleRow,
} from './types'

export function absentPipeline(meta: SummaryMeta): PipelineSummary {
  return {
    ...meta,
    phases: [],
    steps: [],
    frontierIndex: null,
    frontierPhaseId: null,
    frontierPhaseName: null,
    holes: [],
    phaseStatusCounts: { complete: 0, active: 0, hole: 0, pending: 0, blocked: 0 },
    declaredHeadline: { phasesComplete: null, stepsComplete: null, stepsTotal: null },
    computedHeadline: { phasesComplete: null, stepsComplete: null, stepsTotal: null },
    headlineConsistent: true,
    warnings: [],
  }
}

export function absentMapping(meta: SummaryMeta): MappingSummary {
  return {
    ...meta,
    stages: [],
    mechanismOrder: [],
    firstStageId: null,
    finalStageId: null,
    inputSequences: null,
    finalTotalSequences: null,
    finalAssigned: null,
    finalFamilies: null,
    firstPctAssigned: null,
    finalPctAssigned: null,
    assignmentGainPoints: null,
    declaredHeadline: {
      finalStage: null,
      finalTotalSeqs: null,
      finalAssigned: null,
      finalPctAssigned: null,
      finalFamilies: null,
    },
  }
}

export function absentNodeTracking(meta: SummaryMeta): NodeTrackingSummary {
  return {
    ...meta,
    nodesMapped: null,
    nodesTotal: null,
    pctMapped: null,
    recomputedPctMapped: null,
    speciesReported: null,
    byType: [],
    bySpecies: [],
    zeroPctOscodes: [],
    lowOutliers: [],
    lowOutlierThreshold: 90,
    medianPct: null,
    madPct: null,
    atOrAbove90: null,
    warnings: [],
  }
}

export function absentLibrary(meta: SummaryMeta): LibrarySummary {
  return { ...meta, genomes: null, sequences: null, families: null, subfamilies: null, rows: [] }
}

export function absentTrees(meta: SummaryMeta): TreeSummary {
  return {
    ...meta,
    booksTotal: null,
    treesBuilt: null,
    treesSucceeded: null,
    emptyTrees: null,
    usableTreePct: null,
    text: null,
  }
}

export function absentProteomes(meta: SummaryMeta): ProteomesSummary {
  return {
    ...meta,
    total: null,
    composition: [],
    compositionLabel: null,
    offMajorityCount: 0,
    changeCounts: {
      new: null,
      upChanged: null,
      sourceChanged: null,
      versionChanged: null,
      sameUp: null,
      unchanged: null,
      dropped: null,
    },
    previousRosterStamped: false,
    roster: absentTable<ProteomeRosterRow>(
      'proteome-roster',
      'Reference proteomes',
      meta.sectionId ?? 'proteomes',
      'The reference-proteome roster could not be read.'
    ),
    dropped: absentTable<ProteomeRosterRow>(
      'proteomes-dropped',
      'Proteomes dropped since previous library',
      meta.sectionId ?? 'proteomes',
      'The dropped-proteome list could not be read.'
    ),
    text: null,
    warnings: [],
  }
}

export function absentPreviousLibrary(meta: SummaryMeta): PreviousLibrarySummary {
  return { ...meta, genomes: null, sequences: null, families: null, subfamilies: null }
}

export function absentConfig(meta: SummaryMeta): ConfigSummary {
  return {
    ...meta,
    generatedAt: ABSENT_TIME_POINT,
    sourceRevision: null,
    sourceDirty: null,
    configFile: null,
    configFileContents: null,
    fileEntries: [],
    commentedEntries: [],
    resolvedEntries: [],
    ledgerEntries: [],
    values: {},
    unresolvedVars: [],
    recordCount: null,
    text: null,
    warnings: [],
    previousLineage: [],
    previousPreviousLineage: [],
    releaseReferences: [],
    pantherVersion: null,
    qfoDataDir: null,
    qfoReleaseVersion: null,
    previousReleaseDir: null,
    emptyValueKeys: [],
  }
}

export function absentOtherReports(meta: SummaryMeta, sectionId: string): OtherReportsSummary {
  const reason = meta.notes[0] ?? 'This report carries no other-reports section.'
  return {
    ...meta,
    text: null,
    metrics: [],
    values: {},
    speciesCounts: absentTable<SpeciesCountChange>(
      'species_counts',
      'Sequence counts by species, previous vs new',
      sectionId,
      reason
    ),
    uniprotMatch: absentTable<UniprotMatchRow>(
      'uniprot_match',
      'Previous-UniProt-ID match by proteome',
      sectionId,
      reason
    ),
    uniRules: absentTable<UniRuleRow>(
      'unirules',
      'UniRules gaining in more than one family',
      sectionId,
      reason
    ),
    otherTables: [],
  }
}

export function absentSpecies(meta: SummaryMeta): SpeciesCrossSection {
  return {
    ...meta,
    records: [],
    byOscode: {},
    oscodeCount: 0,
    coverage: {
      nodeTracking: 0,
      counts: 0,
      uniprot: 0,
      countsTotalRows: null,
      uniprotTotalRows: null,
    },
    newOscodes: [],
    removedOscodes: [],
    renames: [],
    replacements: [],
  }
}

export function absentComparison(
  meta: SummaryMeta,
  previousLibrary: PreviousLibrarySummary
): ComparisonSummary {
  const reason = meta.notes[0] ?? 'No comparison data could be assembled.'
  return {
    ...meta,
    contributors: [],
    metrics: [],
    speciesCounts: absentTable<SpeciesCountChange>(
      'species_counts',
      'Sequence counts by species, previous vs new',
      'other_reports',
      reason
    ),
    uniprotAgreement: absentTable<UniprotMatchRow>(
      'uniprot_match',
      'Previous-UniProt-ID match by proteome',
      'other_reports',
      reason
    ),
    uniprotTotals: null,
    renames: [],
    replacements: [],
    addedOscodes: [],
    removedOscodes: [],
    previousLibrary,
  }
}

export function absentConsistency(): ConsistencyFacts {
  return {
    familyAgreement: {
      id: 'family-count-agreement',
      label: 'Family count across major stages',
      values: [],
      allEqual: false,
      comparable: false,
    },
    leafLibraryAgreement: {
      id: 'leaf-library-agreement',
      label: 'LEAF node total against library sequences',
      values: [],
      allEqual: false,
      comparable: false,
    },
    treeCompleteness: {
      booksTotal: null,
      treesSucceeded: null,
      emptyTrees: null,
      complete: false,
    },
    sequenceCounts: [],
    unresolvedVars: [],
    sourceDirty: null,
    qfoDeclaredRelease: null,
    qfoActiveDataDir: null,
    qfoReleaseMatchesDataDir: null,
    qfoCommentedEvidence: [],
  }
}

export function unknownFreshness(reason: string): FreshnessSummary {
  return {
    ...makeMeta({ availability: 'unknown', sectionId: null, notes: [reason] }),
    state: 'unknown',
    generatedAt: ABSENT_TIME_POINT,
    newestArtifactAt: ABSENT_TIME_POINT,
    newestArtifactStepId: null,
    leadSeconds: null,
    label: 'Freshness unknown',
    explanation: reason,
  }
}

export function absentIdentity(reason: string): BuildIdentity {
  return {
    ...errorMeta(null, reason),
    target: null,
    pantherVersion: null,
    libraryLabel: null,
    generatedAt: ABSENT_TIME_POINT,
    sourceRevision: null,
    sourceDirty: null,
    qfoDataDir: null,
    qfoReleaseVersion: null,
    previousLibraryLabel: null,
    configFile: null,
    sectionCount: 0,
  }
}

export function absentHealth(reason: string): HealthSummary {
  return {
    ...makeMeta({ availability: 'unknown', sectionId: null, notes: [reason] }),
    signal: 'unknown',
    generatorWarningCount: 0,
    degradedSectionIds: [],
    absentSectionIds: [],
    unknownSectionIds: [],
    unknownStatusValues: [],
    ingestErrorCount: 0,
    ingestWarningCount: 0,
    schemaDegraded: true,
    truncatedTableCount: 0,
  }
}
