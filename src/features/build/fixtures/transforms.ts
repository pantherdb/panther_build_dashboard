/**
 * Deterministic `BuildState -> BuildState` transforms over the real fixture.
 *
 * The prototype's application states are recipes over the real report, not hand-authored parallel
 * JSON files. A separate file drifts from the real schema, and a generator script once emitted a
 * state the real generator never would - phases reading 3/5 while all five steps said `done` -
 * because per-phase counters were not recomputed.
 *
 * Every transform is pure: it clones its input, never reads a clock or a random source, and derives
 * any new timestamp from timestamps already in the report. Every transform is also idempotent, so a
 * recipe can compose the same step twice without changing the result.
 *
 * A payload that is not an object passes straight through. `BuildState` forbids that at the type
 * level, but a recipe is the kind of thing that eventually gets pointed at an API response, and a
 * transform must not be the one place in the chain that throws when the parser would not.
 */

import {
  asArray,
  asNumber,
  asRecord,
  asString,
  asStringArray,
  cloneJson,
  isRecord,
} from '../model/primitives'
import type { BuildState, RawSection } from '../model/types'

export type BuildStateTransform = (state: BuildState) => BuildState

/** Left to right: `compose(a, b)(state)` applies `a` first. */
export function compose(...transforms: readonly BuildStateTransform[]): BuildStateTransform {
  return state => transforms.reduce((current, transform) => transform(current), state)
}

/* -- internal helpers -------------------------------------------------------------------- */

function clone(state: BuildState): BuildState {
  return cloneJson(state) as BuildState
}

function sectionsOf(state: BuildState): Record<string, unknown>[] {
  return asArray(state.sections).filter(isRecord)
}

function sectionOf(state: BuildState, sectionId: string): Record<string, unknown> | null {
  return sectionsOf(state).find(section => asString(section.id) === sectionId) ?? null
}

function dataOf(state: BuildState, sectionId: string): Record<string, unknown> | null {
  return asRecord(sectionOf(state, sectionId)?.data)
}

interface StepRef {
  phase: Record<string, unknown>
  phaseIndex: number
  step: Record<string, unknown>
  indexInPhase: number
  declaredIndex: number
}

function stepRefs(state: BuildState): StepRef[] {
  const refs: StepRef[] = []
  const phases = asArray(dataOf(state, 'progress')?.phases).filter(isRecord)
  let declaredIndex = 0
  phases.forEach((phase, phaseIndex) => {
    asArray(phase.steps)
      .filter(isRecord)
      .forEach((step, indexInPhase) => {
        refs.push({ phase, phaseIndex, step, indexInPhase, declaredIndex })
        declaredIndex += 1
      })
  })
  return refs
}

function maxMtime(refs: readonly StepRef[]): number | null {
  const times = refs
    .map(ref => asNumber(ref.step.mtime))
    .filter((value): value is number => value !== null)
  return times.length === 0 ? null : Math.max(...times)
}

function isoOf(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString()
}

/**
 * Rewrites every per-phase `done`/`total` and the headline from the step statuses now in the
 * state. Skipping this is what produced the impossible 3/5-with-five-done shape once already.
 */
function recomputeProgressCounters(state: BuildState): void {
  const progress = dataOf(state, 'progress')
  if (progress === null) return
  const phases = asArray(progress.phases).filter(isRecord)
  let stepsComplete = 0
  let stepsTotal = 0
  let phasesComplete = 0

  for (const phase of phases) {
    const steps = asArray(phase.steps).filter(isRecord)
    const done = steps.filter(step => asString(step.status) === 'done').length
    phase.done = done
    phase.total = steps.length
    stepsComplete += done
    stepsTotal += steps.length
    if (steps.length > 0 && done === steps.length) phasesComplete += 1
  }

  const headline = asRecord(progress.headline)
  if (headline !== null) {
    headline.phases_complete = phasesComplete
    headline.steps_complete = stepsComplete
    headline.steps_total = stepsTotal
  } else {
    progress.headline = {
      phases_complete: phasesComplete,
      steps_complete: stepsComplete,
      steps_total: stepsTotal,
    }
  }
}

/** Appends a warning only when it is not already present, keeping the transform idempotent. */
function appendWarning(data: Record<string, unknown> | null, message: string): void {
  if (data === null) return
  const existing = asStringArray(data.warnings)
  if (existing.includes(message)) return
  data.warnings = [...existing, message]
}

