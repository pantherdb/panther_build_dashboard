import { act, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { makeStore } from '@/app/store/store'
import { getFixtureReport } from '@/features/build/fixtures'
import {
  initialBuildUiState,
  selectPhase,
  selectSpecies,
  setFixtureStateKey,
  togglePhaseExpanded,
} from '@/features/build/slices/buildSlice'
import {
  useBuildReport,
  useFixtureStateKey,
  useSelectFixtureState,
  useSpeciesRecord,
} from '@/features/build/hooks'
import { renderWithProviders } from '@tests/test-utils'

describe('buildSlice', () => {
  it('starts on the captured report with nothing selected', () => {
    const state = makeStore().getState()
    expect(state.build).toEqual(initialBuildUiState)
    expect(state.build.fixtureStateKey).toBe('real')
    expect(state.build.selectedPhaseIndex).toBeNull()
  })

  it('drops every selection when the report state changes', () => {
    const store = makeStore()
    store.dispatch(selectPhase(12))
    store.dispatch(selectSpecies('DAPMA'))
    store.dispatch(togglePhaseExpanded('sequence-to-family-mapping'))

    store.dispatch(setFixtureStateKey('early'))

    // A phase index from one report state does not necessarily exist in the next.
    expect(store.getState().build).toEqual({
      ...initialBuildUiState,
      fixtureStateKey: 'early',
    })
  })

  it('leaves selections alone when the same state is re-selected', () => {
    const store = makeStore()
    store.dispatch(selectPhase(2))
    store.dispatch(setFixtureStateKey('real'))
    expect(store.getState().build.selectedPhaseIndex).toBe(2)
  })

  it('toggles a spine node open and closed', () => {
    const store = makeStore()
    store.dispatch(togglePhaseExpanded('final-packaging'))
    expect(store.getState().build.expandedPhaseIds).toEqual(['final-packaging'])
    store.dispatch(togglePhaseExpanded('final-packaging'))
    expect(store.getState().build.expandedPhaseIds).toEqual([])
  })
})

/**
 * The cross-plan hook contract. Four other view plans mount against exactly these signatures, so a
 * rename here breaks them silently; this test is what makes that loud.
 */
const Probe = () => {
  const report = useBuildReport()
  const key = useFixtureStateKey()
  const select = useSelectFixtureState()
  const dapma = useSpeciesRecord('DAPMA')
  const missing = useSpeciesRecord('NOT_A_SPECIES')

  return (
    <div>
      <span data-probe="key">{key}</span>
      <span data-probe="frontier">{report.pipeline.frontierPhaseName}</span>
      <span data-probe="dapma">{dapma === null ? 'null' : dapma.oscode}</span>
      <span data-probe="dapma-new">{String(dapma?.isNewInBuild)}</span>
      <span data-probe="missing">{missing === null ? 'null' : missing.oscode}</span>
      <button type="button" onClick={() => select('early')}>
        early
      </button>
    </div>
  )
}

describe('useBuildReport and friends', () => {
  it('returns the report for the selected state and the same object between renders', () => {
    renderWithProviders(<Probe />)

    expect(screen.getByText('real')).toBeInTheDocument()
    expect(screen.getByText('Final packaging')).toBeInTheDocument()
    // The parse is memoised per recipe, so a view never parses per render.
    expect(getFixtureReport('real')).toBe(getFixtureReport('real'))
  })

  it('joins a species across sections, and returns null for one no source mentions', () => {
    renderWithProviders(<Probe />)

    expect(screen.getByText('DAPMA')).toBeInTheDocument()
    expect(screen.getByText('true')).toBeInTheDocument()
    expect(screen.getByText('null')).toBeInTheDocument()
  })

  it('switches the whole report through useSelectFixtureState', async () => {
    const { user } = renderWithProviders(<Probe />)

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'early' }))
    })

    // The button carries the same word, so the probe's own readout is addressed directly.
    expect(document.querySelector('[data-probe="key"]')).toHaveTextContent('early')
    expect(document.querySelector('[data-probe="frontier"]')).toHaveTextContent(
      'Sequence-to-family mapping'
    )
  })
})
