import { describe, expect, it } from 'vitest'
import {
  ABSENT_TIME_POINT,
  CONCURRENCY_WINDOW_SECONDS,
  computeTiming,
  elapsedBetween,
  formatDuration,
  makeMeta,
  parseBuildState,
  timePointFromEpochSeconds,
  timePointFromIso,
  timePointFromUnknown,
} from '@/features/build/model'
import { getFixtureReport } from '@/features/build/fixtures'
import type { StepTimeInputs } from '@/features/build/model'

/**
 * The dual timing model, per Phase 3 of `.plans/feature/01-report-model.md` and the timing facts in
 * Appendix A.3: two out-of-order completed steps, roughly 29 h of artifact activity, and clusters
 * of artifacts landing within minutes of each other.
 */

const meta = makeMeta({ availability: 'available', sectionId: 'progress' })

function step(overrides: Partial<StepTimeInputs> & Pick<StepTimeInputs, 'id'>): StepTimeInputs {
  return {
    goal: overrides.id,
    phaseId: 'p',
    declaredIndex: 0,
    isComplete: true,
    artifactAt: ABSENT_TIME_POINT,
    startedAt: ABSENT_TIME_POINT,
    endedAt: ABSENT_TIME_POINT,
    jobId: null,
    ...overrides,
  }
}

describe('time points', () => {
  it('reads epoch seconds, ISO strings and neither', () => {
    expect(timePointFromEpochSeconds(1786898148.4076207).iso).toBe('2026-08-16T16:35:48.407Z')
    expect(timePointFromIso('2026-08-20T23:26:31Z').epochSeconds).toBe(1787268391)
    expect(timePointFromUnknown(1786898148).present).toBe(true)
    expect(timePointFromUnknown('2026-08-20T23:26:31Z').present).toBe(true)
    expect(timePointFromUnknown(null)).toEqual(ABSENT_TIME_POINT)
    expect(timePointFromUnknown('not a date')).toEqual(ABSENT_TIME_POINT)
    expect(timePointFromEpochSeconds(Number.NaN)).toEqual(ABSENT_TIME_POINT)
  })
})

describe('elapsed intervals', () => {
  it('clamps a negative interval at zero and says so', () => {
    const later = timePointFromEpochSeconds(2000)
    const earlier = timePointFromEpochSeconds(1000)
    expect(elapsedBetween(earlier, later)).toEqual({ seconds: 1000, clampedFromNegative: false })
    expect(elapsedBetween(later, earlier)).toEqual({ seconds: 0, clampedFromNegative: true })
  })

  it('returns null rather than zero when a bound is missing', () => {
    expect(elapsedBetween(ABSENT_TIME_POINT, timePointFromEpochSeconds(1))).toEqual({
      seconds: null,
      clampedFromNegative: false,
    })
  })

  it('formats durations at a readable scale', () => {
    expect(formatDuration(null)).toBe('unavailable')
    expect(formatDuration(0)).toBe('0s')
    expect(formatDuration(45)).toBe('45s')
    expect(formatDuration(600)).toBe('10m')
    expect(formatDuration(10440)).toBe('2.9h')
    expect(formatDuration(265440)).toBe('73.7h')
    expect(formatDuration(1209600)).toBe('14d')
  })
})

describe('computeTiming', () => {
  it('keeps declared order and artifact order separate', () => {
    const computation = computeTiming(
      [
        step({ id: 'a', declaredIndex: 0, artifactAt: timePointFromEpochSeconds(3000) }),
        step({ id: 'b', declaredIndex: 1, artifactAt: timePointFromEpochSeconds(1000) }),
        step({ id: 'c', declaredIndex: 2, artifactAt: timePointFromEpochSeconds(2000) }),
      ],
      meta
    )
    expect(computation.model.declaredOrder).toEqual(['a', 'b', 'c'])
    expect(computation.model.artifactOrder).toEqual(['b', 'c', 'a'])
  })

  it('labels an inferred span as artifact activity, not as runtime', () => {
    const computation = computeTiming(
      [
        step({ id: 'a', declaredIndex: 0, artifactAt: timePointFromEpochSeconds(0) }),
        step({ id: 'b', declaredIndex: 1, artifactAt: timePointFromEpochSeconds(10440) }),
      ],
      meta
    )
    const timing = computation.stepTiming.get('b')
    expect(timing?.provenance).toBe('inferred')
    expect(timing?.kind).toBe('artifact-activity')
    expect(timing?.label).toBe('≈ 2.9h elapsed')
    expect(timing?.inferredFromStepId).toBe('a')
    // The earliest artifact has no interval to infer, so it reports unavailable, not zero.
    expect(computation.stepTiming.get('a')?.seconds).toBeNull()
    expect(computation.stepTiming.get('a')?.provenance).toBe('unavailable')
  })

  it('prefers measured execution fields over inferred artifact times', () => {
    const computation = computeTiming(
      [
        step({
          id: 'a',
          artifactAt: timePointFromEpochSeconds(9000),
          startedAt: timePointFromEpochSeconds(1000),
          endedAt: timePointFromEpochSeconds(4600),
          jobId: 'slurm-1',
        }),
      ],
      meta
    )
    const timing = computation.stepTiming.get('a')
    expect(timing?.provenance).toBe('measured')
    expect(timing?.kind).toBe('measured-runtime')
    expect(timing?.seconds).toBe(3600)
    expect(timing?.jobId).toBe('slurm-1')
    expect(computation.model.hasMeasuredTiming).toBe(true)
  })

  it('reports unavailable timing for a step with no artifact and no execution fields', () => {
    const computation = computeTiming([step({ id: 'a', isComplete: false })], meta)
    expect(computation.stepTiming.get('a')).toMatchObject({
      seconds: null,
      provenance: 'unavailable',
      kind: 'none',
      label: 'Timing unavailable',
    })
  })

  it('flags tightly clustered artifacts as potentially concurrent', () => {
    const computation = computeTiming(
      [
        step({ id: 'a', declaredIndex: 0, artifactAt: timePointFromEpochSeconds(0) }),
        step({ id: 'b', declaredIndex: 1, artifactAt: timePointFromEpochSeconds(30) }),
        step({ id: 'c', declaredIndex: 2, artifactAt: timePointFromEpochSeconds(60) }),
        step({
          id: 'd',
          declaredIndex: 3,
          artifactAt: timePointFromEpochSeconds(CONCURRENCY_WINDOW_SECONDS * 4),
        }),
      ],
      meta
    )
    expect(computation.model.clusters).toHaveLength(2)
    expect(computation.model.clusters[0].stepIds).toEqual(['a', 'b', 'c'])
    expect(computation.model.clusters[0].potentiallyConcurrent).toBe(true)
    expect(computation.model.clusters[1].potentiallyConcurrent).toBe(false)
    expect(computation.stepTiming.get('b')?.potentiallyConcurrent).toBe(true)
    expect(computation.stepTiming.get('d')?.potentiallyConcurrent).toBe(false)
  })

  it('reports a phase with one artifact as having no interval rather than zero elapsed', () => {
    const computation = computeTiming(
      [step({ id: 'a', phaseId: 'only', artifactAt: timePointFromEpochSeconds(500) })],
      meta
    )
    const phase = computation.phaseTiming.get('only')
    expect(phase?.artifactCount).toBe(1)
    expect(phase?.seconds).toBeNull()
    expect(phase?.label).toBe('Single artifact — no interval')
  })
})

