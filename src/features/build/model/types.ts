/**
 * The derived build-report domain model.
 *
 * Every view reads this and nothing reads the raw JSON. Two rules shape the whole file:
 *
 * 1. Absence is a value. Every sub-summary is an object carrying an `Availability` and the
 *    generator's own `message`, so no view ever null-checks a summary. Individual measurements
 *    are `number | null` - `null` means "not measured", and a `0` therefore always means zero.
 * 2. Unknown values are preserved verbatim. Statuses keep their literal `raw` string and report
 *    `isUnknown`, so an unfamiliar enum degrades visibly instead of being coerced.
 */

import type { Availability } from '@/@panther.core/vocabulary'

/* -- Raw report shapes (permissive; the transforms operate on these) ----------------------- */

export interface RawSection {
  id?: unknown
  title?: unknown
  status?: unknown
  message?: unknown
  data?: unknown
  /** Optional forward-compatible phase hint; absent in schema 1 but read when present. */
  phase?: unknown
  phase_id?: unknown
  [key: string]: unknown
}

export interface RawBuildState {
  schema_version?: unknown
  target?: unknown
  generated_at?: unknown
  sections?: unknown
  [key: string]: unknown
}

/** What a fixture transform consumes and produces. Deliberately the raw shape, not the model. */
export type BuildState = RawBuildState

/* -- Availability, status and notes ------------------------------------------------------- */

/**
 * Re-exported, not redeclared. `Availability` is owned by the shared library
 * because `Panel` and `UnavailableNotice` branch on it directly; the model
 * consumes the same definition so the two cannot drift. Every other enum in the
 * report's vocabulary is owned here.
 */
export type { Availability }

export interface SummaryMeta {
  availability: Availability
  /** The generator's own section message, verbatim. `null` when it emitted none. */
  message: string | null
  /** The literal `status` string the generator wrote, kept for display and debugging. */
  reportedStatus: string | null
  /** Which report section this summary was assembled from, or `null` when it spans several. */
  sectionId: string | null
  /** Why this part degraded, if it did. Empty when everything was read cleanly. */
  notes: string[]
}

export type SectionStatusKind =
  'ok' | 'warn' | 'partial' | 'absent' | 'error' | 'missing' | 'unknown'

export type StepStatusKind = 'done' | 'pending' | 'running' | 'failed' | 'skipped' | 'unknown'

export interface StatusInfo<TKind extends string> {
  kind: TKind
  /** The literal value from the report. `null` only when the field was missing entirely. */
  raw: string | null
  /** Display label; `Unknown status: <raw>` when `isUnknown`. */
  label: string
  isUnknown: boolean
}

export type SectionStatus = StatusInfo<SectionStatusKind>
export type StepStatus = StatusInfo<StepStatusKind>

export type IngestSeverity = 'info' | 'warning' | 'error'

export interface IngestNote {
  severity: IngestSeverity
  /** `root`, `section:progress`, `join:species`, and so on. */
  scope: string
  message: string
  detail: string | null
}

/* -- Time and timing ---------------------------------------------------------------------- */

export interface TimePoint {
  present: boolean
  epochSeconds: number | null
  iso: string | null
}

export type TimingProvenance = 'measured' | 'inferred' | 'unavailable'

/** What the number actually is. Inferred spans are artifact activity, never measured runtime. */
export type TimingKind = 'measured-runtime' | 'artifact-activity' | 'none'

export interface Elapsed {
  seconds: number | null
  provenance: TimingProvenance
  kind: TimingKind
  /** Reads as an approximation for inferred spans and a plain duration for measured ones. */
  label: string
  /** True when the raw subtraction was negative and the value was clamped to zero. */
  clampedFromNegative: boolean
}

