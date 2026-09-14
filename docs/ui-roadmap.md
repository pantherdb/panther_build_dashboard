# What this UI can be

Written 2026-08-30, from reading `panther_build` (the pipeline that produces the JSON) and
`panther-workspace` (the redesign SDLC effort). Everything marked **verified** was read out of those
repos; everything marked **inferred** is my reading and needs team confirmation.

---

## Where this project sits

`panther_build/.specs/2026-08-13-build-state-report-design.md` §11 lists as explicitly out of scope:

> **The web app** that consumes `build_state.json`. This design only guarantees the payload and its
> key stability.

**This repo is that web app.** The generator side is already built and merged — 39 commits on
`issue-64-build-state-report`, 185 tests. So the contract is not hypothetical, and neither side has
to guess at the other.

The producing chain, all **verified**:

```
$TARGET/reports/*.tsv          written by pipeline steps during the build
  → scripts/build_state.py     8 collectors, --write, --snapshot, --budget
      → $TARGET/reports/build_state/build_state.json   ← what we consume
                                  build_state.md       archival human copy
                                  build_state.tsv      spreadsheet headline rows
```

`make target/state` is the Makefile wrapper. The report is a snapshot of _now_, overwritten each
run; `--snapshot` additionally writes a timestamped `build_state_<UTC>.json`.

---

## What the generator emits today

**Verified** — `build_state_collectors/__init__.py` `REGISTRY`, in display order:

| id              | reads                                                                                              | our view                |
| --------------- | -------------------------------------------------------------------------------------------------- | ----------------------- |
| `config_ledger` | `reports/build_config.jsonl`                                                                       | preamble + config tiers |
| `progress`      | the target's own `scripts/make_all.slurm`, `logs/`, artifact mtimes                                | spine, frontier, holes  |
| `mapping`       | `reports/mapping_stats.tsv`, `..._by_mechanism.tsv`                                                | mapping progression     |
| `node_tracking` | `nodeForwardTracking/{speciation,duplication,horiz_transfer}/*`, `nodeMapping_stats_by_genome.tsv` | distribution + species  |
| `library`       | `DBload/node.dat`, `RP_taxonomy_organism_lib.txt`, `DBload/sfToPTN`                                | library contents        |
| `prev_lib`      | `reports/prev_lib_baseline.json`                                                                   | comparison              |
| `giga`          | `empty_trees.txt`, tree counts, retry dirs                                                         | tree building           |
| `other_reports` | an **allowlist** of four `reports/*.tsv`                                                           | tables                  |

Our eight sections match one-for-one. The generic renderer is not speculative: the collector
contract already promises `text` / `rows` / `tables` / `headline` / `warnings`, which is exactly what
our fallback renders.

**Verified, added 2026-09-11 — and the table above is now out of date by more than this one row.**
`panther_build`'s `REGISTRY` has grown past the 8 collectors this table lists from 2026-08-30
(`proteomes`, `msa`, `ibd_sf_roots`, `list_ht` and `orthologs` all landed since and are not rows
here either); this entry only adds `recluster`, not a re-audit of the rest.

| id          | reads                                                                                                                                                                                                                                                                                                                                                                           | our view            |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `recluster` | `refProteomePANTHERmapping_updateWithTribeMCLcluster.log` — a report despite the `.log` suffix (the collector's own docstring: the pipeline's Perl reopens STDERR onto it and writes a TSV record per cluster), plus organism counts from `tribeMCL/PANTHERSeqsForTribeMCL.final.clusters` and offered-sequence counts from `refProteomePANTHERmapping_unassigned_to_recluster` | new-family headline |

Reclustering is the step that creates new PANTHER families (TribeMCL clusters sequences that HMM
scoring left unassigned; each cluster either reclaims a previous-library family or is minted a new
one). The figures our `recluster` extractor (`src/features/build/model/sections/recluster.ts`)
reads straight off the section's `headline` — `families_created`, `sequences_in_new_families`,
`families_inherited`, `sequences_in_inherited_families`, `clusters_formed`, `sequences_offered`,
`new_family_id_min/max` — are **verified**: they pass through `asInteger`/`asNonEmptyString`
unmodified, no dashboard computation involved. The four-row "Cluster outcomes" table
(`new_family`, `inherited_family`, `single_organism`, `too_small`, matching the fixture in
`src/features/build/fixtures/transforms.ts`) is read the same way, by table `name` rather than
position so an inserted table upstream can't silently swap what the glance panel's bar draws from.