function frontierPhaseIndex(refs: readonly StepRef[]): number | null {
  let frontier: number | null = null
  for (const ref of refs) {
    if (asString(ref.step.status) === 'done') frontier = ref.phaseIndex
  }
  return frontier
}

/* -- transforms -------------------------------------------------------------------------- */

/**
 * A finished build. Every step becomes `done`, steps that had no artifact get one derived from the
 * newest existing mtime, and the counters are recomputed so the frontier lands on the last phase.
 * `generated_at` is pushed past the newest artifact when necessary so the report stays Current.
 */
export function toCompleted(): BuildStateTransform {
  return state => {
    if (!isRecord(state)) return state
    const next = clone(state)
    const refs = stepRefs(next)
    const base = maxMtime(refs)
    let offset = 0
    const step = 600

    for (const ref of refs) {
      if (asString(ref.step.status) !== 'done') ref.step.status = 'done'
      if (asNumber(ref.step.mtime) === null) {
        offset += step
        ref.step.mtime = base === null ? offset : base + offset
      }
    }
    recomputeProgressCounters(next)

    const newest = maxMtime(stepRefs(next))
    const generated = asString(next.generated_at)
    const generatedSeconds = generated === null ? null : Date.parse(generated) / 1000
    if (newest !== null && (generatedSeconds === null || generatedSeconds < newest)) {
      next.generated_at = isoOf(newest + 3600)
    }
    return next
  }
}

/** The phase an early build has reached. Kept as a constant so the state is described, not magic. */
export const EARLY_CUTOFF_PHASE_INDEX = 2

/**
 * A build in progress. Phases after the cutoff have not started, the cutoff phase has its first
 * step done, and the sections that only exist once mapping is finished are reported absent - the
 * same way the generator reports `prev_lib` when its inputs are not there yet.
 */
export function toEarly(): BuildStateTransform {
  return state => {
    if (!isRecord(state)) return state
    const next = clone(state)
    const refs = stepRefs(next)
    const cutoff = Math.min(EARLY_CUTOFF_PHASE_INDEX, Math.max(0, refs.at(-1)?.phaseIndex ?? 0))

    const retainedBase = maxMtime(refs.filter(ref => ref.phaseIndex < cutoff))

    for (const ref of refs) {
      if (ref.phaseIndex > cutoff) {
        ref.step.status = 'pending'
        ref.step.mtime = null
        continue
      }
      if (ref.phaseIndex < cutoff) continue
      if (ref.indexInPhase === 0) {
        ref.step.status = 'done'
        if (asNumber(ref.step.mtime) === null) {
          ref.step.mtime = retainedBase === null ? 600 : retainedBase + 600
        }
      } else {
        ref.step.status = 'pending'
        ref.step.mtime = null
      }
    }
    recomputeProgressCounters(next)

    // Mapping has only reached its first stages.
    const mapping = dataOf(next, 'mapping')
    if (mapping !== null) {
      const rows = asArray(mapping.rows).filter(isRecord).slice(0, 2)
      const keptStages = new Set(rows.map(row => asString(row.stage)))
      mapping.rows = rows
      mapping.by_mechanism = asArray(mapping.by_mechanism)
        .filter(isRecord)
        .filter(row => keptStages.has(asString(row.stage)))
      const last = rows.at(-1)
      mapping.headline = {
        final_stage: last === undefined ? null : asString(last.stage),
        final_total_seqs: last === undefined ? null : asNumber(last.total_seqs),
        final_assigned: last === undefined ? null : asNumber(last.assigned),
        final_pct_assigned: last === undefined ? null : asNumber(last.pct_assigned),
        final_n_families: last === undefined ? null : asNumber(last.n_families),
      }
    }

    for (const sectionId of ['node_tracking', 'library', 'giga']) {
      const section = sectionOf(next, sectionId)
      if (section === null) continue
      section.status = 'absent'
      section.message = 'inputs not present yet'
      section.data = null
    }
    return next
  }
}

/**
 * A failed step with attempt history. The real fixture has no populated `attempts`, so the failure
 * UI would otherwise be untested. Timestamps are derived from the failing phase's newest artifact,
 * and `started_at` / `ended_at` are set on the step so the measured-timing path is exercised too.
 */
