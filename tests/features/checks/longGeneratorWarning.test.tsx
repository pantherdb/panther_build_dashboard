import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { buildStateSource, toLongGeneratorWarning } from '@/features/build/fixtures'
import { parseBuildState } from '@/features/build/model'
import { CheckList } from '@/features/checks/components/CheckList'
import { runChecks } from '@/features/checks/model'
import { renderWithProviders } from '@tests/test-utils'

/**
 * The scenario the plan exists for: a `config_file_contents` generator warning carrying the whole
 * config.mk twice (~10 KB on the live report), rendered through the real checks panel plumbing -
 * `runChecks` -> `CheckList` -> `CheckRow` - rather than against `LongMessage` in isolation.
 *
 * Scoped to this warning's own row throughout: the real fixture already carries two other long
 * generator warnings (the off-majority-release and previous-roster proteome warnings, both over
 * the character threshold on their own), so a page-wide query would see more than one collapsed
 * message and more than one toggle.
 */

const rowFor = (): HTMLElement => {
  const row = screen
    .getByText(/config `config_file_contents` changed during this build/)
    .closest('li')
  if (row === null) throw new Error('no rendered row for the config_file_contents warning')
  return row as HTMLElement
}

describe('a long, multi-line generator warning on the checks panel', () => {
  it('renders collapsed by default, with the full config snapshot not on screen', () => {
    const report = parseBuildState(toLongGeneratorWarning()(buildStateSource))
    const { checks } = runChecks(report)

    renderWithProviders(<CheckList checks={checks} />)

    const row = rowFor()
    expect(within(row).queryByText(/AFTER_SETTING_13/)).not.toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Show full message' })).toBeInTheDocument()
  })

  it('expands to the full snapshot on request', async () => {
    const report = parseBuildState(toLongGeneratorWarning()(buildStateSource))
    const { checks } = runChecks(report)

    const { user } = renderWithProviders(<CheckList checks={checks} />)
    const row = rowFor()
    await user.click(within(row).getByRole('button', { name: 'Show full message' }))

    expect(within(row).getByText(/AFTER_SETTING_13/)).toBeInTheDocument()
  })
})
