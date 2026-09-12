import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MetricDefinitionsProvider } from '@/@panther.core/components'
import BuildShell from '@/app/layout/BuildShell'
import { curatedRegistry } from '@/app/metricRegistry'
import { BUILD_ROUTE, configElementId, stepElementId } from '@/features/build/model'
import { CommandPalette } from '@/features/search/components/CommandPalette'
import { renderWithProviders } from '@tests/test-utils'

/**
 * The palette, and then the palette mounted over the real record.
 *
 * The requirement is not "a list appears" - it is that a hit LANDS on the thing itself. A step, a
 * report and a configuration value only exist in the DOM once the spine has selected the node that
 * owns them, so the only honest test of a jump is to make it and then look for the element the
 * anchor names. That needs the whole shell, which is expensive in jsdom, so only the jump tests pay
 * for it.
 */

const renderPalette = () => renderWithProviders(<CommandPalette />, { route: BUILD_ROUTE })

const renderApp = () =>
  renderWithProviders(
    <MetricDefinitionsProvider registry={curatedRegistry}>
      <CommandPalette />
      <BuildShell />
    </MetricDefinitionsProvider>,
    { route: BUILD_ROUTE }
  )

/** Queried by label, not by role: an accessible-name scan over the whole record is slow in jsdom. */
const openPalette = async (user: ReturnType<typeof renderPalette>['user']) => {
  await user.click(screen.getByLabelText('Search this build'))
  return screen.getByLabelText('Search the build report')
}

/** Set in one event rather than typed: 19 keystrokes is 19 renders and proves nothing extra. */
const setQuery = (input: HTMLElement, value: string) => {
  fireEvent.change(input, { target: { value } })
}

const options = (): HTMLElement[] =>
  Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'))

describe('opening the palette', () => {
  it('opens on ctrl-K from anywhere in the record', async () => {
    const { user } = renderPalette()

    expect(screen.queryByLabelText('Search the build report')).toBeNull()
    await user.keyboard('{Control>}k{/Control}')

    expect(screen.getByLabelText('Search the build report')).toBeInTheDocument()
  })

  it('says what is indexed before anything is typed', async () => {
    const { user } = renderPalette()
    await openPalette(user)

    // The counts are the scope argument: Appendix A.1 (14 phases, 62 steps, 9 sections), A.6/A.10
    // (147 species across both releases) and A.8 (59 configuration variables).
    expect(
      screen.getByText(
        /Indexed: 14 phases · 62 steps · 9 reports · 10 findings · 147 species · 59 config variables/
      )
    ).toBeInTheDocument()
  })

  it('reports how many entries matched', async () => {
    const { user } = renderPalette()
    const input = await openPalette(user)
    setQuery(input, 'DAPMA')

    expect(screen.getByText(/matches\.$/)).toBeInTheDocument()
    expect(options().length).toBeGreaterThan(0)
  })

  it('says so when nothing matches, rather than showing an empty list', async () => {
    const { user } = renderPalette()
    const input = await openPalette(user)
    setQuery(input, 'zzzznotinthisreport')

    expect(screen.getByText('Nothing in this report matches')).toBeInTheDocument()
    expect(options()).toHaveLength(0)
  })

  it('marks a generator-emitted finding differently from a dashboard-derived one', async () => {
    const { user } = renderPalette()
    const input = await openPalette(user)
    setQuery(input, 'agree')

    const derived = document.querySelectorAll('[data-search-kind="check"] [data-provenance]')
    expect(derived.length).toBeGreaterThan(0)
    expect(derived[0]).toHaveAttribute('data-provenance', 'derived')
  })
})

describe('keyboard navigation', () => {
  it('moves the active option with the arrow keys and commits the active one', async () => {
    const { store, user } = renderPalette()
    const input = await openPalette(user)

    setQuery(input, 'CRY')
    const shown = options()
    expect(shown.length).toBeGreaterThan(1)
    expect(shown[0]).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{ArrowDown}')
    const moved = options()
    expect(moved[0]).toHaveAttribute('aria-selected', 'false')
    expect(moved[1]).toHaveAttribute('aria-selected', 'true')
    const secondTitle = within(moved[1]).getAllByText(/./)[1]?.textContent

    await user.keyboard('{ArrowUp}{ArrowDown}{Enter}')

    // Both CRY hits are species, so the stored selection proves which row was committed.
    await waitFor(() => {
      expect(store.getState().build.selectedOscode).toBe(secondTitle)
    })
    expect(screen.queryByLabelText('Search the build report')).toBeNull()
  })

  it('does not move past the ends of the list', async () => {
    const { user } = renderPalette()
    const input = await openPalette(user)

    setQuery(input, 'DAPMA')
    await user.keyboard('{ArrowUp}{ArrowUp}')
    expect(options()[0]).toHaveAttribute('aria-selected', 'true')
  })

  it('opens the species cross-section for a species hit', async () => {
    const { store, user } = renderPalette()
    const input = await openPalette(user)

    setQuery(input, 'DAPMA')
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(store.getState().build.selectedOscode).toBe('DAPMA')
    })
  })
})

describe('every kind of hit lands on a live anchor', () => {
  it('lands on a step behind the frontier, moving the spine selection to reach it', async () => {
    const { user } = renderApp()
    const input = await openPalette(user)

    // Appendix A.2: this step is one of the two holes in Sequence-to-family mapping, which is not
    // the phase the record opens on.
    setQuery(input, 'validate_blast')
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(
        document.getElementById(stepElementId('sequence-to-family-mapping--validate-blast-step'))
      ).not.toBeNull()
    })
  })

  it('lands on a configuration variable inside the preamble', async () => {
    const { user } = renderApp()
    const input = await openPalette(user)

    setQuery(input, 'QFO_DATA_DIR')
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(document.getElementById(configElementId('QFO_DATA_DIR'))).not.toBeNull()
    })
  })

  it('lands on a report section, mounting the phase that owns it', async () => {
    const { user } = renderApp()
    const input = await openPalette(user)

    setQuery(input, 'Tree building')
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(document.getElementById('report--giga')).not.toBeNull()
    })
  })

  it('lands a generator warning on the step it names', async () => {
    const { user } = renderApp()
    const input = await openPalette(user)

    setQuery(input, 'possibly stale')
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(
        document.getElementById(
          stepElementId(
            'library-export-products--ftp-panther-hmm-classification-files-panther20-0-hmm-classifications'
          )
        )
      ).not.toBeNull()
    })
  })
})
