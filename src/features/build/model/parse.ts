/**
 * `parseBuildState` - raw build JSON to derived build model.
 *
 * Two guarantees hold, and the tests exist to keep them holding:
 *
 * PURE. No `Date.now()`, no `Math.random()`, no argless `new Date()`. Every time value comes from
 * the report, so parsing the same input twice is deeply equal and a snapshot taken today still
 * renders identically next year.
 *
 * TOTAL. It never throws. Every extractor runs inside `safe`, which catches, records an ingest note
 * and substitutes an empty-but-valid summary for that part alone. `null`, `{}`, `{sections:'nope'}`,
 * a section whose `data` is a string, numbers arriving as strings and sections in reversed order all
 * produce a report - a degraded one, with the degradation visible in `ingestNotes` and in each
 * part's `availability`.
 */

import { reportAnchor } from './anchors'
import { sectionIdsForPhase, resolveBinding } from './binding'
import { buildComparison } from './comparison'
import { buildConsistencyFacts } from './consistency'
import {
  absentComparison,
  absentConfig,
  absentConsistency,
  absentHealth,
  absentIdentity,
  absentLibrary,
  absentMapping,
  absentNodeTracking,
  absentOtherReports,
  absentPipeline,
  absentPreviousLibrary,
  absentProteomes,
  absentSpecies,
  absentTrees,
  unknownFreshness,
} from './fallbacks'
import { createNoteSink, describeThrown, errorMeta, makeMeta } from './notes'
import { asNonEmptyString, asRecord, isRecord, roundTo } from './primitives'
import { evaluateSchema } from './schema'
import {
  absentSectionInput,
  extractConfig,
  extractLibrary,
  extractMapping,
  extractNodeTracking,
  extractOtherReports,
  extractPipeline,
  extractPreviousLibrary,
  extractProteomes,
  extractTrees,
  buildRegistryEntry,
  readPhaseIds,
  readSections,
  toSectionInput,
} from './sections'
import type { SectionInput } from './sections'
import { buildSpeciesCrossSection } from './species'
import { emptyTimingModel, formatDuration, timePointFromUnknown } from './timing'
import type { TimingComputation } from './timing'
import type {
  BuildIdentity,
  BuildReport,
  FreshnessSummary,
  GeneratorWarning,
  HealthSummary,
  ReportRegistryEntry,
  TimePoint,
} from './types'
import type { NoteSink } from './notes'

/** Section ids this model has a specialised extractor for. Anything else renders generically. */
export const KNOWN_SECTION_IDS: readonly string[] = [
  'config_ledger',
  'proteomes',
  'progress',
  'mapping',
  'node_tracking',
  'library',
  'prev_lib',
  'giga',
  'other_reports',
]

function safe<TValue>(
  sink: NoteSink,
  scope: string,
  compute: () => TValue,
  fallback: (reason: string) => TValue
): TValue {
  try {
    return compute()
  } catch (thrown) {
    const reason = describeThrown(thrown)
    sink.add('error', scope, 'This part of the report could not be read and was skipped.', reason)
    return fallback(reason)
  }
}

function computeFreshness(
  generatedAt: TimePoint,
  newestArtifactAt: TimePoint,
  newestArtifactStepId: string | null
): FreshnessSummary {
  if (!generatedAt.present) {
    return unknownFreshness('The report does not say when it was generated.')
  }
  if (!newestArtifactAt.present) {
    return unknownFreshness(
      'No step carries an artifact timestamp, so the report cannot be compared against one.'
    )
  }

  const lead = (generatedAt.epochSeconds ?? 0) - (newestArtifactAt.epochSeconds ?? 0)
  const current = lead >= 0
  const duration = formatDuration(Math.abs(lead))

  return {
    ...makeMeta({ availability: 'available', sectionId: null }),
    state: current ? 'current' : 'potentially-stale',
    generatedAt,
    newestArtifactAt,
    newestArtifactStepId,
    leadSeconds: roundTo(lead, 3),
    label: current ? 'Current' : 'Potentially stale',
    explanation: current
      ? `The report was generated ${duration} after the newest artifact it describes, so it ` +
        'covers every artifact it knows about.'
      : `An artifact is ${duration} newer than the report, so the report may not describe the ` +
        'current state of the build.',
  }
}

