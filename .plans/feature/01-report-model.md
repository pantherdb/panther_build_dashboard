# Task: Derived build-report model, schema contract, and fixture transforms

**Status:** ACTIVE
**Issue:** [docs/panther-build-dashboard-prototype-brief-v3.md](../../docs/panther-build-dashboard-prototype-brief-v3.md) — "Derived Checks Layer", "Phase Timeline and Timing Model", "Phase-to-Report Binding", "Schema Version and Unknown Values", "Prototype Fixture Strategy", "Metric Definitions Registry"
**Branch:** main (no feature branches yet)

## Goal

Turn `docs/build_state.json` into a derived build model that every view reads, so no component ever
touches the raw JSON. "Done" means: `raw build JSON → derived build model → UI` is real, the model is
pure and total, unknown schema versions and unknown enum values degrade visibly instead of being
coerced, and the application states the brief asks for are produced by deterministic transforms of
the real fixture rather than hand-authored JSON files.

This plan owns the data substrate only. It ships no UI. It is the dependency of every other plan, and
it is the single place the verified data facts (see the Appendix) are recorded.

## Context

- **Related files (to create):**
  - `src/features/build/model/types.ts` — the domain model
  - `src/features/build/model/parse.ts` — `parseBuildState(raw: unknown): BuildReport`
  - `src/features/build/model/sections/*.ts` — one extractor per section family
  - `src/features/build/model/schema.ts` — schema-version support contract
  - `src/features/build/model/timing.ts` — the dual timing model
  - `src/features/build/model/binding.ts` — `sectionId → phaseId` registry
  - `src/features/build/model/definitions.ts` — metric definitions registry
  - `src/features/build/model/anchors.ts` — deep-link anchor/route builders
  - `src/features/build/fixtures/source.ts` — the static import of `docs/build_state.json`
  - `src/features/build/fixtures/transforms.ts` — the deterministic state transforms
  - `src/features/build/fixtures/index.ts` — the named state catalog
- **Reads:** `docs/build_state.json` (static import; the data is static and there is no fetch layer)
- **Triggered by:** the v3 brief. Supersedes an earlier v1-based approach that pre-generated four
  fixture JSON files — see Failed Approaches.

## Current State

- What works now: nothing. The repo is a bare template (React 19 / Vite / Mantine / Tailwind / RTK)
  that boots to a placeholder route. `docs/build_state.json` is committed.
- What's broken/missing: everything in this plan.

## Steps

### Phase 1: Domain model and section extractors

- [ ] Define the domain model in `types.ts`: build identity, health, pipeline (phases → steps →
      attempts), mapping, node tracking, library, trees, comparison, provenance, checks, report
      registry entries.
- [ ] Make absence a first-class value. Every sub-summary carries an `Availability` —
      one of `available`, `partial`, `absent`, `error`, `unknown` — plus the generator's own
      `message`. Sub-summaries are always objects, never `null`, so no view null-checks a summary.
      **Never render a zero where a measurement is absent.**
- [ ] Write one extractor per section family, each wrapped so a malformed section degrades that part
      only and appends to `ingestNotes`.
- [ ] `parseBuildState` must be pure and total: no `Date.now()`, no `Math.random()`, no argless
      `new Date()`, and it must not throw on `null`, `{}`, `{sections: 'nope'}`, a section whose
      `data` is a string, or sections in reversed order.

### Phase 2: Frontier and holes

- [ ] Compute `frontierIndex` = the highest phase index with any completed step.
- [ ] Derive phase status as `complete | active | hole | pending | blocked`, where `hole` is a phase
      behind the frontier that never finished. **A hole is not where the build stopped** — the model
      must make that distinction structurally, not by wording in a component.
- [ ] Expose `holes[]` separately from the frontier so the UI can present them as different
      conditions rather than two shades of "incomplete".

### Phase 3: Dual timing model (`timing.ts`)

- [ ] Keep **declared pipeline order** (for the step list and spine) and **artifact time order** (for
      the inferred timeline) as two separate orderings. Never reorder one to satisfy the other.
