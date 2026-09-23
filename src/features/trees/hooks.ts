import { useEffect, useState } from 'react'
import { loadSidecar } from '@/features/build/fixtures/sidecars'
import { parseUsfSidecar } from '@/features/build/model'
import type { BuildReport, UnplacedFamilyRow } from '@/features/build/model'

/**
 * Every status the Unplaced fragments view has to give honest copy for.
 *
 *  - `loading`        the sidecar file is being fetched.
 *  - `ready`           it fetched, matched this report, and parsed - `families` is the answer.
 *  - `not-referenced`  `report.unplacedFragments.sidecar` is null: an older report, using the OLD
 *                      in-report shape. `families` falls back to `summary.families` (from the
 *                      family table `giga_usf`'s data carried directly), which is already
 *                      available synchronously - there is nothing to load.
 *  - `not-shipped`     the main report names a sidecar file, but `loadSidecar` found none - it was
 *                      never copied alongside `build_state.json`.
 *  - `mismatched`      a file was fetched, but its own `target`/`generated_at`/`section_id` do not
 *                      match this report - it belongs to a different build.
 *  - `parse-error`     the fetch failed, or what came back cannot be read as the sidecar envelope
 *                      at all.
 */
export type UnplacedFamiliesStatus =
  'loading' | 'ready' | 'not-referenced' | 'not-shipped' | 'mismatched' | 'parse-error'

export interface UnplacedFamiliesState {
  status: UnplacedFamiliesStatus
  families: UnplacedFamilyRow[]
}

/** The old-shape fallback, or `null` when a sidecar is referenced and must be fetched instead. */
function fallbackState(report: BuildReport): UnplacedFamiliesState | null {
  const summary = report.unplacedFragments
  return summary.sidecar === null ? { status: 'not-referenced', families: summary.families } : null
}

/**
 * Loads the `giga_usf` family table: synchronously from the main report on an older report (no
 * sidecar reference), or lazily from its sidecar file otherwise. Cancellation-safe - a report swap
 * or unmount before the fetch settles never applies a stale state update.
 */
export function useUnplacedFamilies(report: BuildReport): UnplacedFamiliesState {
  const [state, setState] = useState<UnplacedFamiliesState>(
    () => fallbackState(report) ?? { status: 'loading', families: [] }
  )

  useEffect(() => {
    let cancelled = false

    const fallback = fallbackState(report)
    if (fallback !== null) {
      setState(fallback)
      return
    }

    setState({ status: 'loading', families: [] })
    // `fallback === null` means `sidecar` is non-null; re-read it narrowed rather than widen the
    // return type of `fallbackState` just to hand back a value already implied by its null-ness.
    const sidecar = report.unplacedFragments.sidecar
    if (sidecar === null) return
    const pending = loadSidecar(sidecar.file)
    if (pending === null) {
      setState({ status: 'not-shipped', families: [] })
      return
    }

    pending
      .then(raw => {
        if (!cancelled) setState(parseUsfSidecar(raw, report))
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'parse-error', families: [] })
      })

    return () => {
      cancelled = true
    }
  }, [report])

  return state
}