**Verified, added 2026-09-11 — some tooltip definitions are now generator-supplied, not curated
here.** `recluster`'s four outcome terms arrive in the section's own `data.definitions` and are
merged into the dashboard's definition registry by `generatorDefinitions()`
(`src/features/build/model/generatorDefinitions.ts`) under ids namespaced `section.term` — e.g.
`recluster.new_family` — so a generator id can extend the registry but never collide with or
displace a curated one (`src/features/build/model/definitions.ts`, whose ~40 hand-written ids carry
no dot). A reader tells them apart by the id shape alone. This moves who owns correctness: a wrong
curated definition is a fix in this repo; a wrong generator-supplied one is a fix in `panther_build`,
in the collector's own `DEFINITIONS` dict — not here.

**Verified, added 2026-09-11 — narrowed from the design's three lookup paths to one.** The pipeline
spec proposed a `definitions` map serving three lookups: `headline` keys, `rows[].metric` keys, and
cell values in a table column named by that table's `defines` field. Only the third was built. A
`defines` column's cells resolve through `generatorDefinitionId(sectionId, term)`
(`GenericTable.tsx`, and the "Assignment mechanism" and "Cluster outcomes" legends in
`GlanceCharts.tsx`, which call it directly rather than through a table). Headline values and
`rows[].metric` keys still resolve only against the curated registry
(`src/features/build/model/definitions.ts`) — a term that appears solely in a headline or a rows key
gets no tooltip, however it is spelled in `data.definitions`. Nothing in this change needs the other
two paths: every vocabulary `recluster`, `mapping`, `ibd_sf_roots` and `msa` define is a bucket
STRING that appears in a table cell, never a headline or rows key. Building them means reworking how
`GenericFields` resolves a field's `metricId`, which today reads the curated model map only — real
scope, deferred until a collector actually needs it.

**Verified, added 2026-09-12 — un-narrowed back to three lookup paths.** The headline and
`rows[].metric` paths the paragraph above found no consumer for are now built: `describeField`
(`src/features/reports/model/genericView.ts`) resolves a generator definition for a section's
`headline` values and `rows[].metric` keys the same way it already did for a `defines` column's
cells, and `GenericFigure` / `fieldLabel` (`src/features/reports/components/GenericFields.tsx`) both
check `field.metricId` (curated) before `field.definitionId` (generator) before falling back to the
report's own raw key — curated wins outright, whichever of the three lookups a term arrives through.
Concretely: any `headline` or `rows[].metric` key a collector's own `DEFINITIONS` names now gets a
tooltip, wherever no curated metric already claims that key. `recluster`'s two reclustering sequence
counts are the exception that proves the precedence: `sequences_in_new_families` and
`sequences_in_inherited_families` are CURATED here, as `reclusteredIntoNewFamilies` and
`reclusteredIntoExistingFamilies` (`src/features/build/model/definitions.ts`) — even though
`recluster.py`'s own `DEFINITIONS` also names both keys, it is the curated definition, with its
ambiguity note, that renders for them, not the generator's.

The pipeline side of this change went further than making the lookup possible: it gave every
headline key a `DEFINITIONS` entry in the 11 of `REGISTRY`'s 14 collectors that emit a `headline` at
all (`config_ledger`, `proteomes` and `other_reports` emit none, by design), and added
`test_every_collector_defines_the_headline_keys_it_emits`
(`panther_build/tests/test_build_state.py`) so a collector cannot ship an undefined headline key
again without a test failing.

**Verified, added 2026-09-11 — the live report doesn't carry a `recluster` section yet.**
`docs/build_state.json` currently lists 13 sections (`config_ledger` … `other_reports`) and none of
them is `recluster` — the collector exists in `panther_build`, but no regenerated report has landed.
Until someone regenerates against a real target, the glance panel's fourth panel ("New families",
`src/features/overview/components/GlanceCharts.tsx`) renders `recluster`'s absence through `Panel`'s
standard `UnavailableNotice` path, not a derived zero. That distinction is deliberate: a build that
has not reached reclustering has created no families _yet_, which is a different claim from having
created none, and `familiesCreated` is a number the section states outright rather than one we could
derive from `mapping`'s stage-to-stage family-count rise (which is a net change and would undercount
silently if anything were also dropped at that boundary).

**A detail worth building on:** phases come from `# PHASE:` markers in the target's _own copy_ of
`make_all.slurm`, rendered by `envsubst` at build time. Phase structure is therefore per-build and
can legitimately differ between targets — the UI must never hardcode the 14 we see.

---

## Constraints the pipeline imposes — things the UI must not promise

All four are **verified** in `.plans/2026-08-13-build-state-report-follow-ups.md`, which is a
deliberate deferral list, not a bug tracker.

### 1. Attempt histories are empty on every real build

The largest gap, and it directly affects us. Two measured causes:

- `progress.step_key_for` derives a key from the Make goal (`giga.touch` → `giga`), but SLURM `%x`
  defaults to the _script_ name (`giga.slurm`). **0 of 59** step keys match any real job name.