- [ ] Every timing value carries a provenance of `measured | inferred | unavailable`. `measured` reads
      optional `started_at` / `ended_at` / `job_id` fields — absent in this fixture, supported from
      day one so Slurm timing can take precedence later without a UI change.
- [ ] Clamp elapsed intervals at zero. **Never emit a negative interval** — the fixture has 2
      out-of-order completed steps and naive subtraction produces one.
- [ ] Flag tightly clustered artifact times as _potentially concurrent_ rather than sequential.
- [ ] Label inferred spans as artifact activity, e.g. `≈ 2.9h elapsed`, never as measured runtime.

### Phase 4: Report freshness

- [ ] Compare report `generated_at` against the newest artifact mtime to yield one of
      `current`, `potentially-stale`, `unknown`. This fixture is **Current** by 73.7 h, which is
      positive evidence and should read as such.

### Phase 5: Schema contract and unknown values (`schema.ts`)

- [ ] Declare the supported `schema_version` set explicitly. A newer or unrecognised version renders
      a visible degradation notice; it does not silently proceed and does not refuse to render.
- [ ] Never discard unknown fields or sections — preserve them for the generic renderer.
- [ ] An unknown section `status` renders as `Unknown status: <value>` with the literal value kept
      visible. **Do not coerce it into a known state.** Same rule for any unfamiliar enum.

### Phase 6: Phase-to-report binding (`binding.ts`)

- [ ] Registry mapping `sectionId → phaseId`, supporting many sections per phase and one section
      contributing to more than one view.
- [ ] Unmapped and unknown sections collect under an **Unattached reports** node at the end of the
      spine — surfaced, never hidden.
- [ ] Read an optional per-section phase hint if present, so the binding can become data-driven
      later without a model change.

### Phase 7: Metric definitions registry (`definitions.ts`)

- [ ] One registry of user-facing metric labels + short explanations, consumed identically by
      summaries, charts, tables, tooltips, exports and checks.
- [ ] It must disambiguate the **six** distinct sequence counts in this fixture (Appendix A.4). No
      screen may label a bare number "Sequences".

### Phase 8: Anchors (`anchors.ts`)

- [ ] Stable deep-link anchor + route builders for phase, step, report, check, species, config key and
      metric. Nothing outside this module hand-writes an anchor, so links and DOM ids cannot drift.

### Phase 9: Fixture transforms (`transforms.ts`)

- [ ] Deterministic, pure `BuildState → BuildState` transforms composed over the real fixture:
      `toCompleted()`, `toEarly()`, `toFailed()`, `toWarning()`, `stripSection(id)`, `toTruncated()`,
      `toStale()`, `withUnknownSection()`, `withUnknownStatus()`, `withFutureSchema()`.
- [ ] `toFailed()` must populate attempt history (status, timestamps, job id, log reference) because
      the real fixture has none and the failure UI would otherwise be untested.
- [ ] `toCompleted()` must recompute per-phase `done`/`total` and the headline counters from the step
      statuses it rewrites — see Failed Approaches; getting this wrong makes the frontier derivation
      nonsense.
- [ ] Every transform is composable and named in the catalog, so a state is a recipe over real data
      rather than a separate file that can drift.

### Phase 10: Unit tests

- [ ] `parseBuildState` arithmetic against independently computed expectations (Appendix A).
- [ ] Totality: the malformed inputs listed in Phase 1.
- [ ] Determinism: same input parsed twice is deeply equal; every transform is idempotent in the
      sense that composing it twice equals composing it once where that is the intent.
- [ ] Every transform produces a self-consistent state (phase counters agree with step statuses;
      completed steps have an mtime and incomplete ones do not).

## Recovery Checkpoint

> **⚠ UPDATE THIS AFTER EVERY CHANGE**

- **Last completed action:** plan written; data facts verified against `docs/build_state.json` and
  recorded in the Appendix. No model code exists yet.