export interface StepTiming extends Elapsed {
  artifactAt: TimePoint
  startedAt: TimePoint
  endedAt: TimePoint
  jobId: string | null
  /** The artifact-order predecessor an inferred span was measured from. */
  inferredFromStepId: string | null
  /** Artifact landed within the concurrency window of its neighbour - treat as parallel. */
  potentiallyConcurrent: boolean
  /** Clamped gap from the previous step in DECLARED order, for the spine. */
  declaredDeltaSeconds: number | null
  /** True when the declared-order gap was negative before clamping. */
  declaredOutOfOrder: boolean
}

export interface PhaseTiming extends Elapsed {
  firstArtifactAt: TimePoint
  lastArtifactAt: TimePoint
  artifactCount: number
  potentiallyConcurrent: boolean
}

export interface OutOfOrderPair {
  stepId: string
  goal: string
  previousStepId: string
  previousGoal: string
  /** Negative: how far back in time the later declared step actually landed. */
  rawDeltaSeconds: number
}

export interface ArtifactCluster {
  id: string
  stepIds: string[]
  firstAt: TimePoint
  lastAt: TimePoint
  spanSeconds: number
  potentiallyConcurrent: boolean
}

export interface TimingModel extends SummaryMeta {
  /** Declared pipeline order - the spine and step list read this. */
  declaredOrder: string[]
  /** Artifact-time order - the inferred timeline reads this. Never mixed with the above. */
  artifactOrder: string[]
  oldestArtifactAt: TimePoint
  newestArtifactAt: TimePoint
  activitySpan: Elapsed
  outOfOrder: OutOfOrderPair[]
  clusters: ArtifactCluster[]
  concurrencyWindowSeconds: number
  /** True when any step carried `started_at`/`ended_at`, i.e. real runtimes are available. */
  hasMeasuredTiming: boolean
}

export type FreshnessState = 'current' | 'potentially-stale' | 'unknown'

export interface FreshnessSummary extends SummaryMeta {
  state: FreshnessState
  generatedAt: TimePoint
  newestArtifactAt: TimePoint
  newestArtifactStepId: string | null
  /** Signed: report time minus newest artifact time. Positive is positive evidence. */
  leadSeconds: number | null
  label: string
  explanation: string
}

/* -- Pipeline ----------------------------------------------------------------------------- */

export type PhaseStatus = 'complete' | 'active' | 'hole' | 'pending' | 'blocked'

export interface StepAttempt {
  index: number
  status: StepStatus
  startedAt: TimePoint
  endedAt: TimePoint
  jobId: string | null
  logReference: string | null
  reason: string | null
  raw: unknown
}

export interface BuildStep {
  /** Stable anchor id built from the phase id and the goal slug. */
  id: string
  goal: string
  phaseId: string
  phaseIndex: number
  /** Index within the phase, in declared order. */
  indexInPhase: number
  /** Index across the whole pipeline, in declared order. */
  declaredIndex: number
  status: StepStatus
  isComplete: boolean
  timing: StepTiming
  attempts: StepAttempt[]
  attemptCount: number
  hasFailedAttempt: boolean
  /** Fields the model does not understand, preserved for the generic renderer. */
  unknownFields: Record<string, unknown>
}

export interface BuildPhase {
  /** Stable anchor id: slug of the phase name. */
  id: string
  index: number
  name: string
  status: PhaseStatus
  /** `done` as the generator reported it. `null` when it did not report one. */
  declaredDone: number | null
  declaredTotal: number | null
  /** Recomputed from step statuses - the value the frontier derivation trusts. */
  completedSteps: number
  totalSteps: number
  /** False when the generator's counters disagree with its own step statuses. */
  countersConsistent: boolean
  isFrontier: boolean
  isHole: boolean
  hasFailure: boolean
  steps: BuildStep[]
  incompleteSteps: string[]
  timing: PhaseTiming
  /** Report sections bound to this phase, primary first. */
  sectionIds: string[]
  /** Literal step-status values the model does not recognise, kept visible. */
  unknownStatusValues: string[]
}

