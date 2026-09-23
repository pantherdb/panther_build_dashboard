# GIGA Unplaced-Fragments View — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** ACTIVE

**Goal:** Under the "Tree building (GIGA)" phase, a navigable list of every family with a
non-empty `.usf`: filter by family, accession or species, pick a family, see the long IDs GIGA
kicked out of its tree (species, gene id, UniProt accession), copy them.

**Architecture:** Bind the new `giga_usf` section to `tree-building-giga`, parse it into a typed
`UnplacedFragmentsSummary` on `BuildReport`, and render it through a specialised, lazy
`UnplacedFragmentsReport` registered in `features/reports/registry.tsx`. Master–detail: the family
`DataTable` on the left/top, the selected family's member table beneath. The frozen oracle predates
the section, so tests run against a `withGigaUsf()` fixture transform, same as `withRecluster()`.

**Tech Stack:** React 19, TypeScript, Mantine v9, Tailwind v4, Vitest + RTL.

**Spec:** none separate. Companion plan (produces the section, and documents what a `.usf` is and
why the numbers mean what they mean):
`panther_build/.plans/2026-09-22-giga-usf-build-state-section.md`. Read its "Background" and
"Design" first — the payload shape below is copied from it.

## Global Constraints

- Section id `giga_usf`; tables named exactly `"Families with unplaced fragments"` and
  `"Unplaced fragments by species"`; member map at `data.unplaced_members`.
- `giga` must stay the FIRST section on `tree-building-giga` (`binding.test.ts` asserts
  `treePhase.sectionIds[0] === 'giga'`).
- Never hand-edit `docs/build_state.json` or `tests/fixtures/build_state.reference.json`.
- Absent is not zero: `absent` section → the view says "stage not reached", never "0 families".
- Truncation is honest: member lists may be truncated (`members_truncated`); the family table never is.
- Typed Redux hooks only; `import type` for types; Prettier style (no semicolons, single quotes).
- Do not `git commit` (user rule); stage with `git add`. No Claude attribution in commit messages.

## Payload (from the pipeline plan)

```jsonc
"data": {
  "headline": { "books_scanned", "families_with_unplaced", "unplaced_total",
                "unassigned_in_mapping", "members_included", "members_truncated" },
  "tables": [
    { "name": "Families with unplaced fragments",
      "columns": ["family","unplaced","tree_leaves","unplaced_fraction"], ... },
    { "name": "Unplaced fragments by species", "columns": ["oscode","unplaced","families"], ... }
  ],
  "unplaced_members": { "PTHR1": ["HUMAN|HGNC=1|UniProtKB=P00001", ...] },
  "definitions": {...}, "warnings": [...]
}
```

## File Structure

| File | Change |
| --- | --- |
| `src/features/build/model/parse.ts` | Add `giga_usf` to `KNOWN_SECTION_IDS`; wire extractor into `BuildReport`. |
| `src/features/build/model/binding.ts` | `SectionBinding` for `giga_usf`. |
| `src/features/build/model/longId.ts` | **Create.** `parseLongId()`. |
| `src/features/build/model/sections/gigaUsf.ts` | **Create.** `extractUnplacedFragments()`. |
| `src/features/build/model/sections/index.ts` | Export it. |
| `src/features/build/model/types.ts` | `UnplacedFragmentsSummary` & row types; `BuildReport.unplacedFragments`. |
| `src/features/build/model/fallbacks.ts` | `absentUnplacedFragments()`. |
| `src/features/build/model/index.ts` | Re-export new types / `parseLongId` if the barrel doesn't already cover them. |
| `src/features/build/fixtures/transforms.ts` | `gigaUsfPayload()`, `withGigaUsf()`. |
| `src/features/build/fixtures/index.ts` | `'gigaUsf'` fixture state. |
| `src/features/trees/components/UnplacedFragmentsReport.tsx` | **Create.** The view. |
| `src/features/reports/registry.tsx` | Register the renderer. |
| tests (below) | **Create** 4 test files, extend `binding.test.ts`. |

---

### Task 1: Know and place the section

**Files:**
- Modify: `src/features/build/model/parse.ts:75-90`, `src/features/build/model/binding.ts` (after the `giga` binding, ~line 126)
- Test: `tests/features/build/model/binding.test.ts`

**Interfaces:**
- Produces: `'giga_usf'` in `KNOWN_SECTION_IDS`; a `SectionBinding` with `primaryPhaseId: PHASE_IDS.treeBuilding`.

- [ ] **Step 1: Failing test** — append to `binding.test.ts` (it already imports `PHASE_IDS`
  and builds a `report`; the `giga_usf` section must come from the fixture state, so use
  `getFixtureReport('gigaUsf')` once Task 3 lands — for now, test the static registry):

