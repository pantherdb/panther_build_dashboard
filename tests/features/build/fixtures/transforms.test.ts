import { describe, expect, it } from 'vitest'
import {
  buildStateSource,
  compose,
  EARLY_CUTOFF_PHASE_INDEX,
  FIXTURE_STATE_KEYS,
  FIXTURE_STATES,
  FUTURE_SCHEMA_VERSION,
  getFixtureReport,
  getFixtureState,
  stripSection,
  toCompleted,
  toEarly,
  toFailed,
  toStale,
  toTruncated,
  toWarning,
  TRUNCATED_ROW_LIMIT,
  UNKNOWN_SECTION_STATUS,
  UNKNOWN_STEP_STATUS,
  withFutureSchema,
  withUnknownSection,
  withUnknownStatus,
} from '@/features/build/fixtures'
import type { BuildStateTransform } from '@/features/build/fixtures'
import { parseBuildState } from '@/features/build/model'
import type { BuildReport, BuildState } from '@/features/build/model'

/**
 * Phase 9 and Phase 10 of `.plans/feature/01-report-model.md`.
 *
 * Two things are being defended. First, purity: a transform clones its input, reads no clock and no
 * random source, and composing it twice equals composing it once. Second, self-consistency: the
 * state a transform emits must be one the real generator could have emitted. The Failed Approaches
 * table records a generator that emitted a phase reading 3/5 while all five of its steps said
 * `done`, which makes the frontier derivation nonsense - so per-phase counters are re-checked
 * against step statuses for every state in the catalog.
 */

const NAMED_TRANSFORMS: [string, BuildStateTransform][] = [
  ['toCompleted', toCompleted()],
  ['toEarly', toEarly()],
  ['toFailed', toFailed()],
  ['toWarning', toWarning()],
  ['toTruncated', toTruncated()],
  ['toStale', toStale()],
  ['withUnknownSection', withUnknownSection()],
  ['withUnknownStatus', withUnknownStatus()],
  ['withFutureSchema', withFutureSchema()],
  ["stripSection('node_tracking')", stripSection('node_tracking')],
  ["stripSection('progress')", stripSection('progress')],
  ["stripSection('other_reports')", stripSection('other_reports')],
]

/** Every invariant a state has to satisfy for the pipeline derivation to mean anything. */
function expectSelfConsistent(report: BuildReport, label: string): void {
  for (const phase of report.pipeline.phases) {
    expect(phase.declaredDone, `${label}/${phase.id} done`).toBe(phase.completedSteps)
    expect(phase.declaredTotal, `${label}/${phase.id} total`).toBe(phase.totalSteps)
    expect(phase.countersConsistent, `${label}/${phase.id} counters`).toBe(true)
  }
  expect(report.pipeline.headlineConsistent, `${label} headline`).toBe(true)
  expect(report.pipeline.declaredHeadline).toEqual(report.pipeline.computedHeadline)

  for (const step of report.pipeline.steps) {
    // A completed step is completed because its goal artifact exists, so it must carry an mtime.
    expect(step.timing.artifactAt.present, `${label}/${step.id} artifact`).toBe(step.isComplete)
  }
}

describe('transform purity', () => {
  const before = JSON.stringify(buildStateSource)

  for (const [name, transform] of NAMED_TRANSFORMS) {
    it(`${name} leaves the source untouched`, () => {
      transform(buildStateSource)
      expect(JSON.stringify(buildStateSource)).toBe(before)
    })

    it(`${name} applied twice equals applied once`, () => {
      const once = transform(buildStateSource)
      const twice = transform(once)
      expect(twice).toEqual(once)
    })
  }

  it('composes left to right', () => {
    const chain = compose(withFutureSchema(), stripSection('prev_lib'))
    const state = chain(buildStateSource)
    expect(state.schema_version).toBe(FUTURE_SCHEMA_VERSION)
    expect((state.sections as { id: string }[]).some(section => section.id === 'prev_lib')).toBe(
      false
    )
  })
})