export interface PipelineHeadline {
  phasesComplete: number | null
  stepsComplete: number | null
  stepsTotal: number | null
}

export interface PipelineSummary extends SummaryMeta {
  phases: BuildPhase[]
  /** Every step, flattened in declared order. */
  steps: BuildStep[]
  /** Highest phase index with any completed step. `null` when nothing has completed. */
  frontierIndex: number | null
  frontierPhaseId: string | null
  frontierPhaseName: string | null
  /** Phases behind the frontier that never finished. NOT where the build stopped. */
  holes: BuildPhase[]
  phaseStatusCounts: Record<PhaseStatus, number>
  /** What the generator claimed. */
  declaredHeadline: PipelineHeadline
  /** What the step statuses say. */
  computedHeadline: PipelineHeadline
  headlineConsistent: boolean
  warnings: string[]
}

/* -- Mapping ------------------------------------------------------------------------------ */

/**
 * The four mechanisms present in the data. `exten` is a STAGE, not a mechanism - its gain is
 * booked to `HMM_scoring`, so the brief's five-mechanism list does not match this report.
 */
export type KnownMechanism = 'ID' | 'BLAST' | 'HMM_scoring' | 'RECLUSTER_NEW'

export interface MechanismSlot {
  mechanism: string
  /** Stable index so a chart segment keeps its colour across every stage. */
  slot: number
  label: string
  /** Registry key for this mechanism's generator-supplied definition. */
  definitionId: string
  known: boolean
}

export interface MechanismCount {
  mechanism: string
  slot: number
  /** Cumulative total at this stage, as the report stores it. */
  cumulative: number | null
  /** Change from the previous stage that reported this mechanism. */
  delta: number | null
  /** True for the first stage a mechanism appears in, where the cumulative IS the gain. */
  isFirstAppearance: boolean
}

export interface MappingStage {
  id: string
  stage: string
  order: number | null
  mappingFile: string | null
  totalSequences: number | null
  assigned: number | null
  unassigned: number | null
  /** As reported. `recomputedPctAssigned` is the model's own value. */
  pctAssigned: number | null
  recomputedPctAssigned: number | null
  families: number | null
  /** Change in assigned sequences from the previous stage. */
  assignedDelta: number | null
  totalSequencesDelta: number | null
  familiesDelta: number | null
  byMechanism: MechanismCount[]
  unknownFields: Record<string, unknown>
}

export interface MappingSummary extends SummaryMeta {
  stages: MappingStage[]
  /** Every stage carries the same order, so segment colours never move. */
  mechanismOrder: MechanismSlot[]
  firstStageId: string | null
  finalStageId: string | null
  inputSequences: number | null
  finalTotalSequences: number | null
  finalAssigned: number | null
  finalFamilies: number | null
  firstPctAssigned: number | null
  finalPctAssigned: number | null
  /** Percentage POINTS, not a percentage change. */
  assignmentGainPoints: number | null
  declaredHeadline: {
    finalStage: string | null
    finalTotalSeqs: number | null
    finalAssigned: number | null
    finalPctAssigned: number | null
    finalFamilies: number | null
  }
}

/* -- Node forward tracking ---------------------------------------------------------------- */

export interface NodeTypeTracking {
  nodeType: string
  mapped: number | null
  total: number | null
  pct: number | null
  recomputedPct: number | null
}

export interface SpeciesTracking {
  oscode: string
  mapped: number | null
  total: number | null
  pct: number | null
  recomputedPct: number | null
}

export interface NodeTrackingSummary extends SummaryMeta {
  nodesMapped: number | null
  nodesTotal: number | null
  pctMapped: number | null
  recomputedPctMapped: number | null
  speciesReported: number | null
  byType: NodeTypeTracking[]
  bySpecies: SpeciesTracking[]
  /** Species at exactly 0 %, which needs cross-section context before it means anything. */
  zeroPctOscodes: string[]
  /** Species below `lowOutlierThreshold`, ascending. */
  lowOutliers: SpeciesTracking[]
  lowOutlierThreshold: number
  medianPct: number | null
  madPct: number | null
  atOrAbove90: number | null
  warnings: string[]
}