```ts
import { KNOWN_SECTION_IDS, SECTION_BINDINGS } from '@/features/build/model'

describe('giga_usf', () => {
  it('is a known section', () => {
    expect(KNOWN_SECTION_IDS).toContain('giga_usf')
  })

  it('binds to tree building, primary, with no contributing phases', () => {
    const binding = SECTION_BINDINGS.find(entry => entry.sectionId === 'giga_usf')
    expect(binding?.placement).toBe('phase')
    expect(binding?.primaryPhaseId).toBe(PHASE_IDS.treeBuilding)
    expect(binding?.contributingPhaseIds).toEqual([])
  })
})
```

(If `SECTION_BINDINGS` is not exported from the barrel, import it from `@/features/build/model/binding`.)

- [ ] **Step 2: Run** `npx vitest run tests/features/build/model/binding.test.ts` → FAIL.

- [ ] **Step 3: Implement.** In `parse.ts`, insert `'giga_usf',` after `'giga',`. In `binding.ts`, after the `giga` entry:

```ts
  {
    sectionId: 'giga_usf',
    placement: 'phase',
    primaryPhaseId: PHASE_IDS.treeBuilding,
    contributingPhaseIds: [],
    rationale:
      'The sequences GIGA removed from each tree as unplaced fragments, read from the .usf it ' +
      'writes beside the tree. Same phase as `giga`, which stays first: `giga` says how many ' +
      'books got a tree, this says who was left out of them.',
  },
```

- [ ] **Step 4: Run** the binding suite → PASS. Then `npm test` — the full suite must still be
  801 passing + 2 new. (`KNOWN_SECTION_IDS` with no matching section is inert.)

- [ ] **Step 5: Stage** `git add src/features/build/model/parse.ts src/features/build/model/binding.ts tests/features/build/model/binding.test.ts`

---

### Task 2: `parseLongId`

**Files:**
- Create: `src/features/build/model/longId.ts`
- Test: `tests/features/build/model/longId.test.ts`

**Interfaces:**
- Produces:
```ts
export interface LongId {
  raw: string
  oscode: string | null      // 'HUMAN'
  geneSource: string | null  // 'HGNC'
  geneId: string | null      // '1084'   (everything after the FIRST '=' — MGI ids contain '=')
  accession: string | null   // 'Q12983'
}
export function parseLongId(raw: string): LongId
export function uniprotUrl(accession: string): string
```

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, it } from 'vitest'
import { parseLongId, uniprotUrl } from '@/features/build/model/longId'

describe('parseLongId', () => {
  it('splits the three fields of a PANTHER long id', () => {
    expect(parseLongId('HUMAN|HGNC=1084|UniProtKB=Q12983')).toEqual({
      raw: 'HUMAN|HGNC=1084|UniProtKB=Q12983',
      oscode: 'HUMAN',
      geneSource: 'HGNC',
      geneId: '1084',
      accession: 'Q12983',
    })
  })

  it('keeps an = inside the gene id (MGI ids carry one)', () => {
    const id = parseLongId('MOUSE|MGI=MGI=1914945|UniProtKB=Q99LX8')
    expect(id.geneSource).toBe('MGI')
    expect(id.geneId).toBe('MGI=1914945')
  })

  it('degrades to nulls on something that is not a long id, keeping the raw text', () => {
    expect(parseLongId('garbage')).toEqual({
      raw: 'garbage', oscode: 'garbage', geneSource: null, geneId: null, accession: null,
    })
  })

  it('does not invent an accession when the UniProtKB field is missing', () => {
    expect(parseLongId('HUMAN|HGNC=1').accession).toBeNull()
  })

  it('links an accession to UniProt', () => {
    expect(uniprotUrl('Q12983')).toBe('https://www.uniprot.org/uniprotkb/Q12983/entry')
  })
})
```

- [ ] **Step 2: Run** `npx vitest run tests/features/build/model/longId.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
/**
 * The PANTHER long id, `ORGCODE|source=ID|UniProtKB=ACCESSION`, split for display.
 *
 * Split on the FIRST `=` of each field, not every one: MGI gene ids carry their own `=`
 * (`MGI=MGI=1914945`), and a naive split loses the id's prefix. Anything that does not look
 * like a long id keeps its raw text and gets nulls, so a malformed line still shows.
 */
export interface LongId {
  raw: string
  oscode: string | null
  geneSource: string | null
  geneId: string | null
  accession: string | null
}

function splitField(field: string | undefined): [string, string] | null {
  if (!field) return null
  const at = field.indexOf('=')
  return at < 0 ? null : [field.slice(0, at), field.slice(at + 1)]
}

export function parseLongId(raw: string): LongId {
  const [org, gene, uniprot] = raw.split('|')
  const geneField = splitField(gene)
  const uniprotField = splitField(uniprot)
  return {
    raw,
    oscode: org || null,
    geneSource: geneField?.[0] ?? null,
    geneId: geneField?.[1] ?? null,
    accession: uniprotField && uniprotField[0] === 'UniProtKB' ? uniprotField[1] : null,
  }
}

export const uniprotUrl = (accession: string): string =>
  `https://www.uniprot.org/uniprotkb/${encodeURIComponent(accession)}/entry`
