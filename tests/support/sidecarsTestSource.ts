/**
 * The test-time substitution for `src/features/build/fixtures/sidecars.ts`.
 *
 * `vite.config.ts`'s `test.alias` redirects every import of the production loader to this file
 * under Vitest, mirroring how `fixtures/source.ts`'s single JSON import is redirected to
 * `tests/fixtures/build_state.reference.json` - except at the whole-module boundary, because a
 * glob's matched-file set cannot be redirected by aliasing one resolved specifier (see the long
 * comment on `sidecars.ts` for why). Each fixture is a plain, real import - not a glob - since
 * there is exactly one sidecar fixture and its name is known in advance.
 *
 * `build_state.giga_usf.reference.json` (the .json fixture below can't hold this comment itself)
 * is re-verified the same deliberate, rare way the main `build_state.reference.json` oracle is
 * (see CLAUDE.md's "Re-verifying the oracle"): copy the live `build_state.giga_usf.json` over it,
 * then re-sanitise ITS `target` field to match whatever the main reference's `target` was just
 * sanitised to. `sha256`/`bytes` are not re-verified here - the invariant that checks a sidecar's
 * bytes against its hash (`sidecarContract.ts`) only ever runs against the live pair in `docs/`,
 * never against this pair in `tests/fixtures/`.
 */
import gigaUsfSidecarFixture from '../fixtures/build_state.giga_usf.reference.json'

const FIXTURES: Record<string, unknown> = {
  'build_state.giga_usf.json': gigaUsfSidecarFixture,
}

export function loadSidecar(file: string): Promise<unknown> | null {
  if (!Object.hasOwn(FIXTURES, file)) return null
  return Promise.resolve(FIXTURES[file])
}
