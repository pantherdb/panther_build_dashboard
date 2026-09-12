import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MetricDefinitionsProvider } from '@/@panther.core/components'
import { curatedRegistry } from '@/app/metricRegistry'
import type { FixtureStateKey } from '@/features/build/fixtures'
import { initialBuildUiState } from '@/features/build/slices/buildSlice'
import GlanceCharts, { reclusterContextLine } from '@/features/overview/components/GlanceCharts'
import { renderWithProviders } from '@tests/test-utils'

const renderGlance = (fixtureStateKey: FixtureStateKey = 'real') =>
  renderWithProviders(
    <MetricDefinitionsProvider registry={curatedRegistry}>
      <GlanceCharts />
    </MetricDefinitionsProvider>,
    { preloadedState: { build: { ...initialBuildUiState, fixtureStateKey } } }
  )

/**
 * Regression coverage for the "ID match" rendered as a raw identifier defect: no report has yet
 * shipped `mapping.definitions` entries for the four known mechanisms (Finding 1), so this suite
 * exercises exactly the unresolved-definition path the legend hits on every build today.
 */
describe('GlanceCharts assignment mechanism legend', () => {
  it('shows the curated mechanism labels, not the raw mechanism strings', () => {
    renderGlance()

    expect(screen.getByText('ID match')).toBeInTheDocument()
    expect(screen.getByText('BLAST')).toBeInTheDocument()
    expect(screen.getByText('HMM scoring')).toBeInTheDocument()
    expect(screen.getByText('Reclustering (new)')).toBeInTheDocument()
  })

  it('does not give the curated legend labels identifier styling', () => {
    renderGlance()

    expect(screen.getByText('ID match')).not.toHaveClass('pb-ident')
    expect(screen.getByText('Reclustering (new)')).not.toHaveClass('pb-ident')
  })
})

/**
 * The count of families created, above the fold (spec §6.4).
 *
 * The absence case is the load-bearing one: no figure is derived from the mapping family delta,
 * because that delta is a NET change and would undercount silently if anything were dropped at the
 * same stage. A panel that showed 153 either way would be stating a finding the report never made.
 */
describe('GlanceCharts reclustering panel', () => {
  it('leads with the number of families created', () => {
    renderGlance('recluster')

    // Scoped to the display figure's own class: the outcome bar's legend and table twin below it
    // also show "153" (the `new_family` bucket's cluster count), so a bare text match is ambiguous.
    expect(screen.getByText('153', { selector: '.text-display' })).toBeInTheDocument()
    expect(screen.getByText(/families created/i)).toBeInTheDocument()
  })

  it('states no figure when the report carries no reclustering section', () => {
    renderGlance('real')

    expect(screen.queryByText(/families created/i)).not.toBeInTheDocument()
    expect(screen.getByText(/reclustering statistics/i)).toBeInTheDocument()
  })

  it('draws the cluster-outcomes bar from the outcome table the section carries', () => {
    renderGlance('recluster')

    // `inherited_family` carries 0 clusters in this fixture and is filtered out, same as a
    // zero-share mechanism is filtered from the panel beside it - a zero-width segment is not a
    // segment.
    expect(screen.getByText('new_family')).toBeInTheDocument()
    expect(screen.getByText('single_organism')).toBeInTheDocument()
    expect(screen.getByText('too_small')).toBeInTheDocument()
    expect(screen.queryByText('inherited_family')).not.toBeInTheDocument()
  })

  it('draws no bar when the section carries no outcome rows', () => {
    renderGlance('real')

    expect(screen.queryByText('Cluster outcomes')).not.toBeInTheDocument()
  })
})

/**
 * The context line's derived-zero regression (Finding 2): `clustersFormed` and
 * `sequencesInNewFamilies` are read from separate headline keys, so a report can carry one without
 * the other. Exercised directly against the exported helper rather than through a new fixture
 * state, since the fixture catalog already fans out to five other suites per named key.
 */
describe('reclusterContextLine', () => {
  it('states both figures when both are present', () => {
    expect(reclusterContextLine({ sequencesInNewFamilies: 2823, clustersFormed: 41234 })).toBe(
      '2,823 sequences, from 41,234 TribeMCL clusters'
    )
  })

  it('omits the cluster-count clause rather than inventing a zero when clusters_formed is missing', () => {
    const line = reclusterContextLine({ sequencesInNewFamilies: 2823, clustersFormed: null })
    expect(line).toBe('2,823 sequences')
    expect(line).not.toContain('0')
    expect(line).not.toContain('TribeMCL')
  })

  it('states nothing when the build has not reached reclustering', () => {
    expect(reclusterContextLine({ sequencesInNewFamilies: null, clustersFormed: null })).toBeNull()
  })
})