```

- [ ] **Step 4: Run** → PASS (5).
- [ ] **Step 5: Stage** `git add src/features/build/model/longId.ts tests/features/build/model/longId.test.ts`

---

### Task 3: Typed model, extractor, fixture state

**Files:**
- Modify: `src/features/build/model/types.ts` (beside `TreeSummary`, ~line 471; add field to `BuildReport` ~line 912), `fallbacks.ts`, `parse.ts` (beside `recluster` at ~377 and in the returned object ~516), `sections/index.ts`
- Create: `src/features/build/model/sections/gigaUsf.ts`
- Modify: `src/features/build/fixtures/transforms.ts`, `src/features/build/fixtures/index.ts`
- Test: `tests/features/build/model/sections/gigaUsf.test.ts`

**Interfaces:**
- Consumes: `SectionInput`, `NoteSink`, `makeMeta`, `availabilityFor`, `sectionBaseNotes`, `as*` primitives — import them exactly as `sections/recluster.ts` does.
- Produces:
```ts
export interface UnplacedFamilyRow {
  family: string
  unplaced: number
  treeLeaves: number | null
  unplacedFraction: number | null
  /** null when the report left this family's ids out to stay under its size cap */
  members: string[] | null
}
export interface UnplacedSpeciesRow { oscode: string; unplaced: number; families: number }
export interface UnplacedFragmentsSummary extends SummaryMeta {
  booksScanned: number | null
  familiesWithUnplaced: number | null
  unplacedTotal: number | null
  /** null = the post-GIGA mapping was never checked (no reports/usf_unassigned.tsv) */
  unassignedInMapping: number | null
  membersTruncated: boolean
  families: UnplacedFamilyRow[]
  bySpecies: UnplacedSpeciesRow[]
  warnings: string[]
}
// BuildReport gains:  unplacedFragments: UnplacedFragmentsSummary
export function extractUnplacedFragments(section: SectionInput, sink: NoteSink): UnplacedFragmentsSummary
export function absentUnplacedFragments(meta: SummaryMeta): UnplacedFragmentsSummary
export function gigaUsfPayload(overrides?: Record<string, unknown>): Record<string, unknown>
export function withGigaUsf(): BuildStateTransform
// FixtureStateKey gains 'gigaUsf'
```

- [ ] **Step 1: Fixture payload + transform** — in `transforms.ts`, below `withRecluster`:

```ts
/** A small, shaped `giga_usf` payload. The frozen reference predates the section. */
export function gigaUsfPayload(overrides: Record<string, unknown> = {}) {
  const headline = {
    books_scanned: 15790,
    families_with_unplaced: 3,
    unplaced_total: 9,
    unassigned_in_mapping: 9,
    members_included: 3,
    members_truncated: true,
  }
  return {
    text: '3 of 15790 books had sequences GIGA could not place; 9 sequences in total.',
    headline,
    rows: Object.entries(headline).map(([metric, value]) => ({ metric, value })),
    tables: [
      {
        name: 'Families with unplaced fragments',
        columns: ['family', 'unplaced', 'tree_leaves', 'unplaced_fraction'],
        rows: [
          { family: 'PTHR10000', unplaced: 6, tree_leaves: 20, unplaced_fraction: 0.2308 },
          { family: 'PTHR10001', unplaced: 1, tree_leaves: 50, unplaced_fraction: 0.0196 },
          { family: 'PTHR10002', unplaced: 2, tree_leaves: null, unplaced_fraction: null },
        ],
        truncated: false,
        total_rows: 3,
      },
      {
        name: 'Unplaced fragments by species',
        columns: ['oscode', 'unplaced', 'families'],
        rows: [
          { oscode: 'HUMAN', unplaced: 4, families: 3 },
          { oscode: 'MOUSE', unplaced: 5, families: 1 },
        ],
        truncated: false,
        total_rows: 2,
      },
    ],
    unplaced_members: {
      // PTHR10000 left out: exercises members === null (truncated)
      PTHR10001: ['HUMAN|HGNC=7|UniProtKB=P00007'],
      PTHR10002: ['HUMAN|HGNC=8|UniProtKB=P00008', 'MOUSE|MGI=MGI=9|UniProtKB=Q00009'],
    },
    warnings: ['Long IDs for 1 family (PTHR10000) were left out to keep the report under 3 IDs; their counts are complete.'],
    ...overrides,
  }
}

/** Adds `giga_usf` right after `giga`, where the generator's REGISTRY emits it. Idempotent. */
export function withGigaUsf(): BuildStateTransform {
  return state => {
    if (!isRecord(state)) return state
    const next = clone(state)
    const sections = asArray(next.sections)
    if (sections.filter(isRecord).some(section => asString(section.id) === 'giga_usf')) return next
    const at = sections.findIndex(section => isRecord(section) && asString(section.id) === 'giga')
    const addition: RawSection = {
      id: 'giga_usf',
      title: 'Unplaced fragments (GIGA .usf)',
      status: 'ok',
      message: null,
      data: gigaUsfPayload(),
    }
    const insertAt = at < 0 ? sections.length : at + 1
    next.sections = [...sections.slice(0, insertAt), addition, ...sections.slice(insertAt)] as RawSection[]
    return next
  }
}
```

In `fixtures/index.ts`: import `withGigaUsf`, add `'gigaUsf'` to `FIXTURE_STATE_KEYS`, and a definition:

```ts
  {
    key: 'gigaUsf',
    label: 'With unplaced fragments',
    description:
      'The real report plus the giga_usf section, which the frozen reference predates: 3 ' +
      'families with sequences GIGA could not place, all unassigned in the post-GIGA mapping.',
    transforms: ['withGigaUsf'],
    apply: withGigaUsf(),
  },