- **Next immediate action:** Phase 1 — write `types.ts`, starting from the section inventory in
  Appendix A.1.
- **Recent commands run:**
  - `python` ad-hoc inspection of `docs/build_state.json` (facts in the Appendix)
- **Uncommitted changes:** none — working tree clean at the template commit.
- **Environment state:** `node_modules` installed; dev server not running; nothing to tear down.

## Failed Approaches

<!-- Prevent repeating mistakes after context reset -->

| What was tried                                                                | Why it failed                                                                                                                                                                                                                                                                                                                                   | Date       |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Pre-generating four standalone fixture JSON files with a build script         | v3 explicitly rejects hand-authored parallel fixtures in favour of deterministic transforms over the real JSON. Separate files also drift from the real schema, and the generator silently emitted a state the real generator never would (phases reading 3/5 while all five steps said `done`) because per-phase counters were not recomputed. | 2026-08-27 |
| Trusting the report's own `pct_change` column in the species comparison table | It stores a fraction (`-1.0` for a complete removal), not a percentage. Formatting it directly yields a −1 % bar where −100 % belongs. Recompute from the counts.                                                                                                                                                                               | 2026-08-27 |
| Rename detection with a 10 % count tolerance                                  | Produces 7 candidate pairs on this fixture of which 5 are nonsense (it pairs `CITSI`/`ERYGU`/`AMBTC` with `DAPMA`). Only exact-count matches are defensible — see `05-species-cross-section`.                                                                                                                                                   | 2026-08-27 |

## Files Modified

| File | Action | Status |
| ---- | ------ | ------ |
|      |        |        |

## Blockers

- None currently.

## Notes

- **The data is static.** `docs/build_state.json` is imported directly (`resolveJsonModule` is on).
  There is no fetch, no RTK Query endpoint, no loading state. `useBuildReport()` is the only seam a
  future API needs to replace, with `parseBuildState` staying in front of it.
- Parsing is memoised per state recipe, not per render. A module-level cache keyed by the transform
  chain is sufficient and keeps the model pure.
- The brief lists "extension" as an assignment mechanism. **It is not one in this data** — see
  Appendix A.5. Model mechanisms from what the JSON contains, not from the brief's prose.
- `ragged_rows` is a **count, not a boolean** (Appendix A.6). Typing it as `boolean` compiles and then
  silently reads `813` as truthy, which happens to work and will break the day it is `0` vs `false`.

## Lessons Learned

- Verifying the brief's factual claims against the fixture before planning found two things the brief
  does not mention (a second exact rename pair, and the false-positive rate of loose rename matching)
  and one place where the brief and the data disagree (mechanisms). Do this first, every time.

## Additional Context (Claude)

Open questions to resolve while implementing, not before:

- Where should the derived checks live — in this model, or in a layer above it? Current intent:
  the checks layer (`04-derived-checks`) is a separate pure module that _consumes_ `BuildReport` and
  returns `Check[]`, so a check can be added without touching the parser. The model should expose the
  joined facts checks need (e.g. per-species records already merged across sections) rather than
  making each check re-join them.
- Species records are needed by node tracking, the comparison and the UniProt match table. Building a
  single `species: Map<oscode, SpeciesRecord>` in the model — joining all three sources plus
  derived rename/new-species flags — is probably right, and is what makes
  `05-species-cross-section` cheap. Decide in Phase 1.

---

## Appendix A — Verified data facts

Measured from the frozen oracle, `tests/fixtures/build_state.reference.json` — a 9-section report
from `target_2026_02_w_select_2026_01_rerun`, **recomputed 2026-09-08**. **These are the reference
values for the whole prototype**; other plans link here rather than restating them. Every figure
below was derived from the JSON directly, not read out of a test failure.

**Re-verify only when the REFERENCE is replaced, which is a deliberate act.** These numbers are
deliberately *not* measured from `docs/build_state.json`: that file is live production data and is
refreshed on every build (a `test.alias` in `vite.config.ts` points the tests at the reference
instead). Refreshing the live report does not invalidate anything here. What guards the live file is
`tests/features/build/model/liveReport.contract.test.ts`, which asserts invariants and no numbers.