/* -- Reclustering (TribeMCL) -------------------------------------------------------------- */

/** One row of the generator's cluster-outcome table. */
export interface ReclusterOutcome {
  outcome: string
  clusters: number | null
  sequences: number | null
}

export interface ReclusterSummary extends SummaryMeta {
  familiesCreated: number | null
  sequencesInNewFamilies: number | null
  familiesInherited: number | null
  sequencesInInheritedFamilies: number | null
  clustersFormed: number | null
  sequencesOffered: number | null
  newFamilyIdMin: string | null
  newFamilyIdMax: string | null
  outcomes: ReclusterOutcome[]
  warnings: string[]
}

/* -- Library, trees ----------------------------------------------------------------------- */

export interface LibrarySummary extends SummaryMeta {
  genomes: number | null
  sequences: number | null
  families: number | null
  subfamilies: number | null
  rows: { metric: string; value: number | null; rawValue: unknown }[]
}

/* -- Reference proteomes (per-proteome source provenance, pipeline issue #65) --------------- */

/** One (source, release) bucket of the reference-proteome roster. */
export interface ProteomeCompositionBucket {
  /** `QfO` or `RefProt` - which store the proteome was taken from. */
  source: string
  /** That store's release, e.g. `2026_02`. */
  release: string
  count: number
  /**
   * True when this is the single largest release for its source. A source whose releases tie has
   * no majority, and every one of its buckets is `false` - there is nothing to be the odd one out
   * of.
   */
  isSourceMajority: boolean
}

/** One row of the reference-proteome roster, as `create_taxonomy.pl` stamped it. */
export interface ProteomeRosterRow {
  up: string | null
  oscode: string | null
  taxid: string | null
  name: string | null
  source: string | null
  version: string | null
  prevUp: string | null
  prevSource: string | null
  prevVersion: string | null
  /** `new`, `up_changed`, `source_changed`, `version_changed`, `same_up`, `unchanged`. */
  change: string | null
}

/** How each proteome changed against the previous library's roster. */
export interface ProteomeChangeCounts {
  new: number | null
  upChanged: number | null
  sourceChanged: number | null
  versionChanged: number | null
  sameUp: number | null
  unchanged: number | null
  dropped: number | null
}

export interface ProteomesSummary extends SummaryMeta {
  total: number | null
  /** Sources in roster order, each source's releases largest first. */
  composition: ProteomeCompositionBucket[]
  /** `QfO 2026_02 (67) · RefProt 2026_01 (24)`, or `null` when nothing was read. */
  compositionLabel: string | null
  /** Proteomes not on their source's majority release. Deliberate, or a stamping error. */
  offMajorityCount: number
  changeCounts: ProteomeChangeCounts
  /**
   * Whether the previous library's roster carried the post-#65 source/release columns. When it did
   * not, `versionChanged: 0` means "not measurable", not "nothing moved", and the view must say so
   * rather than let a reader read stability into it.
   */
  previousRosterStamped: boolean
  roster: DerivedTable<ProteomeRosterRow>
  dropped: DerivedTable<ProteomeRosterRow>
  text: string | null
  warnings: string[]
}

export interface TreeSummary extends SummaryMeta {
  booksTotal: number | null
  treesBuilt: number | null
  treesSucceeded: number | null
  emptyTrees: number | null
  usableTreePct: number | null
  text: string | null
}

/* -- Config and provenance ---------------------------------------------------------------- */

