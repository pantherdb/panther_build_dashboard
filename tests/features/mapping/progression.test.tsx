import { screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import { MetricDefinitionsProvider } from '@/@panther.core/components'
import { curatedRegistry } from '@/app/metricRegistry'
import { buildStateSource, getFixtureReport, stripSection } from '@/features/build/fixtures'
import { parseBuildState } from '@/features/build/model'
import type { BuildReport } from '@/features/build/model'
import { MappingReportView } from '@/features/mapping/components/MappingReport'
import {
  attributeStage,
  buildMappingView,
  deltaAxisTicks,
  shortStageLabel,
} from '@/features/mapping/model'
import { renderWithProviders } from '@tests/test-utils'

/**
 * The mapping progression, checked against `01-report-model` Appendix A.5.
 *
 * The load-bearing assertion is the delta one. `by_mechanism` stores cumulative totals, so plotting
 * them as increments makes the `hmm` stage look as though it contributed 1.8 M sequences instead of
 * 182,097 - a wrong answer that renders perfectly well and is only caught by comparing the numbers.
 *
 * The rendering assertions are grouped rather than split one per `it`. Mounting this view is
 * expensive (two charts, three tables and the Mantine tooltip layer), and a dozen mounts of the
 * same tree makes the suite slow enough to time out under parallel load.
 */

const withDefinitions = (ui: ReactElement) => (
  <MetricDefinitionsProvider registry={curatedRegistry}>{ui}</MetricDefinitionsProvider>
)

/** Text that spans several nodes; RTL's default matcher only sees direct text children. */
const spanningText = (fragment: string) =>
  screen.queryAllByText((_content, element) => element?.textContent?.includes(fragment) ?? false)

/**
 * Mounting one of these views in jsdom costs a few hundred milliseconds, and the FIRST mount in a
 * file also pays the Mantine + floating-layer warm-up, which pushes past Vitest's 5 s default on a
 * loaded machine. The render tests therefore carry an explicit timeout rather than being split into
 * more, smaller mounts of the same tree.
 */
const RENDER_TIMEOUT = 30_000

const realReport = getFixtureReport('real')

const deltaFor = (report: BuildReport, stage: string, mechanism: string): number | null => {
  const view = buildMappingView(report)
  const row = view.stages.find(entry => entry.stage === stage)
  return row?.mechanisms.find(entry => entry.mechanism === mechanism)?.delta ?? null
}

describe('mapping stage deltas (Appendix A.5)', () => {
  it('books each stage its own per-stage mechanism gain, not the cumulative total', () => {
    expect(deltaFor(realReport, 'blast', 'BLAST')).toBe(100538)
    expect(deltaFor(realReport, 'hmm', 'HMM_scoring')).toBe(197108)
    expect(deltaFor(realReport, 'recluster', 'RECLUSTER_NEW')).toBe(2823)
    expect(deltaFor(realReport, 'pass1_trim', 'HMM_scoring')).toBe(-4259)
    expect(deltaFor(realReport, 'exten', 'HMM_scoring')).toBe(11760)
    expect(deltaFor(realReport, 'post_giga', 'ID')).toBe(-44)
    expect(deltaFor(realReport, 'post_giga', 'HMM_scoring')).toBe(-230)
    expect(deltaFor(realReport, 'post_giga', 'RECLUSTER_NEW')).toBe(-57)
  })

  it('keeps a flat mechanism flat: ID does not move at the blast stage', () => {
    const view = buildMappingView(realReport)
    const blast = view.stages.find(entry => entry.stage === 'blast')
    const id = blast?.mechanisms.find(entry => entry.mechanism === 'ID')
    expect(id?.cumulative).toBe(1507603)
    expect(id?.delta).toBe(0)
  })

  it('scales the change chart to the largest per-stage gain, not to cumulative assignment', () => {
    const view = buildMappingView(realReport)
    expect(view.deltaDomain).toEqual([-4259, 197108])
    // The opening balance is excluded: ID's 1,507,603 would otherwise set the domain.
    expect(view.deltaStages).toHaveLength(view.stages.length - 1)
    expect(view.deltaStages.some(row => row.isBaseline)).toBe(false)
  })

  it('names the largest gain and the largest loss', () => {
    const view = buildMappingView(realReport)
    expect(view.gains[0].stage).toBe('hmm')
    expect(view.gains[0].assignedDelta).toBe(197108)
    expect(view.gains[0].isLargestGain).toBe(true)
    expect(view.losses[0].stage).toBe('pass1_trim')
    expect(view.losses[0].assignedDelta).toBe(-4259)
    expect(view.losses[0].isLargestLoss).toBe(true)
  })

  it('reports the assignment gain in percentage points and the envelope loss in sequences', () => {
    const view = buildMappingView(realReport)
    expect(view.summary.firstPctAssigned).toBe(65.6)
    expect(view.summary.finalPctAssigned).toBe(79.1)
    expect(view.summary.assignmentGainPoints).toBe(13.5)
    expect(view.envelopeLoss).toBe(5903)
    expect(view.envelopeLosses.map(entry => entry.loss)).toEqual([4259, 923, 385, 5, 331])
  })

  it('uses the four mechanisms the data has, in a fixed slot order', () => {
    const view = buildMappingView(realReport)
    expect(view.seriesKeys).toEqual(['ID', 'BLAST', 'HMM_scoring', 'RECLUSTER_NEW'])
    expect(view.seriesKeys.map(key => view.scale.slotOf(key))).toEqual([1, 2, 3, 4])
    // "extension" is a stage, not a mechanism, so the booking has to be stated.
    expect(view.extensionNote).toContain('HMM scoring')
    expect(view.extensionNote).toContain('+11,760')
  })

  it('identifies the phase these numbers came from and that it did not finish', () => {
    const view = buildMappingView(realReport)
    expect(view.phase?.name).toBe('Sequence-to-family mapping')
    expect(view.phase?.isHole).toBe(true)
    expect(view.incompleteStepGoals).toEqual(['validate_idmapping_step', 'validate_blast_step'])
    // Eleven, not ten: ten later phases reached `complete`, but the frontier also carried on past
    // this hole with 1 of its 2 steps done (Final packaging). The spine, the phase detail and this
    // report all state the same number.
    expect(view.laterPhasesRan).toBe(11)
  })
})

describe('mapping model helpers', () => {
  it('matches a stage to the declared step whose goal is its mapping file', () => {
    const view = buildMappingView(realReport)
    const hmm = view.stages.find(entry => entry.stage === 'hmm')
    expect(hmm?.attribution.kind).toBe('matched')
    expect(hmm?.attribution.kind === 'matched' && hmm.attribution.step.goal).toBe(
      'refProteomePANTHERmapping_updated_hmm'
    )

    // No declared goal writes the ID mapping file, and saying so beats inventing a link.
    const id = view.stages.find(entry => entry.stage === 'id')
    expect(id?.attribution.kind).toBe('none')
  })

  it('prefers an exact goal match over a same-basename goal in another phase', () => {
    const attribution = attributeStage(
      'refProteomePANTHERmapping_single_genome_fams_removed',
      realReport.pipeline.steps,
      () => 'phase'
    )
    expect(attribution.kind).toBe('matched')
    expect(
      attribution.kind === 'matched' && attribution.step.goal.startsWith('prev_lib_rebuilt/')
    ).toBe(false)
  })

  it('keeps the exact floor on the signed delta axis and always includes zero', () => {
    const ticks = deltaAxisTicks([-4030, 182097])
    expect(ticks[0]).toBe(-4030)
    expect(ticks).toContain(0)
    expect(deltaAxisTicks([0, 0])).toEqual([0])
  })

  it('abbreviates a stage name for the axis without losing the pass number', () => {
    expect(shortStageLabel('pass1_trim')).toBe('trim 1')
    expect(shortStageLabel('pass2_single_genome')).toBe('1-genome 2')
    expect(shortStageLabel('post_giga')).toBe('post giga')
    expect(shortStageLabel('hmm')).toBe('hmm')
  })
})

describe('MappingReportView on the captured report', () => {
  it(
    'annotates the meaningful changes and states the gain in percentage points',
    () => {
      renderWithProviders(withDefinitions(<MappingReportView report={realReport} />))

      expect(screen.getByText('largest single gain')).toBeInTheDocument()
      expect(screen.getByText('largest single loss')).toBeInTheDocument()
      expect(spanningText('HMM scoring +197,108')).not.toHaveLength(0)
      expect(spanningText('BLAST +100,538')).not.toHaveLength(0)
      expect(spanningText('HMM scoring +11,760')).not.toHaveLength(0)
      expect(spanningText('HMM scoring -4,259')).not.toHaveLength(0)
      expect(spanningText('trim 1 -4,259')).not.toHaveLength(0)

      expect(screen.getByText('+13.5 pp')).toBeInTheDocument()
      expect(screen.getByText('65.6 → 79.1 %')).toBeInTheDocument()
      expect(spanningText('has no separate extension mechanism')).not.toHaveLength(0)
      // The envelope narrowing is named stage by stage rather than left as a total.
      expect(spanningText('trim 1 -4,259 · dedup 1 -923')).not.toHaveLength(0)
    },
    RENDER_TIMEOUT
  )

  it(
    'shows the producing phase is a hole, and never labels a count a bare "Sequences"',
    () => {
      renderWithProviders(withDefinitions(<MappingReportView report={realReport} />))

      expect(
        screen.getByText(
          'Sequence-to-family mapping did not finish, but the mapping figures below are present.'
        )
      ).toBeInTheDocument()
      expect(screen.getByText('validate_idmapping_step, validate_blast_step')).toBeInTheDocument()
      expect(
        spanningText('11 later phases carried on past it, so this is a hole behind the frontier')
      ).not.toHaveLength(0)

      expect(screen.queryByText('Sequences')).toBeNull()
      expect(screen.getByText('Reference-proteome input sequences')).toBeInTheDocument()
      expect(screen.getByText('Sequences at the final mapping stage')).toBeInTheDocument()
      expect(screen.getByText('Sequences assigned to a family')).toBeInTheDocument()
      // No metric reaches the screen without a registry entry.
      expect(screen.queryByText(/no definition registered/)).toBeNull()
    },
    RENDER_TIMEOUT
  )

  it(
    'keeps the exact figures, mapping files, producing steps and the BLAST QC metrics',
    () => {
      renderWithProviders(withDefinitions(<MappingReportView report={realReport} />))

      // Twice: the mapping file the stage wrote, and the goal of the step that wrote it.
      expect(screen.getAllByText('refProteomePANTHERmapping_post_giga')).toHaveLength(2)
      expect(
        screen.getAllByText('no declared step names this artifact').length
      ).toBeGreaterThanOrEqual(1)
      expect(
        screen.getByRole('table', {
          name: 'Mapping stages: exact figures, mapping files and the steps that produced them',
        })
      ).toBeInTheDocument()

      expect(screen.getByText('Sequences checked in the BLAST QC pass')).toBeInTheDocument()
      expect(screen.getByText('117,014')).toBeInTheDocument()
      expect(screen.getByText('0.9982')).toBeInTheDocument()
    },
    RENDER_TIMEOUT
  )
})

describe('MappingReportView degradation', () => {
  it(
    'renders on toEarly(), where only the first two stages exist',
    () => {
      const early = getFixtureReport('early')
      const view = buildMappingView(early)
      expect(view.stages).toHaveLength(2)
      expect(view.hasChange).toBe(false)

      renderWithProviders(withDefinitions(<MappingReportView report={early} />))

      expect(
        screen.getByRole('heading', { level: 3, name: 'Sequence mapping and family assignment' })
      ).toBeInTheDocument()
      // A chart with nothing to draw says so rather than drawing an empty plot.
      expect(screen.getByText('No stage has changed the assigned count yet')).toBeInTheDocument()
      expect(screen.getByText('id_pombe_syms')).toBeInTheDocument()
    },
    RENDER_TIMEOUT
  )

  it(
    'renders on stripSection("mapping") with one notice and no invented figures',
    () => {
      const stripped = parseBuildState(stripSection('mapping')(buildStateSource))
      expect(stripped.mapping.availability).toBe('absent')

      renderWithProviders(withDefinitions(<MappingReportView report={stripped} />))

      expect(
        screen.getByText('Sequence mapping and family assignment — Not in this report')
      ).toBeInTheDocument()
      expect(
        spanningText('No stage progression, per-stage change or mapping-file detail is shown')
      ).not.toHaveLength(0)
      expect(screen.queryByText('largest single gain')).toBeNull()
      // The BLAST QC metrics live in another section, so they survive.
      expect(screen.getByText('Sequences checked in the BLAST QC pass')).toBeInTheDocument()
    },
    RENDER_TIMEOUT
  )
})