### A.1 Shape

`schema_version: 1` · `target: "target_2026_02_w_select_2026_01_rerun"` (sanitised in the
reference; the live report carries the absolute `/scratch2/...` path)
· `generated_at: 2026-09-08T17:40:14Z` · **9 sections**.

| Section id      | Status     | Notes                                                            |
| --------------- | ---------- | ---------------------------------------------------------------- |
| `config_ledger` | ok         | resolved values + captured `config.mk` contents + 11 ledger rows |
| `proteomes`     | ok         | **new in this fixture** — 11 metrics, 2 tables (131 + 15 rows), 3 warnings |
| `progress`      | ok         | 14 phases, 62 steps, 59 done                                     |
| `mapping`       | ok         | 14 stages, 45 `by_mechanism` rows                                |
| `node_tracking` | ok         | 5 node types, 131 species                                        |
| `library`       | ok         | genomes/sequences/families/subfamilies                           |
| `prev_lib`      | **absent** | message: `inputs not present yet`                                |
| `giga`          | ok         | 15,795 books, 0 empty trees                                      |
| `other_reports` | ok         | 12 metrics + 3 tables, **all three truncated**                   |

`proteomes` sits at index 1, between `config_ledger` and `progress`. Its first table carries
per-proteome provenance (`up`, `oscode`, `taxid`, `name`, `source`, `version`, `prev_*`, `change`);
its metric rows include `proteomes_total: 131`, `QfO 2026_02: 67`, `RefProt 2026_01: 24`.

No step in the real fixture has a populated `attempts` array, and step statuses are only `done` and
`pending`.

### A.2 Frontier and holes

**The frontier moved with this fixture.**

- Frontier = phase index **13, Final packaging at 1/2**; pending step `PANTHER20.0.tar.gz.touch`.
  Phase 12 (Library export products) is now **12/12 complete**.
- Hole = phase index 2, **Sequence-to-family mapping at 3/5** — `validate_idmapping_step` and
  `validate_blast_step` pending, while **11** later phases completed. Any model that calls the
  earliest incomplete phase "where the build stopped" is wrong.
- Phase status counts: **12 complete, 1 active (frontier), 1 hole, 0 pending**. No phase has zero
  progress.

### A.3 Timing and freshness

- Oldest artifact `2026-09-03T23:02:07Z` (`organism.dat`); newest `2026-09-05T05:22:23Z`
  (`PTHR20.0_DBload.tar.gz`) — ≈ **30.3 h** of activity.
- Report generated `2026-09-08T17:40:14Z` → **84.3 h after the newest artifact.**
- The artifact-order timeline holds **59** entries, one per done step.
- **2** out-of-order completed steps in declared order: `organism.dat` before
  `download_resources.touch`, and `ftp/…/PANTHER20.0_HMM_classifications` before `QfO_OrthoXML.xml`.
  The second is the subject of the generator's own stale-artifact warning.
- `config_ledger.current.generated_at` (`2026-09-03T23:07:21Z`) equals the mtime of
  `download_resources.touch`: the config snapshot is taken at **build start**, not at report time.

### A.4 The six sequence counts — the terminology problem

| Value     | Concept                                                                                          |
| --------- | ------------------------------------------------------------------------------------------------ |
| 2,692,827 | previous-library reference/input sequences (`prev_lib_sequences`)                                |
| 2,298,433 | current reference-proteome input sequences (`new_lib_sequences`, = mapping stage 1 `total_seqs`) |
| 2,292,530 | sequences surviving to the final mapping stage (`post_giga.total_seqs`)                          |
| 1,813,607 | sequences **assigned** to a family at the final stage                                            |
| 1,742,145 | sequences represented in the **built library**                                                   |
| 1,614,152 | LEAF nodes mapped forward                                                                        |

