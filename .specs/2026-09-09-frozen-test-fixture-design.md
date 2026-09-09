# A Frozen Test Fixture, Separate From The Live Report

Design for letting `docs/build_state.json` change on every build without rewriting the
test suite each time.

## Problem

`docs/build_state.json` currently does two incompatible jobs.

It is **production data**: `src/features/build/fixtures/source.ts:15` imports it directly,
so it is compiled into the bundle and shipped by `.github/workflows/deploy-pages.yml` on
every push to `main`. Now that the hosted site is fed from the committed JSON, this file is
expected to change often.

It is also **the test oracle**. `tests/features/build/model/parse.appendix.test.ts` is 565
lines of arithmetic computed by hand from that exact file — section counts, 131 species, 62
steps, 15,795 books, the absolute target string. Dozens of other specs assert numbers
derived from it. 32 test files import it directly through
`src/features/build/fixtures`; more reach it transitively through the store and
`useBuildReport`.

So every data refresh is also a test-suite rewrite. That is what
`update-test-assert-data` was: commit `bd90fb3 "Adjust test stats to new data"` touched 43
files. Worse, it *hid real work inside the churn* — that same commit deleted
`src/features/checks/model/rules/configQfo.ts`, added
`src/features/checks/model/rules/proteomeMajorityRelease.ts`, and changed
`SpeciesChanges.tsx`. Genuine behaviour changes were indistinguishable from mechanical
number-bumping in a 43-file diff.

The cost is not only labour. A suite that goes 176-red on every data refresh trains the
reader to treat red as noise, which is precisely when a real regression walks through.

## Goals

1. Copying a new `build_state.json` into `docs/` and pushing changes **zero test
   expectations**.
2. The hand-computed numbers in Appendix A stay valid indefinitely, without recomputation.
3. A generator change that the dashboard cannot handle — a new section id, an unsupported
   schema version, a shape the parser degrades on — still **fails the suite loudly**.
4. Existing tests are not edited. A 32-file mechanical diff is itself a source of error.
5. The distinction between "data changed" and "behaviour changed" is visible in `git log`.

## Non-goals

- **Serving the report at runtime.** `docs/build_state.json` stays a compile-time import.
  Fetching it would add the loading and error states `hooks.ts:29` was explicitly designed
  without. Recorded as a follow-up.
- **A curated, smaller fixture.** Hand-building a trimmed report that covers the edge cases
  deliberately would be a better oracle in principle, but every one of the 565 lines of
  Appendix A arithmetic would have to be recomputed from scratch — exactly the cost this
  design exists to avoid paying twice. Possible later, on top of this.
- **Pinning any number against the live report.** Chosen deliberately: see Design §3. The
  live file gets invariants only.
- **Snapshot testing the live report.** `vitest -u` would make refreshes cheap by
  rubber-stamping whatever changed, destroying the oracle property the appendix test
  exists to provide.
- **Re-computing Appendix A's numbers.** They are correct as of `bd90fb3` and this design
  freezes the file they describe, so they stay correct. Appendix A is still edited, but only
  to repoint it at the reference file and carry the sanitised target — no arithmetic is
  redone.

## Current state — verified 2026-09-09

On `main` at `4eea252`:

- **Baseline suite: 52 files, 750 tests, all passing, 18.7s** (`npx vitest run`). This is
  the number the change must reproduce exactly.
- **One import feeds everything.** `source.ts:15` —
  `import rawBuildState from '../../../../docs/build_state.json'` — is the only path from
  the JSON into the app. It is typed `unknown` and cast, so nothing downstream trusts an
  inferred literal type.
- **`BUILD_STATE_SOURCE_PATH` has no consumer.** Exported from `source.ts:19` and
  re-exported from `fixtures/index.ts`, but `grep` finds no use outside `fixtures/`. The
  provenance string needs no rework.
- **The fixture states are recipes, not files.** `fixtures/index.ts` builds all 13 named
  states (`real`, `failed`, `stale`, `degraded`, …) by applying `transforms.ts` to
  `buildStateSource`. Redirecting the one source redirects every state at once.
- **The file is small.** 145,713 bytes; 18,024 gzipped. A second committed copy costs
  nothing.
- **`/scratch2/debert/...` appears exactly once in the JSON** (the `target` field) and in
  three places in the repo: `parse.appendix.test.ts:21`,
  `BuildPreamble.test.tsx:19`, `.plans/feature/01-report-model.md:214`.
- **`proteomes` is integrated.** It is in `KNOWN_SECTION_IDS`
  (`src/features/build/model/parse.ts:75`), so the drift recorded in the workspace
  `CLAUDE.md` is resolved and a "every section id is known" check passes today.
