import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MetricValue } from '@/@panther.core/components/MetricValue'
import { MetricDefinitionsProvider } from '@/@panther.core/components/metricDefinitions'
import { renderWithProviders } from '@tests/test-utils'

/**
 * `MetricValue`'s label was a Tooltip wrapped around a plain, non-focusable span: reachable by
 * mouse only. These guard the fix - a resolved label must be a keyboard focus stop, and an
 * unresolved one (nothing to reveal) must not become one.
 */
describe('MetricValue accessibility', () => {
  it('makes a defined label reachable without a mouse', async () => {
    renderWithProviders(
      <MetricDefinitionsProvider
        registry={{ m: { id: 'm', label: 'A metric', description: 'What it counts.' } }}
      >
        <MetricValue metricId="m" value={1} />
      </MetricDefinitionsProvider>
    )
    await userEvent.tab()
    expect(screen.getByText('A metric')).toHaveFocus()
  })

  it('does not make an undefined label focusable', async () => {
    renderWithProviders(
      <MetricDefinitionsProvider registry={{}}>
        <MetricValue metricId="unregistered" value={1} />
      </MetricDefinitionsProvider>
    )
    expect(screen.getByText(/unregistered/)).not.toHaveAttribute('tabindex')
  })
})
