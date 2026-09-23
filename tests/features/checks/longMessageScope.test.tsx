import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CheckRow } from '@/features/checks/components/CheckRow'
import { InlineCheckMarker } from '@/features/checks/components/InlineCheckMarker'
import { PhaseCheckMarker } from '@/features/checks/components/PhaseCheckMarker'
import { fromGenerator, noted } from '@/features/checks/model'
import type { CheckFinding } from '@/features/checks/model'
import { renderWithProviders } from '@tests/test-utils'

vi.mock('@/features/checks/hooks', () => ({
  useChecksForPhase: vi.fn(),
}))

/**
 * LongMessage/previewMessage exist for the generator's own long, sometimes multi-line warnings
 * (see LongMessage's doc comment) - not for every finding. Before this fix, the checks UI applied
 * both indiscriminately, so a dashboard-authored derived-check explanation over 240 characters
 * collapsed behind a "Show full message" toggle exactly as if it were a generator warning: 16 of
 * 28 findings on a real report, most of them dashboard-authored. This pins the scoping to
 * `finding.origin`, which the model already tracks (`finding.ts`'s factories set it, never the
 * caller).
 */

const LONG_EXPLANATION =
  'This derived-check explanation is authored entirely by the dashboard, not quoted from the ' +
  'generator, and it runs well past the two-hundred-forty character threshold that LongMessage ' +
  'uses to decide whether a message is long enough to collapse behind a toggle, on purpose, so ' +
  'the test can tell the two origins apart by rendered behaviour alone.'

const LONG_GENERATOR_WARNING =
  'config `config_file_contents` changed during this build: this generator-authored warning also ' +
  'runs well past the two-hundred-forty character threshold LongMessage uses, on purpose, so the ' +
  'test can confirm generator warnings still collapse behind the toggle after the scoping fix.'

const derivedFinding: CheckFinding = noted({
  id: 'test.derived-long',
  ruleId: 'test.derived-long',
  category: 'consistency',
  label: 'A derived check',
  explanation: LONG_EXPLANATION,
  source: 'test.source',
  anchor: '/test/anchor',
  anchorLabel: 'Test anchor',
})

const generatorFinding: CheckFinding = fromGenerator({
  id: 'generator.warning:test-1',
  ruleId: 'generator.warning',
  category: 'pipeline',
  label: 'A generator warning',
  explanation: LONG_GENERATOR_WARNING,
  source: 'test.source',
  anchor: '/test/anchor',
  anchorLabel: 'Test anchor',
})

describe('CheckRow: LongMessage scoped to generator warnings', () => {
  it('renders a long derived-check explanation in full, with no toggle', () => {
    renderWithProviders(<CheckRow finding={derivedFinding} />)

    expect(screen.getByText(LONG_EXPLANATION)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Show full message' })).not.toBeInTheDocument()
  })

  it('still collapses a long generator warning behind a toggle', () => {
    renderWithProviders(<CheckRow finding={generatorFinding} />)

    expect(screen.queryByText(LONG_GENERATOR_WARNING)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show full message' })).toBeInTheDocument()
  })
})

describe('InlineCheckMarker: tooltip content scoped to generator warnings', () => {
  it('quotes a long derived-check explanation in full in the tooltip', async () => {
    const { user } = renderWithProviders(
      <InlineCheckMarker findings={[derivedFinding]} subject="test subject" />
    )

    await user.hover(screen.getByRole('link'))
    await waitFor(() => {
      expect(screen.getByText(`Notable: ${LONG_EXPLANATION}`)).toBeInTheDocument()
    })
  })

  it('still clips a long generator warning in the tooltip', async () => {
    const { user } = renderWithProviders(
      <InlineCheckMarker findings={[generatorFinding]} subject="test subject" />
    )

    await user.hover(screen.getByRole('link'))
    await waitFor(() => {
      expect(screen.queryByText(`Mismatch: ${LONG_GENERATOR_WARNING}`)).not.toBeInTheDocument()
      expect(screen.getByText(/…$/)).toBeInTheDocument()
    })
  })
})

describe('PhaseCheckMarker: tooltip content scoped to generator warnings', () => {
  it('quotes a long derived-check explanation in full for its phase', async () => {
    const { useChecksForPhase } = await import('@/features/checks/hooks')
    vi.mocked(useChecksForPhase).mockReturnValue([derivedFinding])

    const { user } = renderWithProviders(<PhaseCheckMarker phaseId="test-phase" />)

    const marker = document.querySelector('[data-phase-check-marker="note"]')
    expect(marker).not.toBeNull()
    await user.hover(marker as Element)
    await waitFor(() => {
      expect(screen.getByText(`A derived check. ${LONG_EXPLANATION}`)).toBeInTheDocument()
    })
  })

  it('still clips a long generator warning for its phase', async () => {
    const { useChecksForPhase } = await import('@/features/checks/hooks')
    vi.mocked(useChecksForPhase).mockReturnValue([generatorFinding])

    const { user } = renderWithProviders(<PhaseCheckMarker phaseId="test-phase" />)

    const marker = document.querySelector('[data-phase-check-marker="issue"]')
    expect(marker).not.toBeNull()
    await user.hover(marker as Element)
    await waitFor(() => {
      expect(
        screen.queryByText(`A generator warning. ${LONG_GENERATOR_WARNING}`)
      ).not.toBeInTheDocument()
      expect(screen.getByText(/…$/)).toBeInTheDocument()
    })
  })
})