export interface ConfigEntry {
  key: string
  value: string
  /** `resolved` is the generator's own value; `file` comes from the captured config.mk. */
  origin: 'resolved' | 'file' | 'ledger'
  /** True for commented-out export lines - evidence a mismatch finding needs to keep. */
  commentedOut: boolean
  /** 1-based line number in the captured config.mk, when it came from there. */
  line: number | null
}

export interface ConfigLineageEntry {
  key: string
  value: string
  /** Major release token found in the value, e.g. `19`, `18`, `17`, or `null` if none. */
  release: string | null
}

export interface ConfigSummary extends SummaryMeta {
  generatedAt: TimePoint
  sourceRevision: string | null
  sourceDirty: boolean | null
  configFile: string | null
  /** The captured config.mk verbatim. Evidence, not a convenience. */
  configFileContents: string | null
  /** Active export lines from the captured file, in file order. */
  fileEntries: ConfigEntry[]
  /** Commented-out export lines - the literal evidence a QfO mismatch finding rests on. */
  commentedEntries: ConfigEntry[]
  /** The generator's own resolved values. */
  resolvedEntries: ConfigEntry[]
  /** The section's `rows[]` ledger, as written. */
  ledgerEntries: ConfigEntry[]
  /** Every key from any origin, resolved value winning. */
  values: Record<string, string>
  unresolvedVars: string[]
  recordCount: number | null
  text: string | null
  warnings: string[]
  /** `PREV_*` (excluding `PREV_PREV_*`) keys and the release each one references. */
  previousLineage: ConfigLineageEntry[]
  previousPreviousLineage: ConfigLineageEntry[]
  /** Every config value carrying a release token, so a check can spot inherited inputs. */
  releaseReferences: ConfigLineageEntry[]
  pantherVersion: string | null
  qfoDataDir: string | null
  qfoReleaseVersion: string | null
  previousReleaseDir: string | null
  /** Declared-but-empty keys. A real observation, not a missing value. */
  emptyValueKeys: string[]
}

/* -- Comparison to the previous library --------------------------------------------------- */

export interface TableTruncation {
  truncated: boolean
  includedRows: number
  totalRows: number | null
  /** A COUNT of ragged rows, not a boolean. It is 813 on one table in this fixture. */
  raggedRows: number | null
  hasRaggedRows: boolean
  /** False whenever the rows are a subset - sorting a subset implies completeness. */
  allowClientSort: boolean
  allowClientFilter: boolean
  /** Reads like `50 of 147 rows included in report`. */
  label: string
}

export interface DerivedTable<TRow> extends SummaryMeta {
  key: string
  name: string
  columns: string[]
  rows: TRow[]
  /** The rows exactly as the report wrote them. */
  rawRows: unknown[]
  truncation: TableTruncation
  /** Column whose cell values are terms the section defined. `null` when the table names none. */
  definesColumn: string | null
}

export interface SpeciesCountChange {
  oscode: string
  previousCount: number | null
  currentCount: number | null
  /** Recomputed, not echoed. */
  countDiff: number | null
  /** Recomputed fraction; the report's own `pct_change` is kept as `reportedPctChange`. */
  fractionChange: number | null
  /** Recomputed percentage. `-100` for a full removal, where the report stores `-1.0`. */
  percentChange: number | null
  reportedPctChange: number | null
  isRemoval: boolean
  isAddition: boolean
}

export interface UniprotMatchRow {
  oscode: string
  totalSequences: number | null
  sameUniprot: number | null
  pctSameUniprot: number | null
  diffUniprot: number | null
  noPreviousMatch: number | null
  /** True when every sequence is unmatched - corroborating evidence for a new species. */
  allUnmatched: boolean
}

export interface UniRuleRow {
  uniRule: string
  families: string[]
  familyCount: number | null
}

export interface ComparisonContributor {
  sectionId: string
  what: string
  present: boolean
  note: string | null
}