describe('every catalog state is self-consistent', () => {
  for (const key of FIXTURE_STATE_KEYS) {
    it(`"${key}" reports per-phase counters that match its step statuses`, () => {
      expectSelfConsistent(getFixtureReport(key), key)
    })
  }

  it('names the recipe that produced each state', () => {
    expect(FIXTURE_STATES.real.transforms).toEqual([])
    expect(FIXTURE_STATES.degraded.transforms).toContain('withFutureSchema')
    for (const key of FIXTURE_STATE_KEYS) {
      expect(FIXTURE_STATES[key].label.length).toBeGreaterThan(0)
      expect(FIXTURE_STATES[key].description.length).toBeGreaterThan(0)
    }
  })

  it('hands back the identical state object for a key, so parsing memoises', () => {
    expect(getFixtureState('real')).toBe(getFixtureState('real'))
    expect(getFixtureState('real')).toBe(buildStateSource)
  })
})

describe('toCompleted', () => {
  const report = getFixtureReport('completed')

  it('recomputes per-phase counters and the headline from the statuses it rewrote', () => {
    // The bug this guards against: 3/5 declared while all five steps say `done`.
    expect(report.pipeline.computedHeadline).toEqual({
      phasesComplete: 14,
      stepsComplete: 62,
      stepsTotal: 62,
    })
    expect(report.pipeline.declaredHeadline).toEqual(report.pipeline.computedHeadline)
    expect(report.pipeline.phases.every(phase => phase.status === 'complete')).toBe(true)
  })

  it('moves the frontier to the last phase and leaves no holes', () => {
    expect(report.pipeline.frontierIndex).toBe(13)
    expect(report.pipeline.frontierPhaseName).toBe('Final packaging')
    expect(report.pipeline.holes).toEqual([])
    expect(report.pipeline.phaseStatusCounts.hole).toBe(0)
  })

  it('gives every newly completed step an artifact time and keeps the report Current', () => {
    expect(report.pipeline.steps.every(step => step.timing.artifactAt.present)).toBe(true)
    expect(report.freshness.state).toBe('current')
    expect(report.freshness.leadSeconds ?? -1).toBeGreaterThan(0)
  })
})

describe('toEarly', () => {
  const report = getFixtureReport('early')

  it('stops the build inside the cutoff phase with nothing after it started', () => {
    expect(report.pipeline.frontierIndex).toBe(EARLY_CUTOFF_PHASE_INDEX)
    expect(report.pipeline.phases[EARLY_CUTOFF_PHASE_INDEX].status).toBe('active')
    expect(report.pipeline.phases[EARLY_CUTOFF_PHASE_INDEX].completedSteps).toBe(1)
    for (const phase of report.pipeline.phases.slice(EARLY_CUTOFF_PHASE_INDEX + 1)) {
      expect(phase.completedSteps).toBe(0)
      expect(phase.status).toBe('pending')
    }
    // An early build has no holes: nothing behind the frontier was skipped.
    expect(report.pipeline.holes).toEqual([])
  })

  it('reports the sections that depend on later phases as absent, not as zero', () => {
    expect(report.nodeTracking.availability).toBe('absent')
    expect(report.nodeTracking.nodesMapped).toBeNull()
    expect(report.library.availability).toBe('absent')
    expect(report.library.sequences).toBeNull()
    expect(report.trees.availability).toBe('absent')
    expect(report.trees.booksTotal).toBeNull()
    expect(report.nodeTracking.message).toBe('inputs not present yet')
  })

  it('keeps only the mapping stages an early build could have reached', () => {
    expect(report.mapping.stages).toHaveLength(2)
    expect(report.mapping.stages.map(stage => stage.stage)).toEqual(['id', 'id_pombe_syms'])
    expect(report.mapping.declaredHeadline.finalStage).toBe('id_pombe_syms')
  })
})