```

- [ ] **Step 2: Failing tests** — `tests/features/build/model/sections/gigaUsf.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createNoteSink, extractUnplacedFragments, toSectionInput } from '@/features/build/model'
import type { RawSection } from '@/features/build/model'
import { getFixtureReport } from '@/features/build/fixtures'
import { gigaUsfPayload } from '@/features/build/fixtures/transforms'

const sectionOf = (data: unknown, overrides: Partial<RawSection> = {}) =>
  toSectionInput(
    { id: 'giga_usf', title: 'Unplaced fragments', status: 'ok', data, ...overrides } as RawSection,
    1
  )

const extract = (data: unknown, overrides: Partial<RawSection> = {}) =>
  extractUnplacedFragments(sectionOf(data, overrides), createNoteSink())

describe('extractUnplacedFragments', () => {
  it('reads the headline', () => {
    const summary = extract(gigaUsfPayload())
    expect(summary.familiesWithUnplaced).toBe(3)
    expect(summary.unplacedTotal).toBe(9)
    expect(summary.unassignedInMapping).toBe(9)
    expect(summary.membersTruncated).toBe(true)
  })

  it('joins each family row to its members, null where the report left them out', () => {
    const byFamily = new Map(extract(gigaUsfPayload()).families.map(row => [row.family, row]))
    expect(byFamily.get('PTHR10001')?.members).toEqual(['HUMAN|HGNC=7|UniProtKB=P00007'])
    expect(byFamily.get('PTHR10000')?.members).toBeNull()
  })

  it('keeps an unmeasured fraction null, not zero', () => {
    const row = extract(gigaUsfPayload()).families.find(entry => entry.family === 'PTHR10002')
    expect(row?.treeLeaves).toBeNull()
    expect(row?.unplacedFraction).toBeNull()
  })

  it('reads the species table by name, not position', () => {
    const payload = gigaUsfPayload()
    const tables = [{ name: 'Something new', columns: [], rows: [] }, ...(payload.tables as unknown[])]
    expect(extract({ ...payload, tables }).bySpecies.map(row => row.oscode)).toEqual(['HUMAN', 'MOUSE'])
  })

  it('is absent, not zero, when the section is absent', () => {
    const summary = extract(null, { status: 'absent', message: 'inputs not present yet' })
    expect(summary.familiesWithUnplaced).toBeNull()
    expect(summary.families).toEqual([])
    expect(summary.availability).not.toBe('present')
  })

  it('skips a family row without a family id and says so', () => {
    const payload = gigaUsfPayload()
    const [families, species] = payload.tables as Array<Record<string, unknown>>
    const bad = { ...families, rows: [{ unplaced: 3 }, ...(families.rows as unknown[])] }
    const sink = createNoteSink()
    const summary = extractUnplacedFragments(sectionOf({ ...payload, tables: [bad, species] }), sink)
    expect(summary.families).toHaveLength(3)
  })

  it('is on the report under the gigaUsf fixture state, and absent on the real one', () => {
    expect(getFixtureReport('gigaUsf').unplacedFragments.familiesWithUnplaced).toBe(3)
    expect(getFixtureReport('real').unplacedFragments.availability).not.toBe('present')
  })
})
```

- [ ] **Step 3: Run** `npx vitest run tests/features/build/model/sections/gigaUsf.test.ts` → FAIL.

- [ ] **Step 4: Types + fallback.** Add the three interfaces from **Interfaces** to `types.ts`
  under the "Library, trees" block, and `unplacedFragments: UnplacedFragmentsSummary` after
  `trees` in `BuildReport`. In `fallbacks.ts`:

```ts
export function absentUnplacedFragments(meta: SummaryMeta): UnplacedFragmentsSummary {
  return {
    ...meta,
    booksScanned: null,
    familiesWithUnplaced: null,
    unplacedTotal: null,
    unassignedInMapping: null,
    membersTruncated: false,
    families: [],
    bySpecies: [],
    warnings: [],
  }
}
```

- [ ] **Step 5: Extractor** — `src/features/build/model/sections/gigaUsf.ts`:

```ts
/**
 * The `giga_usf` section: the sequences GIGA removed from each tree as unplaced fragments.
 *
 * The family table is the navigation and is always complete; the member map is capped by the
 * generator to keep the bundled report small. A family whose ids were left out keeps its count
 * and gets `members: null` - "not in this report", which the view must not render as "none".
 */

