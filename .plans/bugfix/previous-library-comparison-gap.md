# Task: Read prev_lib's real numbers, and name the right gap when the comparison is partial

**Status:** COMPLETE
**Branch:** main
**Paired plan:** `panther_build/.plans/2026-09-10-uncap-comparison-tables.md`

## Goal

Two defects on the same panel, found while chasing "Direct previous-library totals — Partially
available" on a report whose previous-library totals were all present.

1. `extractPreviousLibrary` read totals from a `headline` shape the generator has never emitted, so
   the direct comparison was blank whenever `prev_lib` was present.
2. The panel's `missingSubject` was a hardcoded string, so it went on blaming the totals no matter
   which of the two `partial` branches had fired.

## Context

- **Related files:** `src/features/build/model/sections/library.ts`,
  `src/features/build/model/comparison.ts`, `src/features/build/model/types.ts`,
  `src/features/build/model/fallbacks.ts`,
  `src/features/comparison/components/ComparisonReport.tsx`
- **Triggered by:** a build that finally produced `reports/prev_lib_baseline.json`. Until then
  `prev_lib` was `absent` on every report ever generated, so neither defect could show.

## What changed

**Totals come off `rows`.** The collector puts them in the `prev` column of
`data.rows` (`{metric, prev, rebuilt, new, delta}`) and fills `headline` with the *deltas* as
preformatted strings — `delta_genomes`, not `genomes`. Both revisions of that collector have done
this; the extractor never matched it. An absent row and a `null` total both read as `null`, never 0.

**The model says why it is partial.** `ComparisonSummary` gained
`gap: 'noSources' | 'previousLibraryAbsent' | 'tablesTruncated' | null`, set in the branches that
already existed in `buildComparison`. `ComparisonReport` maps it to a subject instead of hardcoding
one. `partial` has two causes and naming the wrong one is worse than naming none.

**Not done:** the `rebuilt` column — the previous library with splits, merges and removals applied.
The generator ships it in the same rows and nothing in the model or the views has a place for it
yet. It would want a field plus a third column in `ComparisonOverview`.

## Verification

`npm test` → **795 passed across 56 files**; `npm run type-check` and `npm run lint` clean.

Written test-first, and the RED runs are the evidence both defects were real:

- `previousLibrary.test.ts` — the four totals came back `null` against a generator-shaped payload,
  and `takes the rows over anything the headline claims` returned the planted `999`.
- `comparison.test.tsx` — `summary.gap` was `undefined`, and the rendered notice contained no
  mention of per-species coverage.

`tests/support/previousLibrarySection.ts` holds the populated `prev_lib` payload both suites need.
No fixture carries one: the section requires a baseline the pipeline builds through a rule nothing
depends on, so the frozen reference reports it `absent`.

## Notes

- `previousLibrary.availability` was already `available` before the fix (status `ok` + data present),
  which is exactly what made the bug quiet: the panel dropped its "partial" banner and kept four
  blank previous values.
- Once `panther_build`'s uncapped tables reach a regenerated report, the second `partial` branch
  stops firing on live data and this panel reads `available`. The truncation path stays under test
  through the frozen reference, which still carries capped tables.
- Those two tables also gain sort and filter at that point: `completenessOf` withholds them on a
  truncated table, on the reasoning that a sortable subset invites false conclusions. They will no
  longer be subsets.