export function toFailed(): BuildStateTransform {
  return state => {
    if (!isRecord(state)) return state
    const next = clone(state)
    const refs = stepRefs(next)
    if (refs.length === 0) return next

    const frontier = frontierPhaseIndex(refs)
    const lastPhaseIndex = refs.reduce((max, ref) => Math.max(max, ref.phaseIndex), 0)
    const candidates = refs.filter(ref => asString(ref.step.status) !== 'done')

    // A failure is only interesting here if something is behind it to block: `blocked` requires a
    // phase with zero completed steps after the failure. Failing an already-incomplete step at the
    // frontier is the natural story while the frontier sits mid-pipeline, and is still preferred.
    // But in the current report the frontier has reached the LAST declared phase (Final packaging,
    // 1/2) and no phase has zero progress at all, so that path can no longer produce a blocked
    // phase. The fallback fails a step in the latest phase that still has a phase after it.
    const blocksALaterPhase = (ref: StepRef): boolean => ref.phaseIndex < lastPhaseIndex
    const latestBlockingPhase = refs
      .filter(blocksALaterPhase)
      .reduce((max, ref) => Math.max(max, ref.phaseIndex), -1)
    const target =
      candidates.find(
        ref => frontier !== null && ref.phaseIndex === frontier && blocksALaterPhase(ref)
      ) ??
      refs.filter(ref => ref.phaseIndex === latestBlockingPhase).pop() ??
      candidates[0] ??
      null
    if (target === null) return next

    // Retract every phase after the failure. A build whose step failed cannot have gone on to
    // finish later phases, so leaving them `done` described a state that could not exist - and it
    // is what made `blocked` unreachable. Clearing them also recomputes the frontier back onto the
    // failed phase, which restores this fixture's stated shape: a failed step at the frontier that
    // blocks the phase behind it. The hole in Sequence-to-family mapping is earlier, so it stays a
    // separate phase and failed / blocked / hole remain three distinct things.
    for (const ref of refs) {
      if (ref.phaseIndex <= target.phaseIndex) continue
      ref.step.status = 'pending'
      ref.step.mtime = null
      delete ref.step.attempts
      delete ref.step.started_at
      delete ref.step.ended_at
      delete ref.step.job_id
    }

    // Based on the phases strictly BEFORE the target, which this transform never touches. Using
    // the target's own phase would not be idempotent: the first pass nulls the failed step's
    // mtime, so a second pass would compute a different base and produce different attempt
    // timestamps. `transform purity > toFailed applied twice equals applied once` covers this.
    const phaseBase =
      maxMtime(refs.filter(ref => ref.phaseIndex < target.phaseIndex)) ?? maxMtime(refs) ?? 0

    const attempts = [
      { offset: 600, duration: 900, job: 'slurm-4820561', reason: 'Job exceeded its memory limit' },
      {
        offset: 1800,
        duration: 1200,
        job: 'slurm-4820577',
        reason: 'Job exceeded its memory limit on retry with a larger allocation',
      },
      {
        offset: 3300,
        duration: 240,
        job: 'slurm-4820613',
        // Deliberately not naming an artifact: the step this transform fails is chosen from the
        // data, so a hardcoded artifact name risks naming the failing step itself.
        reason: 'A prerequisite from an earlier phase has not completed',
      },
    ]

    target.step.status = 'failed'
    target.step.mtime = null
    target.step.attempts = attempts.map((attempt, index) => ({
      attempt: index + 1,
      status: 'failed',
      started_at: isoOf(phaseBase + attempt.offset),
      ended_at: isoOf(phaseBase + attempt.offset + attempt.duration),
      job_id: attempt.job,
      log: `logs/${attempt.job}.out`,
      reason: attempt.reason,
    }))
    const last = attempts[attempts.length - 1]
    target.step.started_at = isoOf(phaseBase + last.offset)
    target.step.ended_at = isoOf(phaseBase + last.offset + last.duration)
    target.step.job_id = last.job

    recomputeProgressCounters(next)
    appendWarning(
      dataOf(next, 'progress'),
      `${asString(target.step.goal) ?? 'a step'} failed after ${attempts.length} attempts ` +
        `(last job ${last.job}); see logs/${last.job}.out`
    )
    return next
  }
}