export interface ComparisonMetric {
  /** The definition that labels the CURRENT side. */
  metricId: MetricId
  /**
   * The definition that labels the PREVIOUS side, which is often a different concept: the previous
   * figure for input sequences is `prevLibSequences`, not `inputReferenceSequences`. A view that
   * labelled both sides with `metricId` would mislabel the previous release's number.
   */
  previousMetricId: MetricId
  previous: number | null
  current: number | null
  delta: number | null
  percentChange: number | null
  /** Where each side came from, since they rarely come from the same section. */
  previousSource: string | null
  currentSource: string | null
}

export type SpeciesLinkKind = 'rename' | 'replacement'

export interface SpeciesLink {
  kind: SpeciesLinkKind
  removed: string
  added: string
  removedCount: number
  addedCount: number
  /** 0 for an exact match. */
  countDelta: number
  confidence: 'exact' | 'likely'
  evidence: string[]
}

export interface PreviousLibrarySummary extends SummaryMeta {
  genomes: number | null
  sequences: number | null
  families: number | null
  subfamilies: number | null
}

/**
 * Why a comparison is not fully available.
 *
 * `partial` has two causes and they are not interchangeable - the direct totals being absent, and
 * the per-species tables being cut short - so the reason is decided here, once, rather than being
 * re-derived by each view that wants to name it.
 */
export type ComparisonGap = 'noSources' | 'previousLibraryAbsent' | 'tablesTruncated'

export interface ComparisonSummary extends SummaryMeta {
  /** What is missing, or null when the comparison is complete. */
  gap: ComparisonGap | null
  /** Every source that fed this view, and whether it was actually present. */
  contributors: ComparisonContributor[]
  metrics: ComparisonMetric[]
  speciesCounts: DerivedTable<SpeciesCountChange>
  uniprotAgreement: DerivedTable<UniprotMatchRow>
  /** The aggregate `TOTAL` row the UniProt table carries; it is not a species. */
  uniprotTotals: UniprotMatchRow | null
  renames: SpeciesLink[]
  replacements: SpeciesLink[]
  addedOscodes: string[]
  removedOscodes: string[]
  /** `prev_lib` itself, so the UI can say why the direct comparison is missing. */
  previousLibrary: PreviousLibrarySummary
}

/* -- Species cross-section ---------------------------------------------------------------- */

export interface FieldOrigin {
  sectionId: string
  tableName: string | null
  /** True when this source actually carried a row for this species. */
  present: boolean
  /** True when the source is a truncated subset, so absence means unknown, not zero. */
  truncated: boolean
}

export interface SpeciesField<TValue> {
  value: TValue | null
  present: boolean
  origin: FieldOrigin
}

export interface SpeciesRecord {
  oscode: string
  nodeTracking: SpeciesField<SpeciesTracking>
  counts: SpeciesField<SpeciesCountChange>
  uniprot: SpeciesField<UniprotMatchRow>
  /** True only on positive evidence. A species absent from a truncated table stays unknown. */
  isNewInBuild: boolean
  isRemoved: boolean
  newInBuildConfidence: 'confirmed' | 'reported' | 'unknown'
  /** Human-readable corroboration, one line per source that supports the flag. */
  evidence: string[]
  renameOf: string | null
  renamedTo: string | null
  replacementOf: string | null
  replacedBy: string | null
  links: SpeciesLink[]
  /** Sections that do not cover this species, so a view can say "unknown" rather than "0". */
  missingFrom: string[]
}

export interface SpeciesCrossSection extends SummaryMeta {
  records: SpeciesRecord[]
  byOscode: Record<string, SpeciesRecord>
  /** Total distinct oscodes across every source, aggregate rows excluded. */
  oscodeCount: number
  coverage: {
    nodeTracking: number
    counts: number
    uniprot: number
    countsTotalRows: number | null
    uniprotTotalRows: number | null
  }
  newOscodes: string[]
  removedOscodes: string[]
  renames: SpeciesLink[]
  replacements: SpeciesLink[]
}