- **The alias mechanism works.** Verified by throwaway probe (since removed): a Vitest
  `test.alias` entry does redirect the `source.ts` import, and `buildStateSource.target`
  reads from the replacement file. See Risks for the anchoring gotcha the probe exposed.

## Design

### 1. Two files, two jobs

| File | Job | Cadence |
| --- | --- | --- |
| `docs/build_state.json` | Production data — compiled into the bundle, shipped to Pages | Every build |
| `tests/fixtures/build_state.reference.json` | The oracle — the frozen 2026-09-08 nine-section report | Never, except by deliberate re-verification |

The reference is a byte-for-byte copy of today's `docs/build_state.json` with one edit: the
`target` field becomes `target_2026_02_w_select_2026_01_rerun`, dropping the absolute
cluster path. Nothing else is touched, so every figure in Appendix A remains exactly
correct.

Sanitising costs four lines — the JSON field, the two test assertions above, and the
Appendix A.1 line. It is done because the reference is a *permanent* committed artifact in
a way the rotating live file is not, and a personal scratch path is not something to pin
forever. The live `docs/build_state.json` keeps its real absolute path; that is real
provenance and the site shows it.

### 2. Wiring: one config entry, no test edits

`vite.config.ts` gains an `alias` entry inside the existing `test` block (line 67):

```ts
test: {
  // docs/build_state.json is LIVE production data: regenerated every build and compiled
  // into the shipped bundle. Tests pin hand-computed numbers, so under Vitest every
  // import of it resolves to the frozen oracle instead.
  //
  // To assert against the LIVE file — the contract suite — read it with fs. This alias
  // rewrites import specifiers and will not catch an fs read.
  //
  // The pattern MUST be anchored with ^.*. Vite replaces only the matched portion of the
  // specifier, so an unanchored /docs\/build_state\.json$/ leaves the importer's
  // `../../../../` prefix in front of an absolute path and nothing resolves.
  alias: [
    {
      find: /^.*docs\/build_state\.json$/,
      replacement: path.resolve(__dirname, './tests/fixtures/build_state.reference.json'),
    },
  ],
  globals: true,
  // …unchanged
}
```

That is the entire wiring change.

- Nothing under `src/` changes, beyond one sentence added to the `source.ts` docblock
  pointing at the alias so a reader of that import is not misled.
- No test file changes. All 52 files, including the ones that reach the data transitively
  through the store, run against frozen data from the next `npm test` onward.
- Production is untouched: the alias lives under `test`, so `npm run build` and
  `npm run type-check` still compile the live JSON.

The trade-off accepted here is that the redirect is invisible at the import site. It is
mitigated by the comment above, a matching note in the `parse.appendix.test.ts` header, and
the Documentation section. It is not enforced by lint; if it turns out to catch someone
out, a `no-restricted-imports` rule is the escalation.

### 3. What still guards the live file

One new suite: `tests/features/build/model/liveReport.contract.test.ts`. It reads
`docs/build_state.json` with `fs.readFileSync` (bypassing the alias — `parse.totality.test.ts:1`
already establishes `node:fs` in a test as house style), parses it, and asserts invariants
only. No hand-computed number appears in this file.

| # | Assertion | What it catches |
| --- | --- | --- |
| 1 | Parses without throwing; all 15 summary keys are non-null objects | A payload the model cannot ingest at all |
| 2 | `report.schema.state === 'supported'` | The generator bumped `SCHEMA_VERSION` |
| 3 | Every section id is in `KNOWN_SECTION_IDS` | **A new collector the dashboard does not know** — the `proteomes` drift class |
| 4 | No section resolves to `unattached` placement | A known id that was never given a `SectionBinding` |
| 5 | No ingest note at `error` severity | A section the parser had to degrade |
| 6 | `pipeline.headlineConsistent`, and declared headline equals computed | The generator's own counters disagreeing with its steps |
| 7 | No `NaN` or `Infinity` anywhere in the derived model (deep scan) | A string where a number was expected, arithmetic on absent data |
| 8 | Every check rule returns a defined verdict | A rule like `proteomeMajorityRelease` choking on next month's shape |
| 9 | `identity.generatedAt` is a valid date and `freshness` is computable | A malformed or missing timestamp |
| 10 | `identity.target` is a non-empty string | An unsubstituted or empty target |

Assertion 3 is the load-bearing one. It is the check that would have caught `proteomes`
resolving to `{known: false, placement: 'unattached'}` the day the fixture was swapped,
instead of it being noticed by hand.

Reuse rather than reimplement: assertion 1 lifts the `SUMMARY_KEYS` list and the
`expectWellFormed` helper already in `parse.totality.test.ts:16`. If that means extracting
the helper to `tests/support/`, do that rather than copying it.