- `SBATCH = sbatch --output=$*/logs/…` uses the rule _stem_, so the longest-running compute — GIGA,
  MAFFT, seed MSAs, subfamily HMMs, the whole `prev_lib_rebuilt/` chain — writes into
  `$TARGET/famlib/dev/PANTHER<V>/lib_<V>/logs/`, while `progress.collect` reads only
  `$TARGET/logs`.

**Consequence:** `attempts` is always `[]`, so `running` / `failed` / `unknown` are _unreachable_,
and both ⚠ cross-checks in spec §3 never fire.

Our attempt-history UI is therefore correct but inert — only reachable through the `toFailed()`
fixture. That is the right call (the spec's own example rendering shows a three-attempt GIGA
history), but **we should label it as anticipating a capability, not reflecting one**, or a reviewer
will conclude the builds never fail.

### 2. The previous-library comparison was permanently unavailable — fixed upstream 2026-09-13

**As audited (2026-08-30):** `Makefile:361` defined the `reports/prev_lib_baseline.json` rule, but
**nothing depended on it** — not `%/all`, not `%/state`, not any line in `make_all.slurm`.
`prev_lib.collect` returns `None` without it, so our fixture's `"inputs not present yet"` was not a
mid-build state that resolves later; it read that way **forever**.

**Now:** `scripts/make_all.slurm` builds the goal as the first step of the previous-library-rebuild
phase (`|| true`, so a reporting artifact cannot abort the build under `set -e`). A build that runs
the driver produces the baseline, and `prev_lib` arrives `ok` with its four totals.

Two consequences for this dashboard, both already handled:

- `extractPreviousLibrary` read those totals from a `headline` shape the generator has never
  emitted. They live in the `prev` column of `data.rows`; `headline` carries the *deltas* as
  preformatted strings. Fixed 2026-09-10 — before that, a present `prev_lib` would have rendered
  four blank previous values while the panel announced itself available.
- The comparison is still assembled from `other_reports` rather than bound to `prev_lib`, and that
  is still the right call: it is what keeps the view working on the builds that predate this fix,
  and on any target whose baseline step failed. What changed is that it is no longer the *only*
  path to a comparison.

### 3. `--budget` does not bound the run

It gates whether an expensive collector _starts_. `node_tracking`'s first-run walk over ~15,500
`treeNodes.tab` files can overrun the 5–10 minute cap with nothing to interrupt it. If the UI ever
triggers generation, it cannot rely on a bounded response.

### 4. Renderers sit outside the error-isolation guard

`_run_collector` is airtight, but `render_json` / `render_md` / `render_tsv` are not. A future
collector returning a `Path` in `headline`, or a `tables` entry missing `truncated`, aborts the whole
run and writes **nothing** — after the collector already reported `status: ok`. Our UI can receive a
stale file with no indication that the latest run failed.

---

## What can be added

Ordered by value-per-effort. Each is grounded in an artifact that already exists.

### A. Three-column comparison — previous / rebuilt / new

**The most valuable addition, and we currently model only two columns.** Spec §7:

```
metric              PTHR19     rebuilt    PTHR20     Δ vs 19
genomes                   147          —        152       +5
sequences           2,102,411  2,102,411  2,292,053  +189,642
families               15,619     15,402     15,488     -131
subfamilies           134,192          —    138,401   +4,209
```

`prev_lib_rebuilt/` is the previous library **with splits, merges and removals already applied**. The
middle column therefore separates _the effect of family surgery_ from _the effect of new data_ —
which is the question a release reviewer actually has. A two-column view conflates them.

Note the blanks are structural, not missing data: the rebuilt column is sourced from
`refProteomePANTHERmapping_single_genome_fams_removed`, which records neither a genome roster nor
subfamilies. Our `Availability` model already handles this; the UI must render `—` and explain why,
not "unavailable".

### B. Six report files the pipeline already writes but nobody surfaces

`other_reports` is an **allowlist** of four. The spec's own context section lists these as already
written to `$TARGET/reports/` and **not** in it:

- `multi_proteome_conflicts.txt`
- `new_lib_unmapped_by_ID_counts.txt`
- `species_namespace_counts_new_lib.txt`
- `tree_rules_all`
- `dropped_dup_gene_ids_mapping_lines.txt`
- `createSeqClassification.log`

Adding one is "one `Entry`, not zero code" on the generator side, and **zero** on ours — the generic
renderer picks them up. This is the cheapest way to widen the report, and the best demonstration
that the extensibility story is real. Several are species-keyed and would join straight into the
species cross-section.

### C. SLURM execution metadata, once item 1 is fixed

The spec already designs for it, and `sacct` supplies state, exit code, **elapsed time** and
**MaxRSS**. That unlocks what we currently fake with inferred artifact spans:

- real per-step runtime, so `timing.provenance` flips from `inferred` to `measured` — our model
  already carries that field and the UI already distinguishes it
- job IDs as the ordering key (monotonic per cluster; immune to `touch`, copies and clock skew)
- memory high-water marks — a natural "why did this phase take 9h41m" drill-down
- the two ⚠ cross-checks: artifact newer than its latest job (**modified outside the build**), and
  artifact older than an upstream artifact (**stale, needs rerun**)

**Inferred:** a memory/runtime view per phase is probably the single most requested thing from
whoever babysits these builds, and it costs us nothing but a chart once the data arrives.

### D. The config ledger is append-only — we render one record of many

`reports/build_config.jsonl` gets **one record appended each time `%/all` fires**. The spec: _"a
config change mid-build becomes visible rather than silently overwriting the earlier value"_, and the
report renders a ⚠ with a field-level diff when records differ.

We currently show the latest record as though it were the only one. A timeline of config changes
across a build is a genuinely new view, and it is the thing that explains "why does this artifact
disagree with that one".

The ledger also carries, per spec §4, things we do not show:

- **external tool versions** — MAFFT, HMMer, BLAST, GIGA, ROBOT, OWLtools
- **QfO / RefProt README version lines** and the QfO **directory sha256**
- every `PREV_*` path resolved

For a permanent build record, tool versions matter as much as library versions. This is the
provenance view's real content.

### E. Build-over-build comparison, via `--snapshot`

`--snapshot` writes timestamped `build_state_<UTC>.json` files beside the canonical one. Two
snapshots make a diff view possible — what moved between Tuesday and Thursday — with no generator
change at all. The plans already flagged a report diff as out of scope for the generator; it is
natural on our side.

### F. Species-count reconciliation as a first-class view

Our fixture shows 131 / 131 / 131 / **147** and we currently present it as "a different denominator".
The real story is more interesting and is a known pipeline bug (follow-ups item 9, **verified**):
`oscode_from_species_tree.py` walks every graph node, so `genome_list.txt` contains ancestral names
alongside leaf OSCODEs — measured at 261 total, 116 ancestral, 145 real leaves, against 143 UP-numbered
proteomes.

Two traps recorded there that any UI explanation must respect: the ancestor list is _not_ a usable
complement (`S=Opisthokonts` vs graph node `Opisthokonta`), and OSCODEs are **not** uniformly five
characters — `PIG` and `RAT` are real, so a `^[A-Z0-9]{5}$` filter silently drops them.

---

## What can be removed

- **The `toStale()` fixture path is near-unreachable in practice.** Report freshness compares generation
  time to the newest artifact; since the report is regenerated on demand and overwrites,
  `potentially-stale` mostly indicates the _cross-check_ case in item C, which does not fire yet.
  Keep the state, drop any prominence it has.
- **`render_tsv`'s shape assumption is not ours to mirror.** Only `giga`, `library`, `prev_lib` and
  `config_ledger` are `{metric,value}`-shaped; the TSV mislabels `mapping` and drops columns for
  `node_tracking`. If we ever offer a "download as TSV", generate it from our model rather than
  proxying theirs.
- **The `.md` output already exists.** `build_state.md` is the generator's own archival human copy.
  Our plan 07 print/PDF/Markdown export should not duplicate it — better to _link_ to it, or drop
  the Markdown half of that plan entirely and keep only print.

---

## Open questions for the team

1. **Is the web app meant to trigger generation, or only read?** Everything in the spec assumes a
   file on disk. If the UI ever calls `make target/state`, the unbounded `--budget` (item 3) and the
   unguarded renderers (item 4) both become our problem.
2. **One target or many?** Every artifact path is `$TARGET`-scoped and the report is reproducible
   from the target alone. A target picker changes the IA substantially — the spine assumes one build.
3. **Is `prev_lib_baseline.json` going to be wired?** It decides whether the comparison view is a
   first-class feature or permanently a fallback assembled from `other_reports`.
4. **Does the UI belong in `panther-workspace`'s redesign?** That repo is in Phase 1
   (_document what exists_) with `panther_build` as one of 10 legacy systems. This viewer is new
   build, not legacy documentation — worth confirming it is not expected to follow that SDLC gate.

---

## Sources

- `panther_build/.specs/2026-08-13-build-state-report-design.md` — the contract (500 lines)
- `panther_build/.plans/2026-08-13-build-state-report-follow-ups.md` — deferred gaps (162 lines)
- `panther_build/scripts/build_state.py` + `build_state_collectors/` (~1,500 lines)
- `panther_build/CLAUDE.md`, `docs/orchestration.md`, `docs/data-pipeline.md`
- `panther-workspace/CLAUDE.md`, `SDLC-WORKFLOW.md`, `docs/phase1/`