/* -- Other reports ------------------------------------------------------------------------ */

export interface OtherReportsSummary extends SummaryMeta {
  text: string | null
  metrics: { key: string; value: number | null; rawValue: unknown; metricId: MetricId | null }[]
  values: Record<string, number | null>
  speciesCounts: DerivedTable<SpeciesCountChange>
  uniprotMatch: DerivedTable<UniprotMatchRow>
  uniRules: DerivedTable<UniRuleRow>
  /** Tables the model has no specialised reading for, kept for the generic renderer. */
  otherTables: DerivedTable<Record<string, unknown>>[]
}

/* -- Report registry and generic fallback ------------------------------------------------- */

export type ReportPlacement = 'preamble' | 'pipeline' | 'phase' | 'unattached'

export interface GenericHeadlineValue {
  key: string
  label: string
  value: unknown
  formatted: string
}

/**
 * One term a collector defined, carried in the section's `data.definitions`.
 *
 * The pipeline writes these beside the tuple that lists its buckets, so the vocabulary travels
 * with the numbers instead of being re-guessed here. Namespaced by section id before it reaches
 * the definitions registry, so two collectors may define the same word differently.
 */
export interface GeneratorDefinition {
  term: string
  label: string
  definition: string
}

export interface GenericSectionView {
  headline: GenericHeadlineValue[]
  rows: { key: string; value: unknown; formatted: string }[]
  tables: DerivedTable<Record<string, unknown>>[]
  text: string | null
  warnings: string[]
  /**
   * Vocabulary the generator supplied for this section's bucket strings. Only one lookup path
   * consumes this: a `defines` table column resolves its cell values here (`GenericTable`), via
   * ids namespaced `sectionId.term` (`generatorDefinitionId`). Headline values and `rows[].metric`
   * keys do NOT look up here - only the curated registry resolves those - so a term that appears
   * solely in a headline or rows key gets no tooltip today.
   */
  definitions: GeneratorDefinition[]
  /** `data` keys the generic view did not consume, so nothing is silently discarded. */
  extra: Record<string, unknown>
}

export interface ReportRegistryEntry {
  sectionId: string
  index: number
  title: string | null
  status: SectionStatus
  message: string | null
  availability: Availability
  /** True when a specialised extractor exists for this id. */
  known: boolean
  placement: ReportPlacement
  phaseIds: string[]
  primaryPhaseId: string | null
  /** Value of the optional per-section phase hint, when the generator supplied one. */
  phaseHint: string | null
  anchor: string
  generic: GenericSectionView
  /** Top-level section keys the model does not understand. */
  unknownFields: string[]
  raw: unknown
}

/* -- Checks (types only; the derived-checks layer consumes them) --------------------------- */

export type CheckState = 'pass' | 'warn' | 'absent'
export type CheckOrigin = 'generator' | 'dashboard'

export interface Check {
  id: string
  state: CheckState
  label: string
  explanation: string
  source: string
  anchor: string
  origin: CheckOrigin
  evidence: string[]
}

export interface GeneratorWarning {
  id: string
  sectionId: string
  message: string
  anchor: string
  origin: 'generator'
}

/* -- Joined facts a check layer would otherwise have to re-derive -------------------------- */

export interface AgreementFact {
  id: string
  label: string
  values: { label: string; value: number | null; source: string }[]
  allEqual: boolean
  /** True when at least two values were present, so equality means something. */
  comparable: boolean
}

export interface ConsistencyFacts {
  familyAgreement: AgreementFact
  leafLibraryAgreement: AgreementFact
  treeCompleteness: {
    booksTotal: number | null
    treesSucceeded: number | null
    emptyTrees: number | null
    complete: boolean
  }
  sequenceCounts: { metricId: MetricId; value: number | null; source: string }[]
  unresolvedVars: string[]
  sourceDirty: boolean | null
  qfoDeclaredRelease: string | null
  qfoActiveDataDir: string | null
  qfoReleaseMatchesDataDir: boolean | null
  qfoCommentedEvidence: ConfigEntry[]
}

