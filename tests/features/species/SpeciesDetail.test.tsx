import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { FixtureStateKey } from '@/features/build/fixtures'
import { initialBuildUiState } from '@/features/build/slices/buildSlice'
import { SpeciesDetail } from '@/features/species/components/SpeciesDetail'
import { renderWithProviders } from '@tests/test-utils'

const renderDetail = (oscode: string, fixtureStateKey: FixtureStateKey = 'real') =>
  renderWithProviders(<SpeciesDetail oscode={oscode} onClose={() => {}} />, {
    preloadedState: { build: { ...initialBuildUiState, fixtureStateKey } },
  })

const reading = () => document.querySelector('[data-pb-species-reading]') as HTMLElement

/**
 * Acceptance question 3, asserted the way a reviewer would answer it: read the panel and see
 * whether it SAYS why 0 % is expected. Every assertion here is about wording, because "the number
 * is on screen somewhere" is exactly the failure this panel exists to fix.
 */
describe('SpeciesDetail — DAPMA', () => {
  it('states in words that 0 % is expected, and marks the statement as derived', () => {
    renderDetail('DAPMA')

    const block = reading()
    expect(block).toHaveTextContent('0 % node forward tracking is expected for DAPMA')
    expect(block).toHaveTextContent('two independent sources')
    expect(block).toHaveTextContent('no previous nodes to track forward')
    expect(within(block).getByText('Derived')).toBeInTheDocument()
  })

  it('carries the verdict as a word, not only as a colour', () => {
    renderDetail('DAPMA')

    expect(screen.getAllByText('Explained').length).toBeGreaterThan(0)
  })

  it('attributes each corroborating fact to the section and table it came from', () => {
    renderDetail('DAPMA')

    expect(screen.getByText(/0 of 10,544 nodes mapped forward/)).toBeInTheDocument()
    expect(screen.getByText(/Previous count 0, current count 26,600/)).toBeInTheDocument()
    expect(screen.getByText(/26,600 had no previous match at all/)).toBeInTheDocument()
    // Repeated on purpose: once beside the evidence line, once as the source block's provenance.
    expect(screen.getAllByText('node_tracking · by_species').length).toBeGreaterThan(0)
    expect(
      screen.getAllByText(/other_reports · Sequence counts by species, previous vs new/).length
    ).toBeGreaterThan(0)
  })

  it('presents the DAPPU relationship as a replacement, never as a rename', () => {
    renderDetail('DAPMA')

    expect(screen.getByText('Identity change')).toBeInTheDocument()
    expect(screen.getAllByText(/Candidate replacement/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/replacement rather than a rename/).length).toBeGreaterThan(0)
    expect(screen.queryByText('Renames — exact count match')).toBeNull()
  })

  it('warns that node counts and sequence counts are different quantities', () => {
    renderDetail('DAPMA')

    // DAPMA reads 10,504 nodes and 26,600 sequences; the panel must not let that look wrong.
    expect(
      screen.getByText(/Node counts and sequence counts are different quantities/)
    ).toBeInTheDocument()
  })
})

describe('SpeciesDetail — FELCA', () => {
  it('says that nothing in the report explains 65 %', () => {
    renderDetail('FELCA')

    const block = reading()
    expect(block).toHaveTextContent('established previous proteome')
    expect(block).toHaveTextContent('Newness does not explain this one')
    expect(screen.getAllByText('Not explained').length).toBeGreaterThan(0)
    expect(block).not.toHaveTextContent('new in this build')
  })

  it('still shows the UniProt agreement facts as context rather than as an explanation', () => {
    renderDetail('FELCA')

    expect(screen.getByText(/132 of 19,179 sequences/)).toBeInTheDocument()
    expect(screen.getByText(/7,028 had no previous match/)).toBeInTheDocument()
  })
})

describe('SpeciesDetail — a species the truncated tables never mention', () => {
  it('shows unknown rather than zero, and does not claim ECOLI is new', () => {
    renderDetail('ECOLI')

    const block = reading()
    expect(block).not.toHaveTextContent('new in this build')

    expect(screen.getByText(/ECOLI is not among the 50 of 147 rows/)).toBeInTheDocument()
    expect(
      screen.getByText(/UNKNOWN - not zero, and not evidence that the species is new/)
    ).toBeInTheDocument()
    expect(screen.getByText(/ECOLI is not among the 20 of 132 rows/)).toBeInTheDocument()

    // No sequence-count figure is invented for it.
    expect(screen.queryByText('Previous sequences')).toBeNull()
  })
})

describe('SpeciesDetail — stripSection(node_tracking)', () => {
  it('stays usable from the remaining sources', () => {
    renderDetail('DAPMA', 'missingNodeTracking')

    const block = reading()
    expect(block).toHaveTextContent('no node forward tracking section')

    // The other two sources still carry DAPMA, and the panel still shows them.
    expect(screen.getByText(/Previous count 0, current count 26,600/)).toBeInTheDocument()
    expect(screen.getByText(/26,600 had no previous match at all/)).toBeInTheDocument()
    expect(screen.getByText('Previous vs current sequences')).toBeInTheDocument()
    expect(screen.getByText('Previous-UniProt-id agreement')).toBeInTheDocument()
    expect(screen.getAllByText(/no node forward tracking section/).length).toBeGreaterThan(1)
  })
})

describe('SpeciesDetail — an oscode no source mentions', () => {
  it('says the report does not carry it, not that the build lacks it', () => {
    renderDetail('ZZZZZ')

    expect(screen.getByText('No source in this report mentions ZZZZZ')).toBeInTheDocument()
    expect(
      screen.getByText(
        /the report does not carry the species - not that the build does not contain it/
      )
    ).toBeInTheDocument()
  })
})