import { asArray, asBoolean, asInteger, asNonEmptyString, asNumber, asRecord, asStringArray } from '../primitives'
import { makeMeta } from '../notes'
import { availabilityFor } from '../status'
import type { NoteSink } from '../notes'
import type { UnplacedFamilyRow, UnplacedFragmentsSummary, UnplacedSpeciesRow } from '../types'
import { sectionBaseNotes } from './input'
import type { SectionInput } from './input'

export const FAMILY_TABLE = 'Families with unplaced fragments'
export const SPECIES_TABLE = 'Unplaced fragments by species'

function tableRows(tables: unknown, name: string): Record<string, unknown>[] {
  const table = asArray(tables)
    .map(entry => asRecord(entry))
    .find(record => asNonEmptyString(record?.name) === name)
  return asArray(table?.rows)
    .map(entry => asRecord(entry))
    .filter((record): record is Record<string, unknown> => record !== null)
}

export function extractUnplacedFragments(
  section: SectionInput,
  sink: NoteSink
): UnplacedFragmentsSummary {
  const scope = `section:${section.sectionId}`
  const data = section.dataRecord
  const notes = sectionBaseNotes(section, sink, 'unplaced fragments')
  const meta = makeMeta({
    availability: availabilityFor(section.status, data !== null),
    sectionId: section.sectionId,
    message: section.message,
    status: section.status,
    notes,
  })
  const headline = asRecord(data?.headline)
  const members = asRecord(data?.unplaced_members) ?? {}

  const families: UnplacedFamilyRow[] = []
  for (const record of tableRows(data?.tables, FAMILY_TABLE)) {
    const family = asNonEmptyString(record.family)
    const unplaced = asInteger(record.unplaced)
    if (family === null || unplaced === null) {
      sink.add('warning', scope, 'A family row has no family id or count; skipped.')
      continue
    }
    families.push({
      family,
      unplaced,
      treeLeaves: asInteger(record.tree_leaves),
      unplacedFraction: asNumber(record.unplaced_fraction),
      members: family in members ? asStringArray(members[family]) : null,
    })
  }

  const bySpecies: UnplacedSpeciesRow[] = tableRows(data?.tables, SPECIES_TABLE).flatMap(record => {
    const oscode = asNonEmptyString(record.oscode)
    const unplaced = asInteger(record.unplaced)
    return oscode === null || unplaced === null
      ? []
      : [{ oscode, unplaced, families: asInteger(record.families) ?? 0 }]
  })

  return {
    ...meta,
    booksScanned: asInteger(headline?.books_scanned),
    familiesWithUnplaced: asInteger(headline?.families_with_unplaced),
    unplacedTotal: asInteger(headline?.unplaced_total),
    unassignedInMapping: asInteger(headline?.unassigned_in_mapping),
    membersTruncated: asBoolean(headline?.members_truncated) ?? false,
    families,
    bySpecies,
    warnings: asStringArray(data?.warnings),
  }
}
```

Export from `sections/index.ts`: `export { extractUnplacedFragments } from './gigaUsf'`. In
`parse.ts`, beside `recluster`:

```ts
  const unplacedFragments = safe(
    sink,
    'section:giga_usf',
    () => extractUnplacedFragments(pick('giga_usf'), sink),
    reason => absentUnplacedFragments(errorMeta('giga_usf', reason))
  )
```

and add `unplacedFragments,` to the returned report object after `trees`. Re-export the new
types and `parseLongId`/`uniprotUrl` from `src/features/build/model/index.ts` alongside the
existing ones.

- [ ] **Step 6: Run** the new suite → PASS (7). Then `npm test` and `npm run type-check`:
  `parse.totality` / `parse.determinism` must stay green. If a totality test enumerates
  `BuildReport` keys, add `unplacedFragments` to its expectation — that is the one legitimate
  expectation change in this plan.

- [ ] **Step 7: Stage** all files touched in this task.

---

### Task 4: The view

**Files:**
- Create: `src/features/trees/components/UnplacedFragmentsReport.tsx`
- Modify: `src/features/reports/registry.tsx`
- Test: `tests/features/trees/UnplacedFragmentsReport.test.tsx`

**Interfaces:**
- Consumes: `BuildReport.unplacedFragments`, `parseLongId`, `uniprotUrl`, `selectSpecies` (buildSlice action), `DataTable`, `FilterRow`, `Panel`, `CopyButton`, `StatusChip`, `SectionHeading` from `@/@panther.core/components`.
- Produces: `UnplacedFragmentsReportView({ report })` (named, for tests) and a default export
  that reads `useBuildReport()`; registry entry `key: 'giga-usf'`, `sectionIds: ['giga_usf']`.

Behaviour, which the tests pin:

1. Header line: `N of M books had sequences GIGA could not place · K sequences`, then a mapping
   line: `U unassigned in the post-GIGA mapping` — or, when `unassignedInMapping` is null, a
   warn chip: "post-GIGA mapping not checked: these may still carry a family assignment".
2. One text filter (Mantine `TextInput`, label "Filter families") matching **family id, oscode or
   accession** — typing `P00008` narrows the family table to `PTHR10002`. `FilterRow.summary`
   always says `x of y families`.
3. Family `DataTable`: columns Family (mono), Unplaced (number), Tree leaves (number, `—` when
   null), Share unplaced (percent, one decimal, `—` when null). Default sort Unplaced desc. `onRowClick` selects;
   `selectedRowKey` shows it. No `completeness` prop — the table is complete by contract.
4. Member panel for the selected family: `DataTable` with Species (button → dispatches
   `selectSpecies(oscode)`, opening the existing species drawer), Gene (`HGNC=1084`, mono),
   UniProt (external link via `uniprotUrl`, `target="_blank" rel="noreferrer"`), Long ID (mono).
   `CopyButton` with `value={members.join('\n')}` labelled "Copy long IDs".
   When `members === null`: an honest notice — "This report left these IDs out to stay small.
   They are in `books/<PTHR>/orig/tree/<PTHR>.orig.usf` on the cluster." — never an empty table.
5. Absent section: `Panel availability` shows the generator's message; no table.
6. Generator warnings listed at the foot, same markup as `ProteomesReport`.

- [ ] **Step 1: Failing tests**

```tsx
import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@tests/test-utils'
import { getFixtureReport } from '@/features/build/fixtures'
import { UnplacedFragmentsReportView } from '@/features/trees/components/UnplacedFragmentsReport'
import { getReportRenderer } from '@/features/reports/registry'