### 4. A render smoke test on live data — the one risky piece

Every component test now runs against the reference. Nothing renders the live report, and a
report can be shape-valid yet still crash a component.

So: one test — added to `liveReport.contract.test.ts` rather than a file of its own, so the
live-data assertions stay in one place — mounts the shell against the live report and asserts
no error boundary trips and no console error is emitted. `useBuildReport` (`hooks.ts:29`) reads
`getFixtureReport(key)` with no injection seam, so this is done by `vi.mock`-ing
`@/features/build/fixtures` to return a report parsed from the fs-read live JSON.

**This is the only part of the design with real implementation risk.** The fixtures module
is imported by four files under `src/` including `buildSlice.ts`, so the mock must supply
`DEFAULT_FIXTURE_STATE_KEY` and `FIXTURE_STATES` as well as `getFixtureReport`. If that
proves brittle, the item is dropped and reported as dropped — the hook is not to be
contorted to make a smoke test possible. Assertions 1–10 are the commitment; this one is
best-effort.

### 5. Files

**New**

- `tests/fixtures/build_state.reference.json` — the frozen oracle
- `tests/features/build/model/liveReport.contract.test.ts` — the invariant suite

**Changed**

- `vite.config.ts` — the `test.alias` entry
- `src/features/build/fixtures/source.ts` — one docblock sentence
- `tests/features/build/model/parse.appendix.test.ts` — the target assertion (line 21) and
  a header note that it reads the frozen reference
- `tests/features/preamble/BuildPreamble.test.tsx` — the target assertion (line 19)
- `.plans/feature/01-report-model.md` — Appendix A.1 target string, and a header line
  saying the appendix describes the frozen reference rather than `docs/build_state.json`
- `CLAUDE.md` (this repo) and `../CLAUDE.md` (the workspace) — see Documentation

## Documentation

Three places state the old rule and must state the new one.

**`panther_build_dashboard/CLAUDE.md`** — add the fixture rule: `docs/build_state.json` is
live data and free to change; `tests/fixtures/build_state.reference.json` is the oracle and
changes only by deliberate re-verification; the alias in `vite.config.ts` is what connects
them; to assert against live data, use the contract suite and read with `fs`.

**`pipeline_and_dashboard/CLAUDE.md`** (the workspace) — the section headed *"The fixture is
load-bearing — replacing it breaks ~176 tests by design"* is now wrong and is the most
misleading thing in the file. Rewrite it: step 2 of "Landing a report change across both
repos" (copy the JSON) no longer detonates the suite; what it can now trip is the contract
suite, and the fix for that is steps 3–4 (integrate the section), not loosening a test. Add
the re-verification ritual as the separate, rare act it now is.

**`.plans/feature/01-report-model.md`** — Appendix A's header currently says "Measured from
`docs/build_state.json` … Re-verify if the fixture is replaced." Change it to name
`tests/fixtures/build_state.reference.json` and say that replacing *that* file — not the
live one — is what triggers re-verification.

## Testing

The change is to test infrastructure, so the verification is behavioural, not a new unit
test.

1. **Baseline.** `npx vitest run` on `main` — recorded above as 52 files / 750 tests
   passing.
2. **No-op proof.** After adding the fixture and the alias, before adding the contract
   suite: `npx vitest run` must report **52 files / 750 tests passing**, identical. Any
   drift means the reference is not byte-identical to what the tests were written against,
   or the alias is catching something it should not.
3. **Sanitisation.** Then the two target assertions change and the count stays 750.
4. **Contract suite added.** File count 53, test count 750 + n, all passing.
5. **Deliberate perturbation — the real acceptance criterion.** Temporarily edit
   `docs/build_state.json`. (The workspace `CLAUDE.md` forbids hand-editing this file *to
   make a test pass*; this is the inverse — an edit made to prove a test fails, reverted
   immediately, never committed.) Change: (a) rename a section id to `pfam_coverage`, (b) set
   `schema_version` to `2`. Run the suite. **Only `liveReport.contract.test.ts` may go
   red**; all 52 pre-existing files must stay green. This is the single check that proves
   the two jobs are actually separated. Revert.
6. **Production untouched.** `npm run build` and `npm run type-check` both pass, and the
   emitted bundle still contains the live target string — proving the alias did not leak
   into the production build.

## Risks

**The anchoring gotcha.** Vite's regex alias replaces the matched portion of the import
specifier, not the whole specifier. `find: /docs\/build_state\.json$/` matches but leaves
`../../../../` in front of the absolute replacement, and the import fails with
"Failed to resolve import". This was hit and fixed during the feasibility probe; the
anchored `^.*` form is verified working. The comment in §2 records it so it is not
rediscovered.

