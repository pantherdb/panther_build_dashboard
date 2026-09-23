import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { getFixtureReport } from '@/features/build/fixtures'
import { loadSidecar } from '@/features/build/fixtures/sidecars'
import { useUnplacedFamilies } from '@/features/trees/hooks'

/**
 * Every status `useUnplacedFamilies` must distinguish, from the plan's ruling: loading, ready, not
 * referenced (the old in-report shape), referenced but not shipped, mismatched, and failed to
 * parse. `loadSidecar` is mocked here so each status can be produced directly and deterministically
 * - the end-to-end "ready" path through the real test-alias + frozen fixture file is covered
 * separately by `UnplacedFragmentsReport.test.tsx`, which does not mock anything.
 */
vi.mock('@/features/build/fixtures/sidecars', () => ({ loadSidecar: vi.fn() }))

const mockedLoadSidecar = vi.mocked(loadSidecar)

const oldShapeReport = getFixtureReport('gigaUsf')
const sidecarReport = getFixtureReport('gigaUsfSidecar')
const sidecarRef = sidecarReport.unplacedFragments.sidecar
if (sidecarRef === null) throw new Error('fixture setup: gigaUsfSidecar must reference a sidecar')

function matchingSidecarDoc(overrides: Record<string, unknown> = {}) {
  const raw = sidecarReport.raw as { target: string; generated_at: string }
  return {
    schema_version: 1,
    target: raw.target,
    generated_at: raw.generated_at,
    section_id: 'giga_usf',
    data: {
      families: [
        { family: 'PTHR1', unplaced: 2, tree_leaves: 10, unplaced_fraction: 0.2, members: ['A'] },
      ],
    },
    ...overrides,
  }
}

describe('useUnplacedFamilies', () => {
  it('is "not referenced" immediately for a report using the old in-report shape', () => {
    const { result } = renderHook(() => useUnplacedFamilies(oldShapeReport))
    expect(result.current.status).toBe('not-referenced')
    expect(result.current.families).toEqual(oldShapeReport.unplacedFragments.families)
    expect(mockedLoadSidecar).not.toHaveBeenCalled()
  })

  it('is "loading" before the sidecar promise settles', () => {
    mockedLoadSidecar.mockReturnValue(new Promise(() => {}))
    const { result } = renderHook(() => useUnplacedFamilies(sidecarReport))
    expect(result.current.status).toBe('loading')
    expect(result.current.families).toEqual([])
  })

  it('is "ready" with the parsed families once the sidecar resolves and matches', async () => {
    mockedLoadSidecar.mockResolvedValue(matchingSidecarDoc())
    const { result } = renderHook(() => useUnplacedFamilies(sidecarReport))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.families).toEqual([
      {
        family: 'PTHR1',
        unplaced: 2,
        treeLeaves: 10,
        unplacedFraction: 0.2,
        inputSeqs: null,
        members: ['A'],
      },
    ])
    expect(mockedLoadSidecar).toHaveBeenCalledWith(sidecarRef.file)
  })

  it('is "not shipped" when loadSidecar returns null (file missing from docs/)', async () => {
    mockedLoadSidecar.mockReturnValue(null)
    const { result } = renderHook(() => useUnplacedFamilies(sidecarReport))
    await waitFor(() => expect(result.current.status).toBe('not-shipped'))
    expect(result.current.families).toEqual([])
  })

  it('is "mismatched" when the fetched sidecar names a different report', async () => {
    mockedLoadSidecar.mockResolvedValue(matchingSidecarDoc({ target: 'a_different_target' }))
    const { result } = renderHook(() => useUnplacedFamilies(sidecarReport))
    await waitFor(() => expect(result.current.status).toBe('mismatched'))
    expect(result.current.families).toEqual([])
  })

  it('is "parse-error" when the sidecar promise rejects', async () => {
    mockedLoadSidecar.mockRejectedValue(new Error('network error'))
    const { result } = renderHook(() => useUnplacedFamilies(sidecarReport))
    await waitFor(() => expect(result.current.status).toBe('parse-error'))
    expect(result.current.families).toEqual([])
  })

  it('is "parse-error" when the resolved payload is not readable as the sidecar envelope', async () => {
    mockedLoadSidecar.mockResolvedValue('not an object')
    const { result } = renderHook(() => useUnplacedFamilies(sidecarReport))
    await waitFor(() => expect(result.current.status).toBe('parse-error'))
  })

  it('does not update state after unmount (cancellation-safe)', async () => {
    let resolveSidecar: (value: unknown) => void = () => {}
    mockedLoadSidecar.mockReturnValue(
      new Promise(resolve => {
        resolveSidecar = resolve
      })
    )
    const { result, unmount } = renderHook(() => useUnplacedFamilies(sidecarReport))
    expect(result.current.status).toBe('loading')
    unmount()

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    await act(async () => {
      resolveSidecar(matchingSidecarDoc())
      await Promise.resolve()
    })
    expect(consoleError).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })
})