const report = getFixtureReport('gigaUsf')
const renderView = (r = report) => renderWithProviders(<UnplacedFragmentsReportView report={r} />)

describe('UnplacedFragmentsReport', () => {
  it('is the renderer for giga_usf', () => {
    expect(getReportRenderer('giga_usf')?.key).toBe('giga-usf')
  })

  it('lists every family with unplaced sequences', () => {
    renderView()
    const table = screen.getByRole('table', { name: /families with unplaced fragments/i })
    expect(within(table).getByText('PTHR10000')).toBeInTheDocument()
    expect(within(table).getByText('PTHR10001')).toBeInTheDocument()
    expect(within(table).getByText('PTHR10002')).toBeInTheDocument()
  })

  it('shows the long IDs of the family you pick, split into species, gene and accession', async () => {
    renderView()
    await userEvent.click(screen.getByText('PTHR10002'))
    const members = screen.getByRole('table', { name: /unplaced in PTHR10002/i })
    expect(within(members).getByText('MOUSE|MGI=MGI=9|UniProtKB=Q00009')).toBeInTheDocument()
    expect(within(members).getByRole('link', { name: 'Q00009' })).toHaveAttribute(
      'href',
      'https://www.uniprot.org/uniprotkb/Q00009/entry'
    )
  })

  it('finds a family by the accession of a kicked-out sequence', async () => {
    renderView()
    await userEvent.type(screen.getByLabelText(/filter families/i), 'P00008')
    const table = screen.getByRole('table', { name: /families with unplaced fragments/i })
    expect(within(table).getByText('PTHR10002')).toBeInTheDocument()
    expect(within(table).queryByText('PTHR10001')).not.toBeInTheDocument()
    expect(screen.getByText(/1 of 3 families/)).toBeInTheDocument()
  })

  it('says whether the post-GIGA mapping has unassigned them', () => {
    renderView()
    expect(screen.getByText(/9 unassigned in the post-GIGA mapping/i)).toBeInTheDocument()
  })

  it('warns when the mapping was never checked, rather than implying it was', () => {
    const unchecked = getFixtureReport('gigaUsf')
    renderView({
      ...unchecked,
      unplacedFragments: { ...unchecked.unplacedFragments, unassignedInMapping: null },
    })
    expect(screen.getByText(/post-GIGA mapping not checked/i)).toBeInTheDocument()
  })

  it('says where the IDs are when the report left them out, instead of showing none', async () => {
    renderView()
    await userEvent.click(screen.getByText('PTHR10000'))
    expect(screen.getByText(/left these IDs out/i)).toBeInTheDocument()
    expect(screen.getByText(/PTHR10000\.orig\.usf/)).toBeInTheDocument()
    expect(screen.queryByRole('table', { name: /unplaced in PTHR10000/i })).not.toBeInTheDocument()
  })

  it('does not claim zero families on a report without the section', () => {
    renderView(getFixtureReport('real'))
    expect(screen.queryByRole('table', { name: /families with unplaced fragments/i })).toBeNull()
    expect(screen.queryByText(/^0 of/)).toBeNull()
  })
})
```

(Check `@testing-library/user-event` is in devDependencies — it is used elsewhere in `tests/`;
if not, use `fireEvent` from RTL instead.)

- [ ] **Step 2: Run** `npx vitest run tests/features/trees/UnplacedFragmentsReport.test.tsx` → FAIL.

- [ ] **Step 3: Implement the view**

```tsx
import { TextInput } from '@mantine/core'
import { useMemo, useState } from 'react'
import {
  CopyButton,
  DataTable,
  FilterRow,
  Panel,
  SectionHeading,
  StatusChip,
} from '@/@panther.core/components'
import type { DataColumn } from '@/@panther.core/components'
import { formatCount } from '@/app/format'
import { useAppDispatch } from '@/app/hooks'
import { useBuildReport } from '@/features/build/hooks'
import { parseLongId, uniprotUrl } from '@/features/build/model'
import type { BuildReport, LongId, UnplacedFamilyRow } from '@/features/build/model'
import { selectSpecies } from '@/features/build/slices/buildSlice'