/**
 * A build carrying generator warnings across several sections, with one section reported `warn`.
 * Exercises the "generator said this" side of the checks layer, which must stay visually distinct
 * from dashboard-derived findings.
 */
export function toWarning(): BuildStateTransform {
  return state => {
    if (!isRecord(state)) return state
    const next = clone(state)

    appendWarning(
      dataOf(next, 'progress'),
      'refProteomePANTHERmapping_updated_hmm is newer than tribe_mcl_reclustering.touch, which ' +
        'follows it in the build - possibly stale (driver-order heuristic, not a verified ' +
        'dependency)'
    )
    appendWarning(
      dataOf(next, 'node_tracking'),
      '14 species map forward below 90 %; review the low tail before release'
    )
    appendWarning(
      dataOf(next, 'config_ledger'),
      'SPECIES_TREE has not been refreshed for the taxa swapped in this build; confirm ' +
        'placement before using it as a baseline'
    )

    const nodeTracking = sectionOf(next, 'node_tracking')
    if (nodeTracking !== null) {
      nodeTracking.status = 'warn'
      nodeTracking.message = 'low tail of species forward-tracking coverage'
    }
    return next
  }
}

/** Removes a section entirely, which is a harder case than a section reported absent. */
export function stripSection(sectionId: string): BuildStateTransform {
  return state => {
    if (!isRecord(state)) return state
    const next = clone(state)
    next.sections = asArray(next.sections).filter(
      section => !(isRecord(section) && asString(section.id) === sectionId)
    ) as RawSection[]
    return next
  }
}

/** How many rows a truncated table keeps. */
export const TRUNCATED_ROW_LIMIT = 5

/**
 * A more aggressively truncated report. `total_rows` is preserved so the model can still say how
 * much is missing, and `ragged_rows` is given a non-zero count because it is a count, not a flag.
 */
export function toTruncated(): BuildStateTransform {
  return state => {
    if (!isRecord(state)) return state
    const next = clone(state)
    const other = dataOf(next, 'other_reports')
    if (other === null) return next

    const tables = asArray(other.tables).filter(isRecord)
    for (const table of tables) {
      const rows = asArray(table.rows)
      if (asNumber(table.total_rows) === null) table.total_rows = rows.length
      table.rows = rows.slice(0, TRUNCATED_ROW_LIMIT)
      table.truncated = true
      if (asStringArray(table.columns).includes('species')) table.ragged_rows = 7
    }
    other.text = `${tables.length} of ${tables.length} report(s) shown, rows truncated.`
    return next
  }
}

/** How far past the report time the stale artifact is placed. */
export const STALE_ARTIFACT_LEAD_SECONDS = 14400

/**
 * A report an artifact is newer than. The bumped artifact is the newest one, so freshness flips to
 * potentially-stale without touching any status.
 */
export function toStale(): BuildStateTransform {
  return state => {
    if (!isRecord(state)) return state
    const next = clone(state)
    const refs = stepRefs(next)
    const newest = maxMtime(refs)
    if (newest === null) return next

    const generated = asString(next.generated_at)
    const generatedSeconds = generated === null ? null : Date.parse(generated) / 1000
    const target =
      (Number.isFinite(generatedSeconds ?? NaN) ? (generatedSeconds as number) : newest) +
      STALE_ARTIFACT_LEAD_SECONDS

    const candidates = refs.filter(ref => asNumber(ref.step.mtime) === newest)
    const chosen = candidates[0]
    if (chosen !== undefined) chosen.step.mtime = target
    return next
  }
}

/**
 * Two report sections this dashboard has never seen. `pfam_coverage` carries no phase hint and so
 * collects under Unattached reports; `tree_quality` carries a `phase_id` hint, proving the binding
 * can be data-driven without a model change.
 */
