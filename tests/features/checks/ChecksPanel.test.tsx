import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import BuildShell from '@/app/layout/BuildShell'
import { BUILD_ROUTE } from '@/features/build/model'
import type { FixtureStateKey } from '@/features/build/fixtures'
import { initialBuildUiState } from '@/features/build/slices/buildSlice'
import ChecksPanel from '@/features/checks/components/ChecksPanel'
import { renderWithProviders } from '@tests/test-utils'

/**
 * The rendered panel.
 *
 * Two properties matter more than layout here. Provenance has to be visible on every row, because
 * this dashboard may become part of the permanent build record and a record that blurs a generator
 * warning into a dashboard inference is a liability. And passing checks have to be ON SCREEN
 * without a filter being touched, because on this report they are the strongest evidence the build
 * is sound.
 */

const preloaded = (fixtureStateKey: FixtureStateKey) => ({
  build: { ...initialBuildUiState, fixtureStateKey },
})

const rowFor = (id: string): HTMLElement => {
  const row = document.querySelector(`[data-check-id="${id}"]`)
  if (row === null) throw new Error(`no rendered row for ${id}`)
  return row as HTMLElement
}

describe('provenance in the rendered output', () => {
  it('marks the generator warning as Generator and a derived check as Derived', () => {
    renderWithProviders(<ChecksPanel />, { preloadedState: preloaded('real') })

    const generator = rowFor('generator.warning:generator-progress-4')
    expect(generator.dataset.checkOrigin).toBe('generator')
    expect(within(generator).getByText('Generator')).toBeInTheDocument()
    expect(generator.querySelector('[data-provenance="generator"]')).toBeInTheDocument()

    const derived = rowFor('nodes.type-coverage')
    expect(derived.dataset.checkOrigin).toBe('dashboard')
    expect(within(derived).getByText('Derived')).toBeInTheDocument()
    expect(derived.querySelector('[data-provenance="derived"]')).toBeInTheDocument()
  })

  it('gives every rendered finding a provenance mark, with no unmarked row', () => {
    renderWithProviders(<ChecksPanel />, { preloadedState: preloaded('real') })

    const rows = [...document.querySelectorAll('[data-check-id]')]
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.querySelector('[data-provenance]')).not.toBeNull()
    }
  })

  it('quotes the generator message verbatim rather than rewording it', () => {
    renderWithProviders(<ChecksPanel />, { preloadedState: preloaded('real') })

    expect(
      screen.getByText(
        'ftp/PANTHER_HMM_Classification_files/PANTHER20.0_HMM_classifications is older than QfO_OrthoXML.xml, which precedes it in the build — possibly stale (driver-order heuristic, not a verified dependency)'
      )
    ).toBeInTheDocument()
  })
})

describe('passing checks', () => {
  it('renders them without any filter being touched', () => {
    renderWithProviders(<ChecksPanel />, { preloadedState: preloaded('real') })

    expect(screen.getByRole('heading', { level: 4, name: 'Verified' })).toBeInTheDocument()
    expect(
      screen.getByText('LEAF node total matches library sequences exactly')
    ).toBeInTheDocument()
    expect(screen.getByText('Family counts agree across 4 sources')).toBeInTheDocument()
    expect(screen.getByText('Every book has a usable tree')).toBeInTheDocument()
  })

  it('shows the issue count over warnings only, and the verified count beside it', () => {
    renderWithProviders(<ChecksPanel />, { preloadedState: preloaded('real') })

    expect(screen.getByText('7 issues to review')).toBeInTheDocument()
    expect(screen.getByText('4 from the generator · 3 derived here')).toBeInTheDocument()
    expect(screen.getByText('8 verified')).toBeInTheDocument()
    expect(screen.getByText('7 noted')).toBeInTheDocument()
  })

  it('separates the four groups and says why each exists', () => {
    renderWithProviders(<ChecksPanel />, { preloadedState: preloaded('real') })

    expect(document.querySelector('[data-check-group="issue"]')).not.toBeNull()
    expect(document.querySelector('[data-check-group="note"]')).not.toBeNull()
    expect(document.querySelector('[data-check-group="verified"]')).not.toBeNull()
    expect(
      screen.getByText('Warnings and mismatches. These are the only findings counted as issues.')
    ).toBeInTheDocument()
  })
})

describe('the suppressed duplicate', () => {
  it('is shown as suppressed rather than dropped or counted', () => {
    renderWithProviders(<ChecksPanel />, { preloadedState: preloaded('real') })

    // 2 now: this artifact-order pair, and the derived proteome-majority-release finding
    // standing down for the generator's own off-majority-release warning (configTiers.test.ts).
    expect(screen.getByText('2 duplicate findings suppressed')).toBeInTheDocument()
    const group = document.querySelector('[data-check-group="suppressed"]')
    expect(group).not.toBeNull()
    expect(
      within(group as HTMLElement).getByText(
        /^Artifact out of declared order: ftp\/PANTHER_HMM_Classification_files/
      )
    ).toBeInTheDocument()
  })
})

