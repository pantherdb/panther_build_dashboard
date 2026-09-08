import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { FixtureStateKey } from '@/features/build/fixtures'
import { initialBuildUiState } from '@/features/build/slices/buildSlice'
import { BuildPreamble } from '@/features/preamble/components/BuildPreamble'
import { renderWithProviders } from '@tests/test-utils'

const preloaded = (fixtureStateKey: FixtureStateKey) => ({
  build: { ...initialBuildUiState, fixtureStateKey },
})

describe('BuildPreamble identity and freshness', () => {
  it('shows the library, target and report generation time from the report itself', () => {
    renderWithProviders(<BuildPreamble />, { preloadedState: preloaded('real') })

    expect(screen.getByRole('heading', { level: 1, name: 'PANTHER 20.0' })).toBeInTheDocument()
    // Named beside the library in the header and again as the Build target row.
    expect(screen.getAllByText('target')).toHaveLength(2)
    // Rendered in UTC from the report's own ISO string, so the record does not move with the reader.
    expect(screen.getByText('2026-08-20 23:26:31 UTC')).toBeInTheDocument()
  })

  it('reads freshness as positive evidence, with the lead over the newest artifact', () => {
    renderWithProviders(<BuildPreamble />, { preloadedState: preloaded('real') })

    expect(screen.getByText('Report current')).toBeInTheDocument()
    expect(screen.getByText('report generated 73.7h after the newest artifact')).toBeInTheDocument()
  })

  it('flips freshness when an artifact is newer than the report', () => {
    renderWithProviders(<BuildPreamble />, { preloadedState: preloaded('stale') })

    expect(screen.getByText('Report potentially stale')).toBeInTheDocument()
    expect(screen.getByText(/^an artifact is .* newer than the report$/)).toBeInTheDocument()
  })

  it('shows provenance: the revision, the dirty source tree and the previous library', () => {
    renderWithProviders(<BuildPreamble />, { preloadedState: preloaded('real') })

    expect(screen.getByText('7f1ab73e485e5285d2ff53e512a9c3a380863dcd')).toBeInTheDocument()
    expect(screen.getByText('dirty — uncommitted changes at build time')).toBeInTheDocument()
    expect(screen.getByText('PANTHER19.0')).toBeInTheDocument()
    expect(
      screen.getByText('ref_prot_2026_01/external_data/qfo_reference_proteome')
    ).toBeInTheDocument()
  })

  it('summarises the build state without a hero number', () => {
    renderWithProviders(<BuildPreamble />, { preloadedState: preloaded('real') })

    expect(screen.getByText('Build in progress')).toBeInTheDocument()
    expect(screen.getByText('55/61 steps · 11/14 phases')).toBeInTheDocument()
    expect(screen.getByText('1 generator warning')).toBeInTheDocument()
    expect(screen.getByText('1 section absent')).toBeInTheDocument()
    expect(screen.getByText('3 truncated tables')).toBeInTheDocument()
  })
})

describe('BuildPreamble schema contract', () => {
  it('reports a supported schema as a plain row and shows no degradation notice', () => {
    renderWithProviders(<BuildPreamble />, { preloadedState: preloaded('real') })

    expect(screen.getByText('1 (supported)')).toBeInTheDocument()
    expect(screen.queryByText('Report schema not fully supported')).toBeNull()
  })

  it('withFutureSchema() shows the degradation notice and keeps the literal version', () => {
    renderWithProviders(<BuildPreamble />, { preloadedState: preloaded('futureSchema') })

    expect(screen.getByText('Report schema not fully supported')).toBeInTheDocument()
    expect(
      screen.getByText(/Report schema 2 is newer than this dashboard understands/)
    ).toBeInTheDocument()
    expect(screen.getAllByText(/Unknown schema version:/).length).toBeGreaterThan(0)
    expect(screen.getByText('supported: 1')).toBeInTheDocument()
  })
})

describe('BuildPreamble report-state honesty', () => {
  it('does not label the captured report as derived', () => {
    renderWithProviders(<BuildPreamble />, { preloadedState: preloaded('real') })

    expect(screen.queryByText('Derived demo state — not a measurement')).toBeNull()
  })

  it('marks a transform state as a derived demo inside the record itself', () => {
    renderWithProviders(<BuildPreamble />, { preloadedState: preloaded('failed') })

    expect(screen.getByText('Derived demo state — not a measurement')).toBeInTheDocument()
    expect(screen.getByText(/Failed step:/)).toBeInTheDocument()
  })
})

describe('BuildPreamble config ledger', () => {
  it('says nothing about config churn when the ledger holds a single record', () => {
    renderWithProviders(<BuildPreamble />, { preloadedState: preloaded('real') })

    expect(screen.queryByText(/config changed during the build/)).toBeNull()
  })

  it('flags an append-only ledger that gained a second record during the build', () => {
    renderWithProviders(<BuildPreamble />, { preloadedState: preloaded('configChanged') })

    // The resolved values below describe the latest driver run, not every artifact in the target,
    // so the count is surfaced beside them rather than left inside the section.
    expect(screen.getByText('config changed during the build · 2 records')).toBeInTheDocument()
  })
})

/**
 * The header's reference-proteome claim, after pipeline issue #65.
 *
 * `QFO_RELEASE_VERSION` was retired: the Makefile warns it is "set but ignored", and the captured
 * report's config ledger has no such key, so the old "QfO release declared" row renders as "not
 * declared". A header row that is structurally empty and, when populated, could only ever name one
 * of the three releases this build used, is worse than no row. The composition replaces it.
 */
describe('the reference-proteome release claim', () => {
  it('states every release the build drew from, not one declared version', () => {
    renderWithProviders(<BuildPreamble />)

    expect(screen.getByText(/QfO 2026_02 \(67\)/)).toBeInTheDocument()
    expect(screen.getByText(/RefProt 2026_01 \(24\)/)).toBeInTheDocument()
  })

  it('no longer claims a single declared release', () => {
    renderWithProviders(<BuildPreamble />)

    expect(screen.queryByText('QfO release declared')).not.toBeInTheDocument()
  })
})