/* -- Schema, health, identity ------------------------------------------------------------- */

export type SchemaSupportState = 'supported' | 'newer' | 'older' | 'unknown'

export interface SchemaSupport {
  /** The literal value from the report, whatever type it was. */
  reported: unknown
  version: number | null
  state: SchemaSupportState
  supported: readonly number[]
  /** True whenever the model cannot claim full understanding of the payload. */
  degraded: boolean
  label: string
  explanation: string
}

export type HealthSignal = 'ok' | 'attention' | 'degraded' | 'unknown'

export interface HealthSummary extends SummaryMeta {
  signal: HealthSignal
  generatorWarningCount: number
  degradedSectionIds: string[]
  absentSectionIds: string[]
  unknownSectionIds: string[]
  /** Every literal enum value the model did not recognise, with where it appeared. */
  unknownStatusValues: { scope: string; value: string }[]
  ingestErrorCount: number
  ingestWarningCount: number
  schemaDegraded: boolean
  truncatedTableCount: number
}

export interface BuildIdentity extends SummaryMeta {
  target: string | null
  pantherVersion: string | null
  /** A display name for the library being built, or the target when the version is unknown. */
  libraryLabel: string | null
  generatedAt: TimePoint
  sourceRevision: string | null
  sourceDirty: boolean | null
  qfoDataDir: string | null
  qfoReleaseVersion: string | null
  previousLibraryLabel: string | null
  configFile: string | null
  sectionCount: number
}

/* -- The report --------------------------------------------------------------------------- */

export interface BuildReport {
  schema: SchemaSupport
  identity: BuildIdentity
  health: HealthSummary
  freshness: FreshnessSummary
  timing: TimingModel
  pipeline: PipelineSummary
  mapping: MappingSummary
  recluster: ReclusterSummary
  nodeTracking: NodeTrackingSummary
  proteomes: ProteomesSummary
  library: LibrarySummary
  trees: TreeSummary
  config: ConfigSummary
  comparison: ComparisonSummary
  species: SpeciesCrossSection
  otherReports: OtherReportsSummary
  consistency: ConsistencyFacts
  reports: ReportRegistryEntry[]
  generatorWarnings: GeneratorWarning[]
  /** Everything the parser had to work around. Never empty on a malformed input. */
  ingestNotes: IngestNote[]
  /** The input, untouched, so nothing is ever discarded. */
  raw: unknown
}

/* -- Metric ids (definitions.ts owns the labels) ------------------------------------------- */

export type MetricId =
  | 'prevLibSequences'
  | 'inputReferenceSequences'
  | 'finalStageSequences'
  | 'assignedSequences'
  | 'librarySequences'
  | 'leafNodesMapped'
  | 'reclusteredIntoExistingFamilies'
  | 'reclusteredIntoNewFamilies'
  | 'unassignedSequences'
  | 'families'
  | 'subfamilies'
  | 'genomes'
  | 'speciesReported'
  | 'speciesTotal'
  | 'pctAssigned'
  | 'assignmentGainPoints'
  | 'nodesMapped'
  | 'nodesTotal'
  | 'pctNodesMapped'
  | 'booksTotal'
  | 'treesSucceeded'
  | 'emptyTrees'
  | 'prevUniprotProteomes'
  | 'prevUniprotTotalSeqs'
  | 'prevUniprotSameUniprot'
  | 'prevUniprotPctSame'
  | 'uniRulesInMultipleFamilies'
  | 'blastSequencesChecked'
  | 'blastLengthsCompared'
  | 'blastLengthRatioOutliers'
  | 'blastAvgLenQuotient'
  | 'phasesComplete'
  | 'stepsComplete'
  | 'stepsTotal'
  | 'reportLeadTime'