describe('the configuration tiers', () => {
  it('renders the three tiers as three different claims', () => {
    renderWithProviders(<ChecksPanel />, { preloadedState: preloaded('real') })

    expect(document.querySelector('[data-config-tier="mismatch"]')).not.toBeNull()
    expect(document.querySelector('[data-config-tier="notable"]')).not.toBeNull()
    expect(document.querySelector('[data-config-tier="lineage"]')).not.toBeNull()
    // 1 mismatch now (config.source-dirty only) - the QfO release/data-dir mismatch this count
    // used to include is gone along with the rule it belonged to (Appendix A.8).
    expect(screen.getByText('1 mismatch · 6 notable · 21 lineage')).toBeInTheDocument()
  })

  it('shows the captured config.mk with the commented-out QfO line marked', () => {
    renderWithProviders(<ChecksPanel />, { preloadedState: preloaded('real') })

    const line = document.querySelector('[data-code-line="1"]')
    expect(line).not.toBeNull()
    expect(line?.textContent).toContain(
      '#export QFO_DATA_DIR=QfO_release_2026_02/external_data/qfo_reference_proteome'
    )
    // The mark is the accent wash, which is what makes it evidence rather than a listing.
    expect(line?.className).toContain('bg-accent-wash')
  })

  it('anchors the configuration values a finding points at', () => {
    renderWithProviders(<ChecksPanel />, { preloadedState: preloaded('real') })

    for (const key of [
      'qfo-data-dir',
      'qfo-release-version',
      'panther-build-dirty',
      'unresolved-vars',
      'pc-class',
      'mafft-binaries',
      'prev-release-dir',
    ]) {
      expect(document.getElementById(`config--${key}`)).not.toBeNull()
    }
  })

  it('gives each anchored configuration key exactly one element id', () => {
    renderWithProviders(<ChecksPanel />, { preloadedState: preloaded('real') })

    const ids = [...document.querySelectorAll('[id^="config--"]')].map(element => element.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('marks the mismatched source-tree value in context, not only in the list', () => {
    // QFO_DATA_DIR no longer carries a mismatch marker: the rule it belonged to is gone
    // (Appendix A.8), and its replacement is a `consistency` finding, not a config-tier one.
    // `panther_build_dirty` is now the only mismatch-tier config key with a live marker.
    renderWithProviders(<ChecksPanel />, { preloadedState: preloaded('real') })

    const row = document.getElementById('config--panther-build-dirty')
    expect(row).not.toBeNull()
    expect((row as HTMLElement).querySelector('[data-check-marker="issue"]')).not.toBeNull()
  })
})

describe('terminology', () => {
  it('never labels a figure with a bare "Sequences"', () => {
    renderWithProviders(<ChecksPanel />, { preloadedState: preloaded('real') })

    expect(screen.queryByText('Sequences')).toBeNull()
    expect(screen.queryByText(/^Sequences:/)).toBeNull()
    expect(screen.getByText(/Sequences in the built library: 1,742,145/)).toBeInTheDocument()
  })
})

describe('a report missing a section', () => {
  it('renders the dependent checks as not evaluated rather than as passes', () => {
    renderWithProviders(<ChecksPanel />, {
      preloadedState: preloaded('missingNodeTracking'),
    })

    expect(screen.getByRole('heading', { level: 4, name: 'Not evaluated' })).toBeInTheDocument()
    expect(screen.getByText('2 not evaluated')).toBeInTheDocument()
    expect(
      screen.getByText('LEAF nodes and library sequences could not be compared')
    ).toBeInTheDocument()
    // 6 rather than 7 (degradation.test.ts): stripping node_tracking removes the one derived
    // issue that depends on it (UNKNOWN node-type coverage); the other 6 are unaffected.
    expect(screen.getByText('6 issues to review')).toBeInTheDocument()
  })
})

describe('the shared contract', () => {
  it('is mounted build-wide by the shell as a no-props default export', async () => {
    renderWithProviders(<BuildShell />, { route: BUILD_ROUTE })

    // Lazy behind the report registry, so the shell renders before the chunk resolves.
    expect(
      await screen.findByText('7 issues to review', undefined, { timeout: 10000 })
    ).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { name: 'Checks' })).toHaveLength(1)
    expect(
      screen.getByRole('heading', { name: 'Configuration read in three tiers' })
    ).toBeInTheDocument()
  }, 20000) // The whole shell in jsdom: fourteen phase nodes, every lazy report and this panel.
})