describe('timing on the real report', () => {
  const report = getFixtureReport('real')

  it('never exposes a negative elapsed value anywhere', () => {
    for (const stepEntry of report.pipeline.steps) {
      if (stepEntry.timing.seconds !== null)
        expect(stepEntry.timing.seconds).toBeGreaterThanOrEqual(0)
      if (stepEntry.timing.declaredDeltaSeconds !== null) {
        expect(stepEntry.timing.declaredDeltaSeconds).toBeGreaterThanOrEqual(0)
      }
    }
    for (const phase of report.pipeline.phases) {
      if (phase.timing.seconds !== null) expect(phase.timing.seconds).toBeGreaterThanOrEqual(0)
    }
  })

  it('marks exactly the two declared-order steps whose artifact predates their predecessor', () => {
    const flagged = report.pipeline.steps.filter(stepEntry => stepEntry.timing.declaredOutOfOrder)
    expect(flagged.map(stepEntry => stepEntry.goal)).toEqual([
      'organism.dat',
      'ftp/PANTHER_HMM_Classification_files/PANTHER20.0_HMM_classifications',
    ])
    expect(flagged.every(stepEntry => stepEntry.timing.declaredDeltaSeconds === 0)).toBe(true)
  })

  it('gives every phase with artifacts an inferred span labelled as activity', () => {
    const phase = report.pipeline.phases[12]
    expect(phase.timing.artifactCount).toBe(12)
    expect(phase.timing.provenance).toBe('inferred')
    expect(phase.timing.kind).toBe('artifact-activity')
    expect(phase.timing.label).toMatch(/^≈ /)
    // Final packaging (the frontier) now has its first artifact - a single one, so it is an
    // inferred instant rather than a span, not "no artifacts at all" any more.
    expect(report.pipeline.phases[13].timing.provenance).toBe('inferred')
    expect(report.pipeline.phases[13].timing.artifactCount).toBe(1)
  })

  it('puts the artifact-order timeline in ascending mtime order', () => {
    const byId = new Map(report.pipeline.steps.map(stepEntry => [stepEntry.id, stepEntry]))
    const times = report.timing.artifactOrder.map(
      id => byId.get(id)?.timing.artifactAt.epochSeconds ?? 0
    )
    expect(times).toHaveLength(59)
    for (let index = 1; index < times.length; index += 1) {
      expect(times[index]).toBeGreaterThanOrEqual(times[index - 1])
    }
    // The declared order is untouched by that sort.
    expect(report.timing.declaredOrder).toHaveLength(62)
    expect(report.timing.declaredOrder[0]).toBe('setup-resource-download--download-resources-touch')
  })
})

describe('freshness', () => {
  it('reads a report generated after its newest artifact as Current', () => {
    const report = getFixtureReport('real')
    expect(report.freshness.state).toBe('current')
    expect(report.freshness.explanation).toContain('after the newest artifact')
  })

  it('reads an artifact newer than the report as potentially stale', () => {
    const report = getFixtureReport('stale')
    expect(report.freshness.state).toBe('potentially-stale')
    expect(report.freshness.label).toBe('Potentially stale')
    expect(report.freshness.leadSeconds).toBeLessThan(0)
  })

  it('reads freshness as unknown when there is no artifact to compare against', () => {
    const report = parseBuildState({ generated_at: '2026-08-20T23:26:31Z', sections: [] })
    expect(report.freshness.state).toBe('unknown')
    expect(report.freshness.leadSeconds).toBeNull()
    expect(report.freshness.explanation).toContain('artifact timestamp')
  })

  it('reads freshness as unknown when the report does not say when it was generated', () => {
    const report = parseBuildState({ sections: [] })
    expect(report.freshness.state).toBe('unknown')
    expect(report.freshness.explanation).toContain('when it was generated')
  })
})
