import fs from 'node:fs'
import path from 'node:path'
import { screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as FixturesModule from '@/features/build/fixtures'
import type { FixtureStateKey } from '@/features/build/fixtures'

/**
 * A render smoke test against the LIVE report - the companion to `liveReport.contract.test.ts`.
 *
 * Every component test in this repo runs against the frozen reference, which is what makes a data
 * refresh cheap. The gap that leaves is that nothing renders what the site actually ships: a report
 * can satisfy every contract assertion and still put a component into a state it cannot draw.
 *
 * So this mounts the whole shell on `docs/build_state.json` and asserts only that it comes up: no
 * throw, no error boundary, no console error. It pins nothing about the content, because the
 * content is the part that changes every build.
 *
 * The mock is how the live report gets in. `useBuildReport` reads `getFixtureReport(key)` and has
 * no injection seam, so the fixtures module is mocked with `importActual` and only that one export
 * overridden - every other consumer (`buildSlice`, `FixtureSwitcher`, `FixtureStateNotice`) keeps
 * the real thing.
 */

const LIVE_PATH = path.join(process.cwd(), 'docs', 'build_state.json')

vi.mock('@/features/build/fixtures', async importActual => {
  const actual = await importActual<typeof FixturesModule>()
  const { parseBuildStateCached } = await import('@/features/build/model')
  const live = JSON.parse(fs.readFileSync(LIVE_PATH, 'utf8'))
  const liveReport = parseBuildStateCached(live)
  return {
    ...actual,
    // Only the default state shows live data. The named demo states stay recipes over the frozen
    // reference, so this file does not silently redefine what `failed` or `stale` mean.
    getFixtureReport: (key: FixtureStateKey) =>
      key === actual.DEFAULT_FIXTURE_STATE_KEY ? liveReport : actual.getFixtureReport(key),
  }
})

describe('the live report renders', () => {
  let consoleError: ReturnType<typeof vi.spyOn>
  const errors: unknown[][] = []

  beforeEach(() => {
    errors.length = 0
    consoleError = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args)
    })
  })

  afterEach(() => {
    consoleError.mockRestore()
  })

  it('mounts the whole build shell without throwing or tripping an error boundary', async () => {
    const { renderWithProviders } = await import('@tests/test-utils')
    const { default: BuildShell } = await import('@/app/layout/BuildShell')
    const { BUILD_ROUTE } = await import('@/features/build/model')

    expect(() => renderWithProviders(<BuildShell />, { route: BUILD_ROUTE })).not.toThrow()

    // The heading proves the preamble mounted; the navigation proves the spine did.
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Build pipeline phases' })).toBeInTheDocument()

    // Proof the mock took: the target on screen is the one in the LIVE file, not the sanitised
    // one in the frozen reference. Read from the file rather than written down, so a new build
    // target does not become another number to update.
    const liveTarget = JSON.parse(fs.readFileSync(LIVE_PATH, 'utf8')).target as string
    expect(screen.getAllByText(liveTarget).length).toBeGreaterThan(0)

    // The report panels mount lazily; let them settle so a throw inside one is not missed.
    await waitFor(() => {
      expect(screen.queryByText(/Something went wrong/i)).not.toBeInTheDocument()
    })

    const messages = errors.map(args => args.map(String).join(' ')).join('\n')
    expect(messages, `console.error during render:\n${messages}`).toBe('')
  })
})
