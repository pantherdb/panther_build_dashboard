import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { initialBuildUiState } from '@/features/build/slices/buildSlice'
import { checkRoute } from '@/features/build/model'
import { ConfigCheckMarker } from '@/features/checks/components/ConfigCheckMarker'
import { MetricCheckMarker } from '@/features/checks/components/MetricCheckMarker'
import { PhaseCheckMarker } from '@/features/checks/components/PhaseCheckMarker'
import { renderWithProviders } from '@tests/test-utils'

/**
 * The in-context markers.
 *
 * "Avoid a disconnected warning page as the primary experience" is a requirement, not a preference,
 * and these three components are how it is met: the same findings reachable from the phase node, the
 * configuration value and the figure. Each renders NOTHING when no finding names its subject, which
 * is what lets a caller drop one into every row of a table without cluttering the rows that have
 * nothing to say.
 */

const preloaded = { build: { ...initialBuildUiState } }

describe('PhaseCheckMarker', () => {
  it('marks the frontier phase with the generator warning attributed to it', () => {
    renderWithProviders(<PhaseCheckMarker phaseId="library-export-products" />, {
      preloadedState: preloaded,
    })

    const marker = document.querySelector('[data-phase-check-marker="issue"]')
    expect(marker).not.toBeNull()
    expect(marker?.textContent).toContain('1')
  })

  it('marks the hole as a note rather than as a warning', () => {
    renderWithProviders(<PhaseCheckMarker phaseId="sequence-to-family-mapping" />, {
      preloadedState: preloaded,
    })

    expect(document.querySelector('[data-phase-check-marker="issue"]')).toBeNull()
    const note = document.querySelector('[data-phase-check-marker="note"]')
    expect(note).not.toBeNull()
    expect(note?.getAttribute('href')).toBe(checkRoute('pipeline.holes:sequence-to-family-mapping'))
  })

  it('keeps verified findings off the spine unless asked for them', () => {
    const { unmount } = renderWithProviders(<PhaseCheckMarker phaseId="tree-building-giga" />, {
      preloadedState: preloaded,
    })
    expect(document.querySelector('[data-phase-check-marker]')).toBeNull()
    unmount()

    renderWithProviders(<PhaseCheckMarker phaseId="tree-building-giga" includeVerified />, {
      preloadedState: preloaded,
    })
    expect(document.querySelector('[data-phase-check-marker="verified"]')).not.toBeNull()
  })

  it('renders nothing for a phase no finding concerns', () => {
    renderWithProviders(<PhaseCheckMarker phaseId="msa-build-orig" />, {
      preloadedState: preloaded,
    })
    expect(document.querySelector('[data-phase-check-marker]')).toBeNull()
  })
})

describe('ConfigCheckMarker', () => {
  it('marks the dirty source tree as a mismatch and links to the finding', () => {
    // `config.qfo-release` (keyed on QFO_DATA_DIR) is gone along with the rule it belonged to
    // (Appendix A.8); `config.source-dirty` (keyed on panther_build_dirty) is now the only
    // mismatch-tier finding with a configKey, per configTiers.test.ts.
    renderWithProviders(<ConfigCheckMarker configKey="panther_build_dirty" />, {
      preloadedState: preloaded,
    })

    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', checkRoute('config.source-dirty'))
    expect(link).toHaveTextContent('Mismatch')
    expect(link).toHaveAccessibleName(/panther_build_dirty/)
  })

  it('marks a notable value as notable, not as a warning', () => {
    renderWithProviders(<ConfigCheckMarker configKey="PC_CLASS" />, { preloadedState: preloaded })

    expect(screen.getByRole('link')).toHaveTextContent('Notable')
    expect(document.querySelector('[data-check-marker="issue"]')).toBeNull()
  })

  it('renders nothing for a configuration key no finding names', () => {
    renderWithProviders(<ConfigCheckMarker configKey="BLAST_CPUS" />, {
      preloadedState: preloaded,
    })
    expect(screen.queryByRole('link')).toBeNull()
  })
})

describe('MetricCheckMarker', () => {
  it('puts the node-type warning beside the forward-tracking rate', () => {
    renderWithProviders(<MetricCheckMarker metricId="pctNodesMapped" />, {
      preloadedState: preloaded,
    })

    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', checkRoute('nodes.type-coverage'))
    // The accessible name comes from the definitions registry, never from the metric id.
    expect(link).toHaveAccessibleName(/Node forward-tracking rate/)
  })

  it('renders nothing for a metric no finding concerns', () => {
    renderWithProviders(<MetricCheckMarker metricId="subfamilies" />, {
      preloadedState: preloaded,
    })
    expect(screen.queryByRole('link')).toBeNull()
  })
})
