/**
 * The one static import of the real build report.
 *
 * The data is static: there is no fetch layer, no loading state and no backend. `docs/build_state.json`
 * sits outside `src/`, but a relative import resolves under both `tsconfig.app.json`
 * (`resolveJsonModule` is on, and an imported file joins the program even when it is outside
 * `include`) and the Vite config (`docs/` is inside the project root, so it is within the dev
 * server's allowed filesystem scope). No alias and no copy of the JSON into `src/` is needed.
 *
 * It is typed as `unknown` deliberately. `parseBuildState` accepts `unknown` and is the only thing
 * that decides what the payload is, so nothing downstream can accidentally trust the JSON's
 * inferred literal type as though it were validated.
 *
 * UNDER VITEST THIS IMPORT DOES NOT READ `docs/build_state.json`. A `test.alias` in
 * `vite.config.ts` redirects it to the frozen `tests/fixtures/build_state.reference.json`, because
 * `docs/build_state.json` is live production data that is regenerated on every build while the
 * tests pin numbers computed by hand from one report. Production is unaffected. A test that needs
 * the live file reads it with `fs` - see `tests/features/build/model/liveReport.contract.test.ts`.
 */

import rawBuildState from '../../../../docs/build_state.json'
import type { BuildState } from '../model/types'

/** Where the fixture came from, for the provenance line in exports. */
export const BUILD_STATE_SOURCE_PATH = 'docs/build_state.json'

/**
 * The captured PANTHER 20.0 build report, standing in for what a report generator will emit.
 * Frozen at the module boundary so no transform can mutate the shared source by accident.
 */
export const buildStateSource: BuildState = rawBuildState as BuildState
