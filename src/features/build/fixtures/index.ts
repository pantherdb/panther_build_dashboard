/**
 * The named fixture-state catalog.
 *
 * A state is a recipe over the real report, not a separate file: `transforms` names the steps and
 * `build()` applies them. Both the state and its parsed report are memoised per key, so a state is
 * parsed once per session rather than once per render, and the memoisation keys on the recipe
 * rather than on a component's identity.
 */

import { parseBuildStateCached } from '../model/parse'
import type { BuildReport, BuildState } from '../model/types'
import { buildStateSource, BUILD_STATE_SOURCE_PATH } from './source'
import {
  compose,
  stripSection,
  toCompleted,
  toEarly,
  toFailed,
  toStale,
  toTruncated,
  toWarning,
  withFutureSchema,
  withUnknownSection,
  withConfigChange,
  withUnknownStatus,
  withRecluster,
} from './transforms'
import type { BuildStateTransform } from './transforms'

export const FIXTURE_STATE_KEYS = [
  'real',
  'completed',
  'early',
  'failed',
  'warning',
  'missingNodeTracking',
  'truncated',
  'stale',
  'unknownSection',
  'unknownStatus',
  'configChanged',
  'futureSchema',
  'degraded',
  'recluster',
] as const

export type FixtureStateKey = (typeof FIXTURE_STATE_KEYS)[number]

export interface FixtureStateDefinition {
  key: FixtureStateKey
  label: string
  /** What the state demonstrates, in one sentence. */
  description: string
  /** The recipe, named so a UI can show how the state was produced. */
  transforms: readonly string[]
  apply: BuildStateTransform
}

const IDENTITY: BuildStateTransform = state => state

const DEFINITIONS: readonly FixtureStateDefinition[] = [
  {
    key: 'real',
    label: 'Real report',
    description:
      'The captured PANTHER 20.0 build report, unmodified: frontier at Library export products, ' +
      'a hole in Sequence-to-family mapping, and an absent previous-library section.',
    transforms: [],
    apply: IDENTITY,
  },
  {
    key: 'completed',
    label: 'Completed build',
    description:
      'Every step done, per-phase counters and the headline recomputed, and the report still ' +
      'generated after the newest artifact.',
    transforms: ['toCompleted'],
    apply: toCompleted(),
  },
  {
    key: 'early',
    label: 'Early build',
    description:
      'Stopped inside Sequence-to-family mapping, with the sections that depend on later phases ' +
      'reported absent.',
    transforms: ['toEarly'],
    apply: toEarly(),
  },
  {
    key: 'failed',
    label: 'Failed step',
    description:
      'A failed step at the frontier with three attempts, job ids, timestamps and log references, ' +
      'which also blocks the phase behind it.',
    transforms: ['toFailed'],
    apply: toFailed(),
  },
  {
    key: 'warning',
    label: 'Warning build',
    description: 'Generator warnings in three sections and one section reported as warn.',
    transforms: ['toWarning'],
    apply: toWarning(),
  },
  {
    key: 'missingNodeTracking',
    label: 'Missing node tracking',
    description:
      'The node forward tracking section removed entirely, so the species cross-section has to ' +
      'work from the comparison tables alone.',
    transforms: ["stripSection('node_tracking')"],
    apply: stripSection('node_tracking'),
  },
  {
    key: 'truncated',
    label: 'Truncated report',
    description:
      'Every table cut to five rows with the real totals preserved, and a non-zero ragged-row ' +
      'count.',
    transforms: ['toTruncated'],
    apply: toTruncated(),
  },
  {
    key: 'stale',
    label: 'Stale report',
    description:
      'An artifact four hours newer than the report, so freshness reads potentially stale.',
    transforms: ['toStale'],
    apply: toStale(),
  },
  {
    key: 'unknownSection',
    label: 'Unknown sections',
    description:
      'Two sections this dashboard has never seen: one unattached, one carrying a phase hint that ' +
      'binds it to tree building.',
    transforms: ['withUnknownSection'],
    apply: withUnknownSection(),
  },
  {
    key: 'unknownStatus',
    label: 'Unknown status values',
    description:
      'An unfamiliar section status and an unfamiliar step status, both preserved verbatim rather ' +
      'than coerced.',
    transforms: ['withUnknownStatus'],
    apply: withUnknownStatus(),
  },
  {
    key: 'configChanged',
    label: 'Config changed mid-build',
    description:
      'The append-only config ledger holds more than one record, so the resolved values describe ' +
      'the latest run of the driver rather than every artifact in the target.',
    transforms: ['withConfigChange'],
    apply: withConfigChange(),
  },
  {
    key: 'futureSchema',
    label: 'Newer schema',
    description:
      'A schema version this model does not claim to support, which must degrade visibly.',
    transforms: ['withFutureSchema'],
    apply: withFutureSchema(),
  },
  {
    key: 'degraded',
    label: 'Fully degraded',
    description:
      'Newer schema, an unknown section, an unknown status and a missing section at once - the ' +
      'worst case the generic renderer has to survive.',
    transforms: [
      'withFutureSchema',
      'withUnknownSection',
      'withUnknownStatus',
      "stripSection('prev_lib')",
    ],
    apply: compose(
      withFutureSchema(),
      withUnknownSection(),
      withUnknownStatus(),
      stripSection('prev_lib')
    ),
  },
  {
    key: 'recluster',
    label: 'With reclustering',
    description:
      'The real report plus the reclustering section, which the frozen reference predates: 153 ' +
      'families created from 2,823 sequences.',
    transforms: ['withRecluster'],
    apply: withRecluster(),
  },
]

export const FIXTURE_STATES: Record<FixtureStateKey, FixtureStateDefinition> = DEFINITIONS.reduce(
  (acc, definition) => {
    acc[definition.key] = definition
    return acc
  },
  {} as Record<FixtureStateKey, FixtureStateDefinition>
)

export const DEFAULT_FIXTURE_STATE_KEY: FixtureStateKey = 'real'

const stateCache = new Map<FixtureStateKey, BuildState>()

/** The raw state for a key. Memoised, so the parsed-report cache can key on object identity. */
export function getFixtureState(key: FixtureStateKey): BuildState {
  const cached = stateCache.get(key)
  if (cached !== undefined) return cached
  const definition = FIXTURE_STATES[key]
  const state = definition.apply(buildStateSource)
  stateCache.set(key, state)
  return state
}

export function getFixtureReport(key: FixtureStateKey): BuildReport {
  return parseBuildStateCached(getFixtureState(key))
}

/** Clears the memoised states and forces the next `getFixtureState` to rebuild. Tests use this. */
export function resetFixtureCache(): void {
  stateCache.clear()
}

export { BUILD_STATE_SOURCE_PATH, buildStateSource }
export * from './transforms'