/**
 * Who GIGA left out of each tree.
 *
 * The family table is the navigation; the member table is the answer. The filter matches the
 * members as well as the family id, because the question a reviewer usually arrives with is
 * "where did Q12983 go?", not "what is in PTHR10057?".
 *
 * `members === null` is a family whose ids the report dropped to stay small. It is shown as
 * that, with the path to the file, and never as an empty list - "none were unplaced" is the
 * opposite claim.
 */

const dash = <span className="text-ink-faint">—</span>

const familyColumns: readonly DataColumn<UnplacedFamilyRow>[] = [
  { id: 'family', header: 'Family', kind: 'mono', sortValue: row => row.family },
  { id: 'unplaced', header: 'Unplaced', kind: 'number', sortValue: row => row.unplaced },
  {
    id: 'leaves',
    header: 'Tree leaves',
    kind: 'number',
    sortValue: row => row.treeLeaves,
    render: row => (row.treeLeaves === null ? dash : formatCount(row.treeLeaves)),
  },
  {
    id: 'fraction',
    header: 'Share unplaced',
    kind: 'number',
    sortValue: row => row.unplacedFraction,
    render: row =>
      row.unplacedFraction === null ? dash : `${(row.unplacedFraction * 100).toFixed(1)}%`,
  },
]

function matches(row: UnplacedFamilyRow, needle: string): boolean {
  if (row.family.toLowerCase().includes(needle)) return true
  return (row.members ?? []).some(id => id.toLowerCase().includes(needle))
}

const MemberTable = ({ family }: { family: UnplacedFamilyRow }) => {
  const dispatch = useAppDispatch()
  const rows = useMemo(() => (family.members ?? []).map(parseLongId), [family])
  const columns: readonly DataColumn<LongId>[] = [
    {
      id: 'species',
      header: 'Species',
      kind: 'node',
      sortValue: row => row.oscode,
      render: row =>
        row.oscode === null ? (
          dash
        ) : (
          <button type="button" className="pb-ident text-accent" onClick={() => dispatch(selectSpecies(row.oscode))}>
            {row.oscode}
          </button>
        ),
    },
    {
      id: 'gene',
      header: 'Gene',
      kind: 'mono',
      sortValue: row => row.geneId,
      render: row => (row.geneId === null ? dash : `${row.geneSource}=${row.geneId}`),
    },
    {
      id: 'uniprot',
      header: 'UniProt',
      kind: 'node',
      sortValue: row => row.accession,
      render: row =>
        row.accession === null ? (
          dash
        ) : (
          <a className="pb-ident text-accent" href={uniprotUrl(row.accession)} target="_blank" rel="noreferrer">
            {row.accession}
          </a>
        ),
    },
    { id: 'raw', header: 'Long ID', kind: 'mono', sortValue: row => row.raw },
  ]

  if (family.members === null) {
    return (
      <p className="text-ink-muted text-2xs">
        {formatCount(family.unplaced)} sequences were unplaced in {family.family}. This report left
        these IDs out to stay small. They are in{' '}
        <code className="pb-ident">
          books/{family.family}/orig/tree/{family.family}.orig.usf
        </code>{' '}
        on the cluster.
      </p>
    )
  }
  return (
    <DataTable
      caption={`Unplaced in ${family.family}`}
      columns={columns}
      rows={rows}
      rowKey={row => row.raw}
      pageSize={50}
      density="tight"
      filters={
        <FilterRow actions={<CopyButton value={family.members.join('\n')} label="Copy long IDs" />}>
          <span />
        </FilterRow>
      }
    />
  )
}

export interface UnplacedFragmentsReportViewProps {
  report: BuildReport
}