Labelling any of these simply "Sequences" is a defect. Note that library sequences (1,742,145) now
equals the LEAF node **total** — that coincidence is the subject of A.7's agreement check, and does
not reduce the six labels to five concepts.

### A.5 Mapping

14 stages, `id` → `post_giga`. Assignment **65.6 % → 79.1 %** (**+13.5 pp**). Families 15,682 →
**15,795**.

Distinct mechanisms are **four**: `ID`, `BLAST`, `HMM_scoring`, `RECLUSTER_NEW`. `by_mechanism`
rows are `{stage, mechanism, count}` and are **cumulative totals at that stage**, not per-stage
increments. Stage 1 (`id`) is the baseline, so deltas begin at stage 2 — which is why the largest
gain is `hmm` and not `id`'s +1,507,603 first appearance.

| Stage                 | Mechanism delta                                  |
| --------------------- | ------------------------------------------------ |
| `blast`               | BLAST +100,538                                   |
| `fams_corrected`      | BLAST −52 · ID −347                              |
| `hmm`                 | HMM_scoring +197,108 (largest single gain)       |
| `recluster`           | RECLUSTER_NEW +2,823                             |
| `pass1_trim`          | HMM_scoring −4,259 (largest single loss)         |
| `pass1_dedup`         | BLAST −3 · HMM_scoring −818 · ID −25 (−846)      |
| `pass1_single_genome` | BLAST −3 · HMM_scoring −17 · ID −365             |
| `exten`               | HMM_scoring **+11,760**                          |
| `pass2_trim`          | HMM_scoring −5                                   |
| `post_giga`           | HMM_scoring −230 · ID −44 · RECLUSTER_NEW −57    |

**"Extension" is a stage, not a mechanism** — its gain is booked to `HMM_scoring`. The brief's
mechanism list says otherwise; the data wins.

### A.6 Node forward tracking

Overall **2,810,967 / 3,031,716 = 92.7 %**. 131 species reported.

| Node type      | Mapped / total        | %       |
| -------------- | --------------------- | ------- |
| SPECIATION     | 914,535 / 958,465     | 95.4    |
| LEAF           | 1,614,152 / 1,742,145 | 92.7    |
| DUPLICATION    | 277,511 / 325,035     | 85.4    |
| HORIZ_TRANSFER | 4,769 / 5,724         | 83.3    |
| UNKNOWN        | 0 / 347               | **0.0** |

Species distribution is extremely tight at the top: median 99.5 %, MAD 0.4, **117** of 131 species
≥ 90 %. Low tail, ascending: `DAPMA` 0.0, **`IXOSC` 17.1**, `FELCA` 64.9, `PHANO` 65.0,
`CAEBR` 68.0, `POPTR` 68.1, `TOBAC` 73.8, `SPIOL` 77.3, `BOVIN` 80.0, `GOSHI` 80.1, `MANES` 80.6,
`DANRE` 84.5. Exactly **1** species at 0 %. `IXOSC` at 17.1 % is new to the tail and is now the
second-lowest by a wide margin.

`species_reported` 131 = `library.genomes` 131 = `prev_uniprot_proteomes` 131, but
`other_reports.species_total` is **147** — a different denominator, not a contradiction.

### A.7 Expected passing checks

Positive evidence the checks layer should surface, not just failures:

- **Leaf/library agreement:** LEAF total 1,742,145 **==** library sequences 1,742,145, exact.
- **Four-way family agreement at 15,795:** `post_giga.n_families` == `library.families` ==
  `giga.books_total` == `giga.trees_built` == `giga.trees_succeeded`. (`recluster` is **15,834**
  — 39 higher, expected, because trimming runs after reclustering.)
- **Trees:** 15,795 of 15,795 books have a usable tree; **0 empty**.
- **`unresolved_vars: []`** — nothing unresolved in the config ledger.

### A.8 Config tiers

