# Load the giga_usf family data lazily from its sidecar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Status:** ACTIVE · **Branch:** giga-usf-dashboard

**Goal:** The Unplaced fragments view reads its family table and long IDs from
`docs/build_state.giga_usf.json`, loaded only when the view mounts, so the main bundle doesn't
carry ~6 MB of per-family data. The main report keeps only the headline, species table and a
`sidecar` reference.

**Companion (read first for the contract):**
`panther_build/.plans/2026-09-22-giga-usf-sidecar.md`. Sizes measured 2026-09-22: 9,299
families, 69,908 IDs. The user chose the sidecar design.

## Contract (from the pipeline plan)
- Main report, `giga_usf.data`: headline (books_scanned, families_with_unplaced, unplaced_total,
  unassigned_in_mapping), table "Unplaced fragments by species", definitions, warnings, and
  `sidecar: {file: "build_state.giga_usf.json", bytes, sha256}`. There is no family table, no
  `unplaced_members` and no members_* headline keys any more.
- Sidecar file `docs/build_state.giga_usf.json`:
  `{schema_version: 1, target, generated_at, section_id: "giga_usf", data: {families: [{family,
  unplaced, tree_leaves, unplaced_fraction, members: string[]}]}}`, compact JSON.

## Global Constraints
- The main report stays a static import. Sidecars are **lazily** loaded: a separate chunk, fetched
  only when the view needs it. Use Vite's `import.meta.glob('/docs/build_state.*.json',
  { import: 'default' })` (lazy by default), so a missing sidecar file is a missing key, not a
  build error. Verify the glob path form against this project's Vite root before relying on it.
- Under Vitest, sidecars must not come from live `docs/`: tests use a frozen fixture sidecar
  under `tests/fixtures/`, just as the main report does (see `vite.config.ts` `test.alias` and
  `fixtures/source.ts`). Pick whichever of alias, injected loader or module mock fits the existing
  pattern, and say why.
- A sidecar is trusted only if its `target` and `generated_at` equal the main report's, and its
  `section_id` matches. Otherwise the view says the sidecar belongs to a different report and
  shows no families. `parseBuildState`-style defensive parsing: `unknown` in, typed out, never throw.
- States the view must distinguish, each with honest copy:
  loading · ready · not referenced (an older report: fall back to the old in-report
  `unplaced_members`/family table if present, so the current frozen fixture and the old live
  file still work) · referenced but not shipped (file missing from docs/: "copy
  build_state.giga_usf.json alongside build_state.json") · mismatched (a different report) · failed to parse.
- Everything else about the view (filter by family/oscode/accession, member table, UniProt links,
  copy, the mapping line, the giga family-list disclosures, the partial-availability logic) keeps
  working. Once the sidecar is complete, the `members === null` truncation paths are simply never
  hit; keep them for the old-report fallback.
- Species cross-section (`bySpecies`) stays sourced from the main report and must not wait on
  the sidecar.
- `liveReport.contract.test.ts`: add an invariant. If the live report references a sidecar, the
  file exists in `docs/`, parses, and matches target/generated_at/section_id (and bytes; sha256
  if cheap via node:crypto). That is what enforces copying both files. A red contract suite
  means copy the sidecar, never "add an exception".
- Never hand-edit `docs/build_state.json` or the reference fixture. A new frozen sidecar test
  fixture is fine (it is test data you author, consistent with the `gigaUsf` fixture state).
- Typed Redux hooks only; `import type`; Prettier. No commits; `git add` only.

## Tasks

### Task 1: Sidecar loading + model
- [ ] A typed loader module (e.g. `src/features/build/fixtures/sidecars.ts`, next to
  `source.ts`) exposing `loadSidecar(file: string): Promise<unknown> | null` (null = not shipped),
  plus the test-time substitution.
- [ ] `parseUsfSidecar(raw: unknown, report: BuildReport): {status, families: UnplacedFamilyRow[]}`,
  reusing gigaUsf.ts's row parsing: `Object.hasOwn`, null semantics, family-id sort already done
  upstream.
- [ ] Extend the main-report extractor: read `data.sidecar` into
  `UnplacedFragmentsSummary.sidecar: {file, bytes, sha256} | null`. Keep the old in-report path
  for reports without it.
- [ ] A hook `useUnplacedFamilies(report)` returning `{status, families}`, with the loading
  state. It is cancellation-safe on unmount.
- [ ] Update the `gigaUsf` fixture state to the new contract (main report with a sidecar
  reference, plus a frozen fixture sidecar file), and keep a second fixture state or test path
  for the old in-report shape.
- [ ] Tests for every status above.

### Task 2: View + contract test
- [ ] `UnplacedFragmentsReport.tsx` uses the hook. Loading shows a skeleton/"Loading families…".
  Each non-ready status shows its copy, and the headline/mapping line/species-driven parts render
  immediately.
- [ ] Update the view tests (async `findBy…` for loaded content), plus one test per non-ready status.
- [ ] Add the live contract invariant. Confirm `npm run build` emits the sidecar as its own chunk
  when a `docs/build_state.giga_usf.json` exists: create a temporary one in a scratch copy, or
  reason from Vite's output with a tiny dummy you delete afterwards. Never commit or leave a fake
  file in docs/. Report the main-bundle size before and after.
- [ ] Update `panther_build_dashboard/CLAUDE.md` "The two reports" section: the sidecar, and that
  refreshing copies both files.
