# Bind the subfamily / HT / ortholog sections to their phase

Cross-repo work. The generator half is
`panther_build/.plans/2026-09-09-subfamily-ht-ortholog-build-state-sections.md`.

## Why

`subfamilies-ht-orthologs` is the one substantial phase on the spine with no report bound to it.
`library` lists it in `contributingPhaseIds`, but no section names it as primary, so the phase
renders as steps and nothing else.

The pipeline is adding three sections for it: `ibd_sf_roots` (PAINT-implied subfamily roots),
`list_ht` (horizontal transfer) and `orthologs` (orthologs and the FTP homolog products). This
side registers them, in the same change, so they never land under "Unattached reports".

## Changes

1. `src/features/build/model/parse.ts` -- add `ibd_sf_roots`, `list_ht`, `orthologs` to
   `KNOWN_SECTION_IDS`, in generator `REGISTRY` order (after `node_tracking`, before `library`).
2. `src/features/build/model/binding.ts` -- three `SectionBinding` entries, each
   `placement: 'phase'` with `primaryPhaseId: PHASE_IDS.subfamiliesHtOrthologs` and a written
   rationale. `contributingPhaseIds: []` on all three: the stages run wholly inside that one
   phase.

No extractor under `model/sections/`. All three emit only `text` / `rows` / `tables` /
`headline` / `warnings`, which is exactly the shape the generic renderer already handles -- the
property that makes an unknown section render instead of disappearing.

## Why no fixture change

The frozen oracle stays frozen. `tests/fixtures/build_state.reference.json` is re-verified only
deliberately (`.specs/2026-09-09-frozen-test-fixture-design.md`), and these sections are not in
it, so:

- `tests/features/build/model/parse.appendix.test.ts` keeps asserting 9 sections. Correct: the
  reference carries 9.
- `tests/features/build/model/liveReport.contract.test.ts` passes untouched. Its inventory
  assertion is `report.reports.length <= KNOWN_SECTION_IDS.length`, so knowing an id the live
  file does not yet carry is legitimate, and its drift detector goes green the moment the live
  file does carry them -- which is the whole point of registering ahead of the data.
- `tests/features/build/model/binding.test.ts:27` ("covers every section the real report
  contains") is a subset check over the reference, so three extra bindings do not break it.

Binding behaviour is tested against synthetic sections, as the existing hint and unattached cases
in that file already are.

## Tests

`tests/features/build/model/binding.test.ts` -- the three sections resolve to
`subfamilies-ht-orthologs` with `placement: 'phase'`, and `sectionIdsForPhase` returns all three
for that phase, proving the many-sections-on-one-phase path with real registry entries rather
than fabricated ones.

    npm test && npm run type-check && npm run lint

## Ordering note

This lands before the data. Until a cluster build regenerates `build_state.json` and it is copied
into `docs/`, the phase renders as it does today; the three sections appear with the refresh. The
reverse order -- data first -- is what put `proteomes` under "Unattached reports".