**This tier changed structurally, not numerically.** `QFO_RELEASE_VERSION` was retired upstream
(`panther_build/.specs/2026-08-27-proteome-version-provenance-design.md` §8) and has **0
occurrences** in this fixture. Independently, `QFO_DATA_DIR` now points at
`QfO_release_2026_02/…` rather than `ref_prot_2026_01/…`, so even the *values* no longer disagree.
The old "QfO release vs data dir" mismatch therefore has neither an input nor a condition to
report, and the per-proteome release data lives in the `proteomes` section instead — see
`checks/model/rules/configQfo.ts`, rewritten against that section.

- **Mismatch tier:** no QfO finding. **`panther_build_dirty: true`** remains.
- **Notable (visible, not a warning):** `PC_CLASS`/`PC_RELATIONSHIP` inheritance, `MAFFT_BINARIES`
  declared but empty, and the `PREV_*` inputs — re-read the literal values from
  `config_ledger.current` before asserting them; the key set is generated_at,
  panther_build_git_rev, panther_build_dirty, config_file, config_file_contents, PTHR_VERSION,
  QFO_DATA_DIR, SPECIES_TREE, PREV_RELEASE_DIR, PREV_NODE_DAT, PREV_RP_TAX_TXT, unresolved_vars.
- **Lineage (positive, display-only):** unchanged in shape; re-derive the counts from the ledger
  rows rather than trusting the previous "19 PREV_* / 2 PREV_PREV_*" figures.
- Source revision is `panther_build_git_rev`, now **`08e5f710…`**.

### A.9 Species changes and renames

The species table holds **50 of 147** rows. Within those 50: **16 removals** (`new_count` 0) and
**3 additions** (`prev_count` 0) — the same counts as before, different membership.

Removals: `BRANA` 57,383 · `SOLTU` 38,894 · `EUCGR` 36,474 · `SETIT` 35,379 · `CAPAN` 35,139 ·
`MUSAM` 34,845 · `SELML` 33,117 · `RICCO` 31,154 · `DAPPU` 30,118 · `CITSI` 27,934 · `ERYGU` 27,425
· `AMBTC` 27,327 · `CUCSA` 23,726 · `ZOSMR` 20,338 · `USTMA` 6,788 · `CRYNJ` 6,604.
Additions: `DAPMA` 26,600 · `MYCMD` 6,788 · `CRYD1` 6,603.

**Exact-count rename pairs — there is now exactly ONE:**

| Removed | Added   | Counts                          |
| ------- | ------- | ------------------------------- |
| `USTMA` | `MYCMD` | 6,788 → 0 and 0 → 6,788 (exact) |

`CRYNJ` → `CRYD1` was an exact pair in the previous fixture (6,604 → 6,604). It is now **6,604 →
6,603, off by one**, so it no longer qualifies as an exact-count rename. Any assertion of "the two
exact-count rename pairs" becomes one; that is a change in the data, not a loosened test.

**A likely replacement at lower confidence:** `DAPPU` 30,118 → 0 with `DAPMA` 0 → 26,600 — same
genus, 12 % apart, so a replacement rather than a rename.

**`DAPMA` is new in this build**, corroborated twice: `prev_count` 0 in the species table, and its
node forward tracking is 0 %. The `proteomes` section adds a third corroboration and one caution:
its own warning records `UP000000561 (USTMA/237631 → MYCMD/5270)` as a taxID re-identification
carrying the same UP number on both sides — "the species was re-identified under a new taxID, not
replaced", so it must not be read as library churn.

### A.10 Truncation

Every table in `other_reports` is truncated:

| Table                                       | Rows          | `ragged_rows` |
| ------------------------------------------- | ------------- | ------------- |
| Sequence counts by species, previous vs new | **50 of 147** | 0             |
| Previous-UniProt-ID match by proteome       | **20 of 132** | 0             |
| UniRules gaining in more than one family    | **20 of 808** | **808**       |

`ragged_rows` is a **count, not a boolean**. Client-side sort/filter over any of these would imply a
completeness the report does not have — see `06-results-and-comparison`.