export function withUnknownSection(): BuildStateTransform {
  return state => {
    if (!isRecord(state)) return state
    const next = clone(state)
    const sections = asArray(next.sections)
    const existing = new Set(sections.filter(isRecord).map(section => asString(section.id)))

    const additions: RawSection[] = []
    if (!existing.has('pfam_coverage')) {
      additions.push({
        id: 'pfam_coverage',
        title: 'Pfam domain coverage',
        status: 'ok',
        message: null,
        data: {
          text: 'Pfam 36.0 domains matched against library sequences.',
          headline: {
            sequences_with_domain: 1489204,
            sequences_total: 1736983,
            pct_with_domain: 85.7,
            distinct_domains: 19632,
          },
          rows: [
            { metric: 'sequences_with_domain', value: 1489204 },
            { metric: 'distinct_domains', value: 19632 },
            { metric: 'families_without_any_domain', value: 412 },
          ],
          tables: [
            {
              name: 'Most frequent domains',
              columns: ['pfam_id', 'name', 'sequences'],
              rows: [
                { pfam_id: 'PF00069', name: 'Pkinase', sequences: '41203' },
                { pfam_id: 'PF00005', name: 'ABC_tran', sequences: '28714' },
                { pfam_id: 'PF07690', name: 'MFS_1', sequences: '24188' },
              ],
              total_rows: 19632,
              truncated: true,
              ragged_rows: 0,
            },
          ],
          warnings: ['412 families have no Pfam domain match'],
        },
      })
    }
    if (!existing.has('tree_quality')) {
      additions.push({
        id: 'tree_quality',
        title: 'Tree quality summary',
        status: 'ok',
        message: null,
        phase_id: 'tree-building-giga',
        data: {
          headline: { trees_scored: 15797, median_support: 0.82, low_support_trees: 631 },
          rows: [
            { metric: 'trees_scored', value: 15797 },
            { metric: 'low_support_trees', value: 631 },
          ],
          warnings: [],
        },
      })
    }

    next.sections = [...sections, ...additions] as RawSection[]
    return next
  }
}

/** The unknown status values used by `withUnknownStatus`, exported so tests assert on them. */
export const UNKNOWN_SECTION_STATUS = 'degraded'
export const UNKNOWN_STEP_STATUS = 'skipped_by_operator'

/**
 * An unfamiliar section status and an unfamiliar step status, both of which must survive verbatim.
 * The step chosen is one that had not completed, so the phase counters stay honest and the state
 * remains self-consistent.
 */
export function withUnknownStatus(): BuildStateTransform {
  return state => {
    if (!isRecord(state)) return state
    const next = clone(state)

    const nodeTracking = sectionOf(next, 'node_tracking')
    if (nodeTracking !== null) nodeTracking.status = UNKNOWN_SECTION_STATUS

    const refs = stepRefs(next)
    // Guarded so a second application does not mark a second step.
    const alreadyApplied = refs.some(ref => asString(ref.step.status) === UNKNOWN_STEP_STATUS)
    const target = alreadyApplied
      ? undefined
      : refs.find(ref => asString(ref.step.status) !== 'done')
    if (target !== undefined) {
      target.step.status = UNKNOWN_STEP_STATUS
      target.step.mtime = null
    }
    return next
  }
}

/**
 * A build whose configuration changed while it was running.
 *
 * `reports/build_config.jsonl` is append-only: the pipeline appends one record each time the build
 * driver fires, so any restarted build carries more than one. The generator shows the latest and
 * flags the difference. The captured report has a single record, which means the read of the
 * ledger this dashboard shows - "these were the inputs" - is never put under pressure by the real
 * fixture, even though a restarted build is ordinary.
 *
 * Changes the field the QfO mismatch already turns on, so the two readings of the same value are
 * visible together.
 */
export function withConfigChange(): BuildStateTransform {
  return state => {
    if (!isRecord(state)) return state
    const next = clone(state)

    const ledger = dataOf(next, 'config_ledger')
    if (ledger === null) return next

    const current = isRecord(ledger.current) ? ledger.current : null
    if (current === null) return next

    ledger.record_count = 2
    const warnings = Array.isArray(ledger.warnings) ? [...ledger.warnings] : []
    warnings.push(
      'config_ledger holds 2 records: QFO_DATA_DIR changed between runs of the build driver ' +
        '(ref_prot_2025_04 → ref_prot_2026_01). Artifacts produced before the change were built ' +
        'against the earlier value.'
    )
    ledger.warnings = warnings
    return next
  }
}

/** The version `withFutureSchema` claims. Newer than anything the model declares support for. */
export const FUTURE_SCHEMA_VERSION = 2

export function withFutureSchema(): BuildStateTransform {
  return state => {
    if (!isRecord(state)) return state
    const next = clone(state)
    next.schema_version = FUTURE_SCHEMA_VERSION
    return next
  }
}
