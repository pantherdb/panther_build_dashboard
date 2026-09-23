/**
 * Lazily loads a sidecar data file that sits beside `docs/build_state.json`.
 *
 * Some sections (`giga_usf` first) keep only a small reference to their per-family detail in the
 * main report - `{file, bytes, sha256}` - and ship the rest as its own JSON file next to
 * `build_state.json`, so megabytes of per-family data never enter the main bundle. This module is
 * the one place that turns that reference into data, on demand, when a view actually needs it.
 *
 * `import.meta.glob` (NOT a literal `import()`) is required here. `docs/build_state.giga_usf.json`
 * does not exist in this checkout yet - `giga_usf` is "registered ahead of its data" until a real
 * target is regenerated (see the workspace CLAUDE.md). A literal dynamic `import()` of a path that
 * is not on disk is a hard build/dev error in Vite; `import.meta.glob` tolerates a pattern matching
 * zero files and simply returns an empty map, which is exactly the "referenced but not shipped"
 * case this loader has to support without crashing the app. The glob is lazy by default (no
 * `eager: true`), so Rollup puts every matched file in its own chunk, fetched only when its loader
 * function is actually called.
 *
 * UNDER VITEST THIS MODULE IS NOT USED. A `test.alias` in `vite.config.ts` redirects any import
 * of this file to `tests/support/sidecarsTestSource.ts`, which serves the frozen
 * `tests/fixtures/build_state.giga_usf.reference.json` instead of reading `docs/`. That has to be
 * a whole-module swap rather than the single-JSON-specifier swap `fixtures/source.ts` uses for the
 * main report: `import.meta.glob`'s matched-file set is fixed by scanning the literal pattern
 * against the real filesystem at transform time (a dedicated Vite plugin, not `resolve.alias`), so
 * aliasing one resolved specifier cannot change which directory a glob call enumerates.
 */
const sidecarModules = import.meta.glob('/docs/build_state.*.json', {
  import: 'default',
}) as Record<string, () => Promise<unknown>>

/**
 * @param file - the basename the main report's `sidecar.file` names, e.g. `build_state.giga_usf.json`.
 * @returns a promise for the parsed JSON, or `null` when no file with that name was shipped.
 */
export function loadSidecar(file: string): Promise<unknown> | null {
  const match = Object.keys(sidecarModules).find(modulePath => modulePath.endsWith(`/${file}`))
  return match === undefined ? null : sidecarModules[match]()
}
