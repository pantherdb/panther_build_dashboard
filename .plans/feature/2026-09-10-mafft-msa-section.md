# Bind the `msa` section to the pipeline spine

Companion plan: `panther_build/.plans/2026-09-10-mafft-msa-build-state-section.md`, which adds
the `msa` collector that produces this section. Read that one for what the numbers mean.

## Why

The generator gains a ninth… thirteenth section, `msa`, reporting what MAFFT did to every family
in the two seeded alignment passes. Without the dashboard half it still renders — under
"Unattached reports", through the generic renderer — but it hangs off no phase and joins no
derived check. `liveReport.contract.test.ts` asserts every section id resolves to a placement, so
an unbound `msa` is a red contract suite, by design.

## Tasks

1. `src/features/build/model/parse.ts` — add `msa` to `KNOWN_SECTION_IDS`.
2. `src/features/build/model/binding.ts` — a `SectionBinding`:
   - `placement: 'phase'`
   - `primaryPhaseId: PHASE_IDS.msaBuild` (`msa-build-orig`)
   - `contributingPhaseIds: [PHASE_IDS.extenBuildAndScoring]`
   - rationale: the section reports two MAFFT passes. The `orig` pass *is* the MSA build phase;
     the `exten` pass runs inside exten build and scoring, which is where the alignment against
     the previous release actually happens. One report, two places on the spine — the same shape
     `mapping` already has.
3. Tests for both, alongside the existing binding and parse tests.

No extractor under `model/sections/`. The collector emits `text` / `tables` / `headline` /
`warnings`, which is exactly the shape the generic renderer handles.

## Sequencing

Steps 1–2 can land before the live report carries the section: an id in `KNOWN_SECTION_IDS`
with no matching section is inert. What cannot be skipped is the reverse — refreshing
`docs/build_state.json` from a build that HAS the section while the binding is missing puts it
under "Unattached reports" and turns the contract suite red.

The oracle at `tests/fixtures/build_state.reference.json` is NOT refreshed here. It is frozen on
purpose (`.specs/2026-09-09-frozen-test-fixture-design.md`), so every existing test keeps
asserting against the same 12-section report and stays green.
