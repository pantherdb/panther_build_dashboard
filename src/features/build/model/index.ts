/** Public surface of the derived build model. Views import from here, never from a submodule. */

export * from './types'

export { parseBuildState, parseBuildStateCached, KNOWN_SECTION_IDS } from './parse'

export { extractProteomes } from './sections/proteomes'

export { extractRecluster } from './sections/recluster'

export { extractPreviousLibrary } from './sections/library'

export {
  CURRENT_SCHEMA_VERSION,
  evaluateSchema,
  isSupportedSchemaVersion,
  SUPPORTED_SCHEMA_VERSIONS,
} from './schema'

export {
  ANCHOR_PREFIX,
  BUILD_ROUTE,
  RELEASE_ROUTE,
  buildStepId,
  checkAnchor,
  checkElementId,
  checkRoute,
  configAnchor,
  configElementId,
  configRoute,
  metricAnchor,
  metricElementId,
  metricRoute,
  parseAnchor,
  phaseAnchor,
  phaseElementId,
  phaseRoute,
  reportAnchor,
  reportElementId,
  reportRoute,
  speciesAnchor,
  speciesElementId,
  speciesRoute,
  stepAnchor,
  stepElementId,
  stepRoute,
} from './anchors'
export type { AnchorKind, ParsedAnchor } from './anchors'

export {
  getBinding,
  hasBinding,
  phaseHintOf,
  PHASE_IDS,
  resolveBinding,
  SECTION_BINDINGS,
  sectionIdsForPhase,
  UNATTACHED_PHASE_ID,
  UNATTACHED_PHASE_NAME,
} from './binding'
export type { ResolvedBinding, SectionBinding } from './binding'

export {
  generatorDefinitionId,
  getMetricDefinition,
  METRIC_DEFINITIONS,
  METRIC_IDS,
  metricDefinitionAnchor,
  metricIdForReportKey,
  metricLabel,
  metricsInFamily,
  SEQUENCE_METRIC_IDS,
} from './definitions'
export type { MetricDefinition, MetricFamily, MetricUnit } from './definitions'

export { generatorDefinitions } from './generatorDefinitions'

export {
  ABSENT_TIME_POINT,
  CONCURRENCY_WINDOW_SECONDS,
  computeTiming,
  elapsedBetween,
  formatDuration,
  inferredElapsed,
  measuredElapsed,
  timePointFromEpochSeconds,
  timePointFromIso,
  timePointFromUnknown,
  UNAVAILABLE_ELAPSED,
} from './timing'
export type { ClampedInterval, StepTimeInputs, TimingComputation } from './timing'

export {
  availabilityFor,
  KNOWN_SECTION_STATUS_KINDS,
  KNOWN_STEP_STATUS_KINDS,
  missingSectionStatus,
  parseSectionStatus,
  parseStepStatus,
} from './status'

export {
  absentTable,
  buildTruncation,
  EMPTY_TRUNCATION,
  formatUnknownValue,
  makeDerivedTable,
  normaliseTable,
} from './tables'
export type { NormalisedTable } from './tables'

export {
  buildSpeciesCrossSection,
  detectSpeciesLinks,
  RENAME_REQUIRES_EXACT_COUNT,
  REPLACEMENT_COUNT_TOLERANCE,
  REPLACEMENT_PREFIX_LENGTH,
} from './species'
export type { SpeciesJoinInput, SpeciesLinkResult } from './species'

export { buildComparison } from './comparison'
export type { ComparisonInput } from './comparison'

export { buildConsistencyFacts } from './consistency'
export type { ConsistencyInput } from './consistency'

export {
  AGGREGATE_OSCODES,
  buildGenericView,
  humaniseKey,
  isAggregateOscode,
  isKnownMechanism,
  KNOWN_MECHANISM_ORDER,
  LOW_OUTLIER_THRESHOLD,
  MECHANISM_LABELS,
  parseConfigFile,
  readPhaseIds,
  releaseTokenOf,
  stepPositionLabel,
  toSectionInput,
} from './sections'
export type { SectionInput } from './sections'

export { createNoteSink, describeThrown, errorMeta, makeMeta, missingMeta } from './notes'
export type { NoteSink } from './notes'

export {
  asArray,
  asBoolean,
  asInteger,
  asNonEmptyString,
  asNumber,
  asString,
  asStringArray,
  cloneJson,
  difference,
  fractionChange,
  isRecord,
  percentOf,
  roundTo,
  slugify,
} from './primitives'