export const UnplacedFragmentsReportView = ({ report }: UnplacedFragmentsReportViewProps) => {
  const summary = report.unplacedFragments
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)

  const needle = query.trim().toLowerCase()
  const visible = useMemo(
    () =>
      summary.families.filter(
        row => needle === '' || matches(row, needle)
      ),
    [summary.families, needle]
  )
  const selectedRow = summary.families.find(row => row.family === selected) ?? null
  const present = summary.availability === 'present'

  return (
    <Panel
      title="Unplaced fragments"
      subtitle="giga_usf"
      availability={present ? 'available' : summary.availability}
      message={summary.message ?? undefined}
      missingSubject="unplaced fragments"
    >
      {present && (
        <div className="space-y-gutter">
          <p className="pb-figures text-ink-muted text-xs">
            {formatCount(summary.familiesWithUnplaced)} of {formatCount(summary.booksScanned)} books
            had sequences GIGA could not place · {formatCount(summary.unplacedTotal)} sequences
          </p>
          {summary.unassignedInMapping === null ? (
            <p className="text-2xs">
              <StatusChip status="warn" size="sm" /> post-GIGA mapping not checked: these may
              still carry a family assignment there.
            </p>
          ) : (
            <p className="pb-figures text-ink-muted text-2xs">
              {formatCount(summary.unassignedInMapping)} unassigned in the post-GIGA mapping
            </p>
          )}
          <DataTable
            caption="Families with unplaced fragments"
            columns={familyColumns}
            rows={visible}
            rowKey={row => row.family}
            defaultSort={{ columnId: 'unplaced', direction: 'desc' }}
            onRowClick={row => setSelected(row.family)}
            selectedRowKey={selected}
            pageSize={25}
            maxHeight={480}
            filters={
              <FilterRow summary={`${visible.length} of ${summary.families.length} families`}>
                <TextInput
                  label="Filter families"
                  placeholder="PTHR id, oscode or accession"
                  value={query}
                  onChange={event => setQuery(event.currentTarget.value)}
                  size="xs"
                />
              </FilterRow>
            }
          />
          {selectedRow && (
            <section>
              <SectionHeading level={3} count={`${formatCount(selectedRow.unplaced)} sequences`}>
                {selectedRow.family}
              </SectionHeading>
              <MemberTable family={selectedRow} />
            </section>
          )}
          {summary.warnings.length > 0 && (
            <section>
              <SectionHeading level={3}>Generator warnings</SectionHeading>
              <ul aria-label="Generator warnings" className="mt-1.5 space-y-1">
                {summary.warnings.map(warning => (
                  <li key={warning} className="text-ink-faint text-2xs">
                    <StatusChip status="warn" variant="quiet" size="sm" /> <span>{warning}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </Panel>
  )
}

const UnplacedFragmentsReport = () => <UnplacedFragmentsReportView report={useBuildReport()} />

export default UnplacedFragmentsReport
```

Adapt to the real component APIs before running — verify against the source, do not guess:
`Panel`'s `availability` values (`Availability` type), `StatusChip` props (does it take `label`?),
`formatCount`'s null handling, and whether `selectSpecies` is exported from the slice module or
only through `useSelectSpecies`-style hooks in `features/build/hooks.ts` (prefer the hook if one
exists). The filter input label must stay "Filter families" and the member caption
"Unplaced in <PTHR>" — the tests query by them.

In `registry.tsx`:

```ts
const UnplacedFragmentsReport = lazy(
  () => import('@/features/trees/components/UnplacedFragmentsReport')
)
// in SPECIALISED_RENDERERS, after 'proteomes':
  {
    key: 'giga-usf',
    title: 'Unplaced fragments',
    sectionIds: ['giga_usf'],
    Component: UnplacedFragmentsReport,
  },
```

- [ ] **Step 4: Run** the view suite → PASS (8). Then `npm test`, `npm run type-check`, `npm run lint`.
- [ ] **Step 5: Look at it.** `npm run dev`, switch the fixture state to "With unplaced
  fragments", open Tree building (GIGA): the table sits under the `giga` report, a row click
  shows members, the species button opens the species drawer, dark mode is legible.
- [ ] **Step 6: Stage** the new view, test and `registry.tsx`.

---

### Task 5: Live data

Only after `panther_build` Task 3 has regenerated the report.

- [ ] `cp` the new `build_state.json` into `docs/`, run `npm test`. `liveReport.contract.test.ts`
  must pass untouched (every section id known and placed); `liveReport.render.test.tsx` must
  mount clean. If contract is red, the fix is Tasks 1–4, never an exception.
- [ ] `ls -la docs/build_state.json` and `npm run build`; record the bundle size delta here. If
  it grew more than ~1.5 MB, lower `MAX_MEMBERS` in the pipeline plan rather than shipping it.
- [ ] Update `docs/ui-roadmap.md` inventory with the new section (verified).

---

## Phase 2 — easy wins (optional, each independent; do after Task 4)

### Task 6: Species cross-section gains "unplaced by GIGA"

`summary.bySpecies` already carries `{oscode, unplaced, families}`. Join it in `model/species.ts`
as one more source on `SpeciesRecord` (`unplacedFragments: { unplaced, families } | null`,
null = not in this source — **not** zero, per `species.ts`'s own rule), and show it as one row in
`SpeciesDetail`. A proteome with a disproportionate share of fragments is a QC signal about the
proteome, not the family, and this is the only place that pivot is visible.

- [ ] Test (species.test.ts): under `gigaUsf`, `byOscode.MOUSE.unplacedFragments` is
  `{ unplaced: 5, families: 1 }`; under `real` it is `null`.
- [ ] Implement the join and the `SpeciesDetail` row.

### Task 7: Empty-tree and post-GIGA-removed families in the same view

Pipeline plan Tasks 6–7 add `"Families with an empty tree"` (to `giga`) and
`"Families removed after GIGA (single genome)"`. Render both as compact family lists under the
unplaced table, via a `Disclosure` each, with counts in the summary line. Absent table → no
disclosure (stage not reached), empty table → "none".
