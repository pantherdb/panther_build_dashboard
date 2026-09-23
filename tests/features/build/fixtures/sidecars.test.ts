import { describe, expect, it } from 'vitest'
import { loadSidecar } from '@/features/build/fixtures/sidecars'

/**
 * The lazy sidecar loader's test-time substitution.
 *
 * `sidecars.ts` globs `docs/*` in production, which does not exist under Vitest (and must not -
 * see `vite.config.ts`'s `test.alias`, which is what this file actually proves is wired up: the
 * specifier `@/features/build/fixtures/sidecars` resolves to `tests/support/sidecarsTestSource.ts`
 * under Vitest, which serves the frozen `tests/fixtures/build_state.giga_usf.reference.json`
 * instead of reading `docs/`.
 */
describe('loadSidecar (test-time substitution)', () => {
  it('resolves the frozen fixture for the file the giga_usf sidecar contract names', async () => {
    const pending = loadSidecar('build_state.giga_usf.json')
    expect(pending).not.toBeNull()
    const data = (await pending) as { section_id: string; data: { families: unknown[] } }
    expect(data.section_id).toBe('giga_usf')
    expect(data.data.families).toHaveLength(2)
  })

  it('returns null - not a rejected promise - for a file nothing shipped', () => {
    expect(loadSidecar('build_state.nonexistent.json')).toBeNull()
  })
})