function buildIdentity(
  raw: unknown,
  config: ReturnType<typeof extractConfig>,
  generatedAt: TimePoint,
  sectionCount: number
): BuildIdentity {
  const root = asRecord(raw)
  const target = asNonEmptyString(root?.target)
  const version = config.pantherVersion
  const previousDir = config.previousReleaseDir
  const previousLabel =
    previousDir === null
      ? (config.previousLineage.find(entry => entry.release !== null)?.release ?? null)
      : (previousDir
          .split('/')
          .filter(part => part !== '')
          .pop() ?? null)

  const notes: string[] = []
  if (target === null) notes.push('The report does not name a build target.')
  if (version === null) notes.push('The configuration does not resolve a PANTHER version.')

  return {
    ...makeMeta({
      availability: target === null && version === null ? 'partial' : 'available',
      sectionId: null,
      notes,
    }),
    target,
    pantherVersion: version,
    libraryLabel: version === null ? target : `PANTHER ${version}`,
    generatedAt,
    sourceRevision: config.sourceRevision,
    sourceDirty: config.sourceDirty,
    qfoDataDir: config.qfoDataDir,
    qfoReleaseVersion: config.qfoReleaseVersion,
    previousLibraryLabel: previousLabel,
    configFile: config.configFile,
    sectionCount,
  }
}

function collectGeneratorWarnings(
  reports: readonly ReportRegistryEntry[],
  extra: readonly { sectionId: string; messages: readonly string[] }[]
): GeneratorWarning[] {
  const seen = new Set<string>()
  const warnings: GeneratorWarning[] = []
  const push = (sectionId: string, message: string) => {
    const key = `${sectionId}::${message}`
    if (seen.has(key)) return
    seen.add(key)
    warnings.push({
      id: `generator-${sectionId}-${warnings.length + 1}`,
      sectionId,
      message,
      anchor: reportAnchor(sectionId),
      origin: 'generator',
    })
  }
  for (const entry of reports) {
    for (const message of entry.generic.warnings) push(entry.sectionId, message)
  }
  for (const group of extra) {
    for (const message of group.messages) push(group.sectionId, message)
  }
  return warnings
}

function buildHealth(
  sink: NoteSink,
  reports: readonly ReportRegistryEntry[],
  generatorWarnings: readonly GeneratorWarning[],
  unknownStepStatuses: readonly { scope: string; value: string }[],
  schemaDegraded: boolean
): HealthSummary {
  const unknownStatusValues = [
    ...reports
      .filter(entry => entry.status.isUnknown && entry.status.raw !== null)
      .map(entry => ({ scope: `section:${entry.sectionId}`, value: entry.status.raw as string })),
    ...unknownStepStatuses,
  ]

  const truncatedTableCount = reports.reduce(
    (total, entry) =>
      total + entry.generic.tables.filter(table => table.truncation.truncated).length,
    0
  )

  const ingestErrorCount = sink.notes.filter(note => note.severity === 'error').length
  const ingestWarningCount = sink.notes.filter(note => note.severity === 'warning').length
  const degradedSectionIds = reports
    .filter(entry => entry.availability === 'error' || entry.availability === 'partial')
    .map(entry => entry.sectionId)
  const absentSectionIds = reports
    .filter(entry => entry.availability === 'absent')
    .map(entry => entry.sectionId)
  const unknownSectionIds = reports.filter(entry => !entry.known).map(entry => entry.sectionId)

  let signal: HealthSummary['signal']
  if (schemaDegraded || ingestErrorCount > 0) signal = 'degraded'
  else if (
    generatorWarnings.length > 0 ||
    absentSectionIds.length > 0 ||
    unknownStatusValues.length > 0 ||
    ingestWarningCount > 0
  ) {
    signal = 'attention'
  } else signal = 'ok'

  return {
    ...makeMeta({ availability: 'available', sectionId: null }),
    signal,
    generatorWarningCount: generatorWarnings.length,
    degradedSectionIds,
    absentSectionIds,
    unknownSectionIds,
    unknownStatusValues,
    ingestErrorCount,
    ingestWarningCount,
    schemaDegraded,
    truncatedTableCount,
  }
}

