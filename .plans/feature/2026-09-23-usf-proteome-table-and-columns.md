# Unplaced fragments view: by-proteome table, clearer family columns, taxonomic names — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Status:** ACTIVE · **Branch:** giga-usf-dashboard
**Companion (the payload; read its "Payload changes"):**
`panther_build/.plans/2026-09-23-giga-usf-proteome-and-input-counts.md`

## User's asks (2026-09-23)
1. A by-proteome table: number of USF sequences and % of total proteome sequences.
2. The family table: "Tree leaves" contrasts badly with "Unplaced". Add an input total, then
   unplaced, then a clearer name for the kept count.
3. The member (long-ID) table: remove the redundant "Gene" column and add "Taxonomic name".

## Design
- **Family table columns, in order:**
  - Family
  - **Input seqs** (`inputSeqs`)
  - **Unplaced**
  - **In final tree** (was "Tree leaves")
  - **Share unplaced**

  Each header has a hint tooltip from the generator's DEFINITIONS where one exists
  (`unplaced_fraction`, `input_seqs`, …). Look at how other views surface definitions
  (`DefinedTerm` / `metricDefinitions`) and reuse that. A null value renders as the absent mark.
  If the report's `input_mismatch_families` is > 0, show a one-line note above the table with
  the count, e.g. "N families: input ≠ unplaced + in final tree — see generator warnings".
- **By-proteome table**, a new section in the view, above or beside the families (your call;
  say why). Columns:
  - Species (oscode button that opens the species drawer, like the member table's)
  - Taxonomic name
  - Proteome seqs
  - Sent to GIGA
  - Unplaced
  - Families
  - % of proteome
  - % of GIGA input

  Sortable; default sort Unplaced desc; complete (no truncation). Nulls render as the absent mark.
  Percentages to 2 decimals with a "%" suffix. Read the table **"Unplaced fragments by proteome"**
  from the main report. For older reports, fall back to the old "Unplaced fragments by species"
  table: its three columns, with the others null.
- **Taxonomic name:** from the proteomes section roster (`report.proteomes` roster rows,
  `name` by `oscode`). Display it humanised: underscores → spaces, first letter capitalised
  ("homo_sapiens" → "Homo sapiens"; "subsp."/"pv." kept). Put that in one small pure helper with
  tests. Missing → absent mark. Used in both the by-proteome table and the member table.
- **Member table:** columns Species · Taxonomic name · UniProt · Long ID. Remove Gene.
  `parseLongId` keeps its gene fields; they're just not displayed.
- **Model:**
  - `UnplacedFamilyRow` gains `inputSeqs: number | null`, parsed in both the sidecar and the
    old-shape paths (null in the old shape).
  - `UnplacedSpeciesRow` gains `proteomeSeqs`, `gigaInputSeqs`, `unplacedPctOfProteome` and
    `unplacedPctOfGigaInput`, all `number | null`.
  - The summary gains `inputMismatchFamilies: number | null`.
  - The species cross-section join (`species.ts`) keeps working off `bySpecies`. Its
    measured-zero rule still holds, and it may now use the new rows directly since they include
    zero-unplaced species.
- **Fixtures:** extend the frozen sidecar fixture
  (`tests/fixtures/build_state.giga_usf.reference.json`) and the `gigaUsfSidecar` state's main
  payload to the new shape. Keep the old-shape `gigaUsf` state as the fallback test.
- Constraints as before:
  - absent is not zero;
  - never hand-edit docs/build_state.json or the reference oracle;
  - typed hooks, `import type`, Prettier;
  - no commits.

## Tasks
### Task 1: model + fixtures
- [ ] Tests first for the new fields, the table-name fallback, the humanise helper and
  `inputMismatchFamilies`.
### Task 2: view
- [ ] Tests first:
  - family table header order and labels;
  - the mismatch note;
  - the by-proteome table rows and sort;
  - the old-report fallback;
  - member table has no Gene column and has a Taxonomic name column with humanised values.
- [ ] Then `npm test` (971 before), `npm run type-check`, `npm run lint`, and `npx prettier --check` on touched files.
