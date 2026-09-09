import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import BuildShell from '@/app/layout/BuildShell'
import { phaseAnchor } from '@/features/build/model'
import { BUILD_ROUTE } from '@/features/build/model'
import { renderWithProviders } from '@tests/test-utils'

/**
 * The shell's mounting contract, exercised end to end against the captured report.
 *
 * Two properties matter beyond "it renders". The content column defaults to the FRONTIER rather
 * than to the first phase, and a deep link moves the selection so that the anchor it points at
 * actually exists - a link that only scrolled would land on an unmounted element.
 */
describe('BuildShell', () => {
  it('renders the preamble, the frontier statement, the spine and the timeline together', async () => {
    renderWithProviders(<BuildShell />, { route: BUILD_ROUTE })

    expect(screen.getByRole('heading', { level: 1, name: 'PANTHER 20.0' })).toBeInTheDocument()
    expect(screen.getByText(/^The build frontier is Final packaging/)).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Build pipeline phases' })).toBeInTheDocument()
    expect(
      screen.getByText(
        'Spans are inferred from artifact timestamps: elapsed activity, not measured runtime.'
      )
    ).toBeInTheDocument()

    // The lazily mounted report views settle without the shell waiting on them. `library` is the
    // section bound to the frontier phase the record opens on.
    expect((await screen.findAllByText('New library contents')).length).toBeGreaterThan(0)
  })

  it('opens on the frontier, not on the earliest incomplete phase', () => {
    renderWithProviders(<BuildShell />, { route: BUILD_ROUTE })

    expect(
      screen.getByRole('heading', { level: 3, name: 'Final packaging' })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { level: 3, name: 'Setup & resource download' })
    ).toBeNull()
    expect(
      screen.queryByRole('heading', { level: 3, name: 'Sequence-to-family mapping' })
    ).toBeNull()
  })

  it('follows a phase deep link by moving the selection, not only by scrolling', async () => {
    renderWithProviders(<BuildShell />, {
      route: `${BUILD_ROUTE}${phaseAnchor('sequence-to-family-mapping')}`,
    })

    expect(
      await screen.findByRole('heading', { level: 3, name: 'Sequence-to-family mapping' })
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Incomplete, but 11 later phases carried on past it. This is a hole behind the frontier, not the point where the build stopped.'
      )
    ).toBeInTheDocument()
  })

  it('changes the content column when a spine node is chosen', async () => {
    const { user } = renderWithProviders(<BuildShell />, { route: BUILD_ROUTE })

    // The timeline exposes a row per phase as a button too, so the click is scoped to the spine.
    const spine = screen.getByRole('navigation', { name: 'Build pipeline phases' })
    await user.click(within(spine).getByRole('button', { name: /Node forward tracking/ }))

    // The phase and the report bound to it share a name, so the position line identifies the detail.
    expect(screen.getByText('phase 9 of 14')).toBeInTheDocument()
    expect(screen.getByText('Every step in this phase produced its artifact.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 3, name: 'Library export products' })).toBeNull()
  })

  it('mounts the unattached-reports node from the end of the spine', async () => {
    const { user } = renderWithProviders(<BuildShell />, { route: BUILD_ROUTE })

    const spine = screen.getByRole('navigation', { name: 'Build pipeline phases' })
    await user.click(within(spine).getByRole('button', { name: /Unattached reports/ }))

    expect(screen.getByText('Every section is bound to a phase')).toBeInTheDocument()
  })

  it('mounts the build-wide checks view exactly once', async () => {
    renderWithProviders(<BuildShell />, { route: BUILD_ROUTE })

    // The checks view is not section-bound, so the shell must mount exactly one -
    // a second copy would double-count the issue summary. Counted on a marker
    // attribute rather than on text, because the panel's title shares an element
    // with its subtitle and so is not an exact text match.
    await waitFor(() => expect(document.querySelectorAll('[data-checks-panel]')).toHaveLength(1))
  })
})