export function parseBuildState(raw: unknown): BuildReport {
  const sink = createNoteSink()

  const schema = safe(
    sink,
    'root',
    () => evaluateSchema(asRecord(raw)?.schema_version),
    () => evaluateSchema(undefined)
  )
  if (schema.degraded) {
    sink.add(
      schema.state === 'unknown' ? 'error' : 'warning',
      'root',
      schema.explanation,
      String(schema.reported)
    )
  }

  if (!isRecord(raw)) {
    sink.add(
      'error',
      'root',
      'The build report is not an object; every part of the model is unavailable.',
      raw === null ? 'null' : Array.isArray(raw) ? 'array' : typeof raw
    )
  }

  const { sections, skipped } = safe(
    sink,
    'root',
    () => readSections(raw),
    () => ({ sections: [], skipped: 0 })
  )
  if (skipped > 0) {
    sink.add('warning', 'root', `${skipped} entry in sections[] is not an object and was skipped.`)
  }
  if (isRecord(raw) && sections.length === 0) {
    sink.add('warning', 'root', 'The report contains no readable sections.')
  }

  /* Section inputs, in report order, plus duplicate-id detection. */
  const inputs: SectionInput[] = safe(
    sink,
    'root',
    () => sections.map((section, index) => toSectionInput(section, index)),
    () => []
  )
  const seenIds = new Set<string>()
  for (const input of inputs) {
    if (seenIds.has(input.sectionId)) {
      sink.add(
        'warning',
        `section:${input.sectionId}`,
        'A second section reuses this id; the first one feeds the specialised views.'
      )
    }
    seenIds.add(input.sectionId)
  }
  const pick = (sectionId: string): SectionInput =>
    inputs.find(input => input.sectionId === sectionId) ?? absentSectionInput(sectionId)

  /*
   * Phase ids come first because section bindings are filtered against them, and the phases then
   * carry the sections bound to them. Sections are matched by id, so a reversed sections[] array
   * parses identically.
   */
  const progressInput = pick('progress')
  const phaseIds = safe(
    sink,
    'section:progress',
    () => readPhaseIds(progressInput),
    () => []
  )
  const resolvedBindings = inputs.map(input => ({
    sectionId: input.sectionId,
    ...resolveBinding(input.sectionId, input.raw, phaseIds),
  }))
  const phaseSectionIds = (phaseId: string): string[] =>
    sectionIdsForPhase(phaseId, resolvedBindings)

  const pipelineExtraction = safe(
    sink,
    'section:progress',
    () => extractPipeline(progressInput, sink, phaseSectionIds),
    (reason): { pipeline: ReturnType<typeof absentPipeline>; timing: TimingComputation } => {
      const meta = errorMeta('progress', reason)
      return {
        pipeline: absentPipeline(meta),
        timing: {
          model: emptyTimingModel(meta),
          stepTiming: new Map(),
          phaseTiming: new Map(),
          newestArtifactStepId: null,
        },
      }
    }
  )
  const { pipeline, timing } = pipelineExtraction

  const config = safe(
    sink,
    'section:config_ledger',
    () => extractConfig(pick('config_ledger'), sink),
    reason => absentConfig(errorMeta('config_ledger', reason))
  )
  const mapping = safe(
    sink,
    'section:mapping',
    () => extractMapping(pick('mapping'), sink),
    reason => absentMapping(errorMeta('mapping', reason))
  )
  const nodeTracking = safe(
    sink,
    'section:node_tracking',
    () => extractNodeTracking(pick('node_tracking'), sink),
    reason => absentNodeTracking(errorMeta('node_tracking', reason))
  )
  const proteomes = safe(
    sink,
    'section:proteomes',
    () => extractProteomes(pick('proteomes'), sink),
    reason => absentProteomes(errorMeta('proteomes', reason))
  )
  const library = safe(
    sink,
    'section:library',
    () => extractLibrary(pick('library'), sink),
    reason => absentLibrary(errorMeta('library', reason))
  )
  const trees = safe(
    sink,
    'section:giga',
    () => extractTrees(pick('giga'), sink),
    reason => absentTrees(errorMeta('giga', reason))
  )
  const previousLibrary = safe(
    sink,
    'section:prev_lib',
    () => extractPreviousLibrary(pick('prev_lib'), sink),
    reason => absentPreviousLibrary(errorMeta('prev_lib', reason))
  )
  const otherReports = safe(
    sink,
    'section:other_reports',
    () => extractOtherReports(pick('other_reports'), sink),
    reason => absentOtherReports(errorMeta('other_reports', reason), 'other_reports')
  )

  const species = safe(
    sink,
    'join:species',
    () =>
      buildSpeciesCrossSection({
        nodeTracking,
        speciesCounts: otherReports.speciesCounts,
        uniprotMatch: otherReports.uniprotMatch,
        sink,
      }),
    reason => absentSpecies(errorMeta(null, reason))
  )

  const comparison = safe(
    sink,
    'join:comparison',
    () =>
      buildComparison({
        previousLibrary,
        library,
        otherReports,
        nodeTracking,
        mapping,
        species,
        sink,
      }),
    reason => absentComparison(errorMeta(null, reason), previousLibrary)
  )

  const consistency = safe(
    sink,
    'join:consistency',
    () => buildConsistencyFacts({ mapping, library, trees, nodeTracking, otherReports, config }),
    () => absentConsistency()
  )

  const freshness = safe(
    sink,
    'root',
    () =>
      computeFreshness(
        timePointFromUnknown(asRecord(raw)?.generated_at),
        timing.model.newestArtifactAt,
        timing.newestArtifactStepId
      ),
    reason => unknownFreshness(reason)
  )

  const reports = safe(
    sink,
    'root',
    () =>
      inputs.map(input =>
        buildRegistryEntry(input, KNOWN_SECTION_IDS.includes(input.sectionId), phaseIds, sink)
      ),
    () => [] as ReportRegistryEntry[]
  )

  const generatorWarnings = safe(
    sink,
    'root',
    () =>
      collectGeneratorWarnings(reports, [
        { sectionId: 'progress', messages: pipeline.warnings },
        { sectionId: 'node_tracking', messages: nodeTracking.warnings },
        { sectionId: 'config_ledger', messages: config.warnings },
      ]),
    () => [] as GeneratorWarning[]
  )

  const identity = safe(
    sink,
    'root',
    () => buildIdentity(raw, config, freshness.generatedAt, inputs.length),
    reason => absentIdentity(reason)
  )

  const unknownStepStatuses = pipeline.phases.flatMap(phase =>
    phase.unknownStatusValues.map(value => ({ scope: `phase:${phase.id}`, value }))
  )

  const health = safe(
    sink,
    'root',
    () => buildHealth(sink, reports, generatorWarnings, unknownStepStatuses, schema.degraded),
    reason => absentHealth(reason)
  )

  return {
    schema,
    identity,
    health,
    freshness,
    timing: timing.model,
    pipeline,
    mapping,
    nodeTracking,
    proteomes,
    library,
    trees,
    config,
    comparison,
    species,
    otherReports,
    consistency,
    reports,
    generatorWarnings,
    ingestNotes: [...sink.notes],
    raw,
  }
}

/**
 * Memoised parse, keyed by input identity.
 *
 * Parsing is memoised per state recipe, not per render: the fixture catalog hands back the same
 * state object for a given recipe, so a `WeakMap` on that object is enough and keeps the parser
 * itself pure.
 */
const reportCache = new WeakMap<object, BuildReport>()

export function parseBuildStateCached(raw: unknown): BuildReport {
  if (!isRecord(raw)) return parseBuildState(raw)
  const cached = reportCache.get(raw)
  if (cached !== undefined) return cached
  const report = parseBuildState(raw)
  reportCache.set(raw, report)
  return report
}
