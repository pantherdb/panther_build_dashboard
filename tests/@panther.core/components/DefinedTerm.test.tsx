import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DefinedTerm, MetricDefinitionsProvider } from '@/@panther.core/components'
import { renderWithProviders } from '@tests/test-utils'

/**
 * A bucket string with its meaning attached (spec §6.3).
 *
 * The affordance must be reachable without a mouse. Every definition in this app was hover-only
 * until this component: `MetricValue` wrapped its label in a Tooltip around a plain span, which no
 * keyboard and no touch screen can reach.
 */
const REGISTRY = {
  'recluster.new_family': {
    id: 'recluster.new_family',
    label: 'Became a new family',
    description: 'Minted a new PANTHER family id.',
  },
}

const renderTerm = (definitionId: string, fallback: string, label?: string) =>
  renderWithProviders(
    <MetricDefinitionsProvider registry={REGISTRY}>
      <DefinedTerm definitionId={definitionId} fallback={fallback} label={label} />
    </MetricDefinitionsProvider>
  )

describe('DefinedTerm', () => {
  it('shows the registry label in place of the raw term', () => {
    renderTerm('recluster.new_family', 'new_family')
    expect(screen.getByText('Became a new family')).toBeInTheDocument()
  })

  it('is focusable, so the definition is reachable without a mouse', async () => {
    renderTerm('recluster.new_family', 'new_family')
    await userEvent.tab()
    expect(screen.getByText('Became a new family')).toHaveFocus()
  })

  it('reveals the definition on focus', async () => {
    renderTerm('recluster.new_family', 'new_family')
    await userEvent.tab()
    expect(await screen.findByText('Minted a new PANTHER family id.')).toBeInTheDocument()
  })

  it("shows the report's own term verbatim when nothing defines it", () => {
    renderTerm('recluster.unknown_bucket', 'unknown_bucket')
    expect(screen.getByText('unknown_bucket')).toBeInTheDocument()
  })

  it('does not make an undefined term focusable, since there is nothing to reveal', async () => {
    renderTerm('recluster.unknown_bucket', 'unknown_bucket')
    expect(screen.getByText('unknown_bucket')).not.toHaveAttribute('tabindex')
  })

  /**
   * A caller-curated `label` is prose, not a raw identifier - it must win over the registry's own
   * label when a definition resolves, and it must never take the identifier's mono styling when
   * nothing resolves. Regression coverage for the "ID match" rendered as `pb-ident` defect.
   */
  describe('with a curated label', () => {
    it('shows the curated label instead of the registry label when the definition resolves', () => {
      renderTerm('recluster.new_family', 'new_family', 'Curated reading')
      expect(screen.getByText('Curated reading')).toBeInTheDocument()
      expect(screen.queryByText('Became a new family')).not.toBeInTheDocument()
    })

    it('keeps the tooltip reachable by keyboard when the definition resolves', async () => {
      renderTerm('recluster.new_family', 'new_family', 'Curated reading')
      await userEvent.tab()
      expect(screen.getByText('Curated reading')).toHaveFocus()
      expect(await screen.findByText('Minted a new PANTHER family id.')).toBeInTheDocument()
    })

    it('shows the curated label, with no identifier styling, when nothing defines the term', () => {
      renderTerm('recluster.unknown_bucket', 'unknown_bucket', 'Curated reading')
      expect(screen.getByText('Curated reading')).not.toHaveClass('pb-ident')
    })

    it('does not make an unresolved curated label focusable', () => {
      renderTerm('recluster.unknown_bucket', 'unknown_bucket', 'Curated reading')
      expect(screen.getByText('Curated reading')).not.toHaveAttribute('tabindex')
    })
  })
})