**Silent divergence.** The reference stops resembling production data as builds move on. A
component could be built against a shape the generator no longer emits and no test would
notice. Assertions 3–8 are the guard, and they are shape-level, not exhaustive. Mitigation
is the follow-up below: re-freeze the reference deliberately, occasionally, as a chosen
task.

**The invisible redirect.** A reader of `parse.appendix.test.ts` sees numbers that do not
match `docs/build_state.json` on disk. Mitigated by comments in three places, not enforced.
Escalation is an ESLint `no-restricted-imports` rule.

**The contract suite as new churn.** If assertions 3–8 turn out to fail on ordinary data
variation, they become the very thing this design removes. Each one is written to assert an
*integration* property, never a data property; if one proves noisy in practice it should be
deleted rather than loosened, and the deletion noted.

## Verification

Done when:

- `npx vitest run` on the branch reports 52 pre-existing files green, unchanged, plus the
  new contract suite.
- The perturbation test in Testing §5 has been run and its result recorded — only the
  contract suite red.
- `npm run build` and `npm run type-check` pass.
- `git diff --stat` shows no changes under `src/` other than the `source.ts` docblock.
- The three documentation files state the new rule.
- The render smoke test (§4) is either passing or explicitly reported as dropped, with the
  reason.

## Follow-ups

- **Runtime fetch of the report.** This design removes the test cost of a data refresh but
  not the deploy cost: the JSON is compiled in, so every refresh is still a commit, a push
  and a Pages redeploy. If refreshes become frequent enough for that to bite, fetching
  `build_state.json` at runtime decouples data from releases entirely. It is a real change
  to the model layer — `hooks.ts` gains loading and error states — and is also recorded as a
  follow-up in `.specs/2026-09-08-static-hosting-design.md`.
- **Periodic deliberate re-freeze.** Schedule the re-verification ritual rather than letting
  the reference age indefinitely. It is the `update-test-assert-data` workflow, kept, but
  performed when chosen instead of whenever data arrives.
- **A curated edge-case fixture.** A second, small, hand-built reference covering shapes the
  real generator has not yet produced would let the extensibility tests stop synthesising
  sections inline. Only worth it once the numbers in Appendix A are no longer the expensive
  part.

---

## Outcome — implemented 2026-09-09

Landed as designed. Verification, in the order the Testing section prescribes:

| Step | Result |
| --- | --- |
| Baseline on `main` | 52 files / 750 tests passing |
| Verbatim reference + alias, before sanitising | 52 / 750 passing — **identical**, so the alias is a no-op for existing tests |
| Sanitise `target` in the reference | exactly 2 failures, both the assertions that pin the target — which is also the proof the alias is live and that nothing else reads that string |
| Assertions updated | back to 52 / 750 |
| Contract + render suites added | **54 files / 766 tests passing** |
| **Perturbation** (`schema_version: 2`, `giga` → `pfam_coverage`) | **3 failures, all in `liveReport.contract.test.ts`; all 52 pre-existing files stayed green.** Reverted; `git diff` on `docs/build_state.json` is empty |
| `npm run type-check`, `npm run lint`, `npm run build` | all clean; the bundle carries the live `/scratch2/...` target and no trace of the sanitised reference target |
| `git diff --stat -- src/` | one file, +6 lines — the `source.ts` docblock, as required |

### Where the implementation differed from the design

- **§3 assertion 4 was wrong as written.** "No section resolves to `unattached`" is right, but the
  draft also failed a section with empty `phaseIds`. That is legitimate for the two placements that
  are not phase-hung: `config_ledger` sits in the `preamble` and `progress` *is* the `pipeline`
  spine. Corrected to test `placement` alone.
- **The finding field is `label`, not `title`.** The `Check` contract in
  `src/features/build/model/types.ts:745` has `id / state / label / explanation / source / anchor /
  origin / evidence`. Assertion 8 checks `id`, `state`, `weight`, `label`, `explanation`, `anchor`.
- **§4 landed, and in its own file.** The design put the render smoke test inside the contract suite;
  it is `liveReport.render.test.tsx` instead, because it needs a module-level `vi.mock` that would
  otherwise apply to the contract assertions too. The `vi.mock` + `importActual` approach worked
  without touching `hooks.ts`; only `getFixtureReport` is overridden, and only for the default
  state, so the named demo states still mean what they meant. It asserts the rendered target equals
  the target read from the live file — computed, never written down — which is what proves the mock
  is serving live data rather than silently falling back.
- **`expectWellFormed` was extracted**, as the design allowed, to `tests/support/reportShape.ts`;
  `parse.totality.test.ts` now imports it.

### Not done

Nothing from the design was dropped.