describe('toFailed', () => {
  const report = getFixtureReport('failed')
  const failed = report.pipeline.steps.filter(step => step.status.kind === 'failed')

  it('populates attempt history, because the real fixture has none', () => {
    expect(failed).toHaveLength(1)
    const step = failed[0]
    expect(step.attemptCount).toBe(3)
    expect(step.hasFailedAttempt).toBe(true)
    for (const attempt of step.attempts) {
      expect(attempt.status.kind).toBe('failed')
      expect(attempt.startedAt.present).toBe(true)
      expect(attempt.endedAt.present).toBe(true)
      expect(attempt.jobId).toMatch(/^slurm-/)
      expect(attempt.logReference).toMatch(/^logs\//)
      expect(attempt.reason).not.toBeNull()
    }
    expect(step.attempts.map(attempt => attempt.index)).toEqual([0, 1, 2])
  })

  it('exercises the measured-timing path the fixture cannot', () => {
    const step = failed[0]
    expect(step.timing.provenance).toBe('measured')
    expect(step.timing.kind).toBe('measured-runtime')
    expect(step.timing.jobId).not.toBeNull()
    expect(step.timing.seconds).toBeGreaterThan(0)
    expect(report.timing.hasMeasuredTiming).toBe(true)
  })

  it('keeps failed distinguishable from pending, hole and frontier', () => {
    const phase = report.pipeline.phases[failed[0].phaseIndex]
    expect(phase.hasFailure).toBe(true)
    expect(phase.isFrontier).toBe(true)
    expect(report.pipeline.holes.map(hole => hole.index)).toEqual([2])
    expect(report.pipeline.phases[2].hasFailure).toBe(false)
    // A failed step is not complete, so it carries no artifact time.
    expect(failed[0].timing.artifactAt.present).toBe(false)
  })

  it('adds a generator warning naming the failing step and its log', () => {
    expect(report.generatorWarnings.some(warning => warning.message.includes('failed after'))).toBe(
      true
    )
  })
})

describe('toWarning', () => {
  const report = getFixtureReport('warning')

  it('carries generator warnings from three sections, each anchored back to it', () => {
    const sections = new Set(report.generatorWarnings.map(warning => warning.sectionId))
    expect(sections).toContain('progress')
    expect(sections).toContain('node_tracking')
    expect(sections).toContain('config_ledger')
    expect(report.generatorWarnings.every(warning => warning.origin === 'generator')).toBe(true)
    expect(report.generatorWarnings.every(warning => warning.anchor.startsWith('#report--'))).toBe(
      true
    )
  })

  it('keeps a warned section readable rather than degrading it', () => {
    expect(report.nodeTracking.reportedStatus).toBe('warn')
    expect(report.nodeTracking.availability).toBe('available')
    expect(report.nodeTracking.nodesMapped).toBe(2810967)
    expect(report.health.signal).toBe('attention')
  })
})

describe('stripSection', () => {
  const report = getFixtureReport('missingNodeTracking')

  it('removes the section outright, which is harder than a section reported absent', () => {
    expect(report.reports.map(entry => entry.sectionId)).not.toContain('node_tracking')
    expect(report.nodeTracking.availability).toBe('absent')
    expect(report.nodeTracking.bySpecies).toEqual([])
    expect(report.nodeTracking.nodesMapped).toBeNull()
  })

  it('leaves the species cross-section working from the comparison tables alone', () => {
    expect(report.species.coverage.nodeTracking).toBe(0)
    expect(report.species.coverage.counts).toBe(50)
    expect(report.species.availability).toBe('partial')
    // The rename pairs come from the count table, so they survive the loss. Appendix A.9: only one
    // exact-count pair now (USTMA -> MYCMD); CRYNJ -> CRYD1 is off by one and no longer exact.
    expect(report.species.renames).toHaveLength(1)
  })

  it('degrades the whole pipeline when the spine section itself is gone', () => {
    const withoutProgress = parseBuildState(stripSection('progress')(buildStateSource))
    expect(withoutProgress.pipeline.phases).toEqual([])
    expect(withoutProgress.pipeline.frontierIndex).toBeNull()
    expect(withoutProgress.freshness.state).toBe('unknown')
    expect(withoutProgress.mapping.availability).toBe('available')
  })
})

describe('toTruncated', () => {
  const report = getFixtureReport('truncated')

  it('cuts every table while preserving the real totals', () => {
    for (const table of [
      report.otherReports.speciesCounts,
      report.otherReports.uniprotMatch,
      report.otherReports.uniRules,
    ]) {
      expect(table.rows).toHaveLength(TRUNCATED_ROW_LIMIT)
      expect(table.truncation.truncated).toBe(true)
      expect(table.truncation.allowClientSort).toBe(false)
      expect(table.truncation.allowClientFilter).toBe(false)
    }
    expect(report.otherReports.speciesCounts.truncation.totalRows).toBe(147)
    expect(report.otherReports.uniprotMatch.truncation.totalRows).toBe(132)
  })

  it('keeps ragged_rows a count rather than a flag', () => {
    expect(report.otherReports.speciesCounts.truncation.raggedRows).toBe(7)
    expect(report.otherReports.speciesCounts.truncation.hasRaggedRows).toBe(true)
  })

  it('does not invent new species from the rows it dropped', () => {
    // Reading absence as zero here would turn 126 unlisted tracked species into new ones.
    expect(report.species.coverage.counts).toBe(TRUNCATED_ROW_LIMIT)
    const unlisted = report.species.byOscode.HUMAN
    expect(unlisted.counts.present).toBe(false)
    expect(unlisted.counts.value).toBeNull()
    expect(unlisted.isNewInBuild).toBe(false)
    expect(unlisted.newInBuildConfidence).toBe('unknown')
  })

  it('downgrades a new-species claim to one source when the corroborating row is cut', () => {
    // The count table no longer reaches DAPMA, but its UniProt row survives and still says every
    // sequence is unmatched. One source is evidence enough to claim it, not enough to confirm it.
    expect(report.species.newOscodes).toEqual(['DAPMA'])
    expect(report.species.byOscode.DAPMA.newInBuildConfidence).toBe('reported')
    expect(getFixtureReport('real').species.byOscode.DAPMA.newInBuildConfidence).toBe('confirmed')
  })
})

describe('toStale', () => {
  const report = getFixtureReport('stale')

  it('flips freshness by moving an artifact past the report time', () => {
    expect(report.freshness.state).toBe('potentially-stale')
    expect(report.freshness.label).toBe('Potentially stale')
    expect(report.freshness.leadSeconds ?? 0).toBeLessThan(0)
    expect(report.freshness.explanation).toContain('newer than the report')
  })

  it('changes no status, so the pipeline reads exactly as the real report does', () => {
    const real = getFixtureReport('real')
    expect(report.pipeline.frontierIndex).toBe(real.pipeline.frontierIndex)
    expect(report.pipeline.phaseStatusCounts).toEqual(real.pipeline.phaseStatusCounts)
  })
})

describe('withUnknownSection', () => {
  const report = getFixtureReport('unknownSection')

  it('renders an unfamiliar section generically instead of dropping it', () => {
    const pfam = report.reports.find(entry => entry.sectionId === 'pfam_coverage')
    expect(pfam).toBeDefined()
    expect(pfam?.known).toBe(false)
    expect(pfam?.generic.headline.map(value => value.key)).toContain('pct_with_domain')
    expect(pfam?.generic.rows).toHaveLength(3)
    expect(pfam?.generic.tables[0].truncation.totalRows).toBe(19632)
    expect(pfam?.generic.warnings).toHaveLength(1)
  })

  it('collects an unbound section under Unattached reports', () => {
    const pfam = report.reports.find(entry => entry.sectionId === 'pfam_coverage')
    expect(pfam?.placement).toBe('unattached')
    expect(pfam?.phaseIds).toEqual([])
    expect(pfam?.phaseHint).toBeNull()
  })

  it('honours a per-section phase hint over the static registry', () => {
    const quality = report.reports.find(entry => entry.sectionId === 'tree_quality')
    expect(quality?.known).toBe(false)
    expect(quality?.phaseHint).toBe('tree-building-giga')
    expect(quality?.placement).toBe('phase')
    expect(quality?.primaryPhaseId).toBe('tree-building-giga')
    const treePhase = report.pipeline.phases.find(phase => phase.id === 'tree-building-giga')
    expect(treePhase?.sectionIds).toContain('tree_quality')
  })
})

describe('withUnknownStatus', () => {
  const report = getFixtureReport('unknownStatus')

  it('keeps an unfamiliar section status verbatim rather than coercing it', () => {
    const entry = report.reports.find(item => item.sectionId === 'node_tracking')
    expect(entry?.status.kind).toBe('unknown')
    expect(entry?.status.raw).toBe(UNKNOWN_SECTION_STATUS)
    expect(entry?.status.label).toBe(`Unknown status: ${UNKNOWN_SECTION_STATUS}`)
    expect(entry?.availability).toBe('unknown')
    expect(report.health.unknownStatusValues).toContainEqual({
      scope: 'section:node_tracking',
      value: UNKNOWN_SECTION_STATUS,
    })
  })

  it('keeps an unfamiliar step status verbatim and out of the completed count', () => {
    const step = report.pipeline.steps.find(item => item.status.raw === UNKNOWN_STEP_STATUS)
    expect(step).toBeDefined()
    expect(step?.status.kind).toBe('unknown')
    expect(step?.status.label).toBe(`Unknown status: ${UNKNOWN_STEP_STATUS}`)
    expect(step?.isComplete).toBe(false)
    const phase = report.pipeline.phases[step?.phaseIndex ?? 0]
    expect(phase.unknownStatusValues).toEqual([UNKNOWN_STEP_STATUS])
    // The re-marked step was pending, not done, so the completed count is unchanged from the real
    // fixture's 59 (Appendix A.1).
    expect(report.pipeline.computedHeadline.stepsComplete).toBe(59)
  })
})

describe('withFutureSchema', () => {
  const report = getFixtureReport('futureSchema')

  it('degrades visibly without refusing to render', () => {
    expect(report.schema.version).toBe(FUTURE_SCHEMA_VERSION)
    expect(report.schema.state).toBe('newer')
    expect(report.schema.degraded).toBe(true)
    expect(report.schema.explanation).toContain('newer than this dashboard understands')
    expect(report.health.schemaDegraded).toBe(true)
    expect(report.health.signal).toBe('degraded')
    // Still fully readable: degradation is a signal, not a refusal.
    // Appendix A.2: the frontier is now phase 13 ("Final packaging"), and A.7's library sequences.
    expect(report.pipeline.frontierIndex).toBe(13)
    expect(report.library.sequences).toBe(1742145)
  })
})

describe('the fully degraded state', () => {
  const report = getFixtureReport('degraded')

  it('survives a newer schema, an unknown section, an unknown status and a missing one at once', () => {
    expect(report.schema.state).toBe('newer')
    expect(report.reports.map(entry => entry.sectionId)).not.toContain('prev_lib')
    expect(report.reports.map(entry => entry.sectionId)).toContain('pfam_coverage')
    expect(report.health.unknownStatusValues.length).toBeGreaterThan(0)
    expect(report.comparison.availability).toBe('partial')
    // Appendix A.2: the frontier is now phase 13 ("Final packaging").
    expect(report.pipeline.frontierIndex).toBe(13)
    expect(report.ingestNotes.every(note => note.severity !== 'error')).toBe(true)
  })
})

describe('a transform over a malformed state', () => {
  it('cannot throw, because a recipe may be applied to any report', () => {
    const inputs: unknown[] = [null, undefined, {}, [], { sections: 'nope' }, { sections: [{}] }]
    for (const input of inputs) {
      for (const [, transform] of NAMED_TRANSFORMS) {
        const state = transform(input as BuildState)
        expect(() => parseBuildState(state)).not.toThrow()
      }
    }
  })
})
