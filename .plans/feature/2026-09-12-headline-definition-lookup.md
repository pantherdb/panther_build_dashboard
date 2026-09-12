# Headline Definition Lookup — Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a generator-supplied definition resolve for a section's `headline` and `rows[].metric` keys, not just for cells in a table's `defines` column — so a figure like `sequences_in_inherited_families` shows a real label and explanation instead of the raw key.

**Architecture:** `GenericField` gains a `definitionId: string | null`, set by `describeField` only when the owning section actually defines that key. Curated metrics keep absolute precedence: `definitionId` is consulted only where `metricId` is `null`. Rendering then routes through the existing `MetricValue`, which already reads the merged curated+generator registry, so no new lookup machinery is needed.

**Tech Stack:** React 19, TypeScript, Vitest + Testing Library, Mantine (`Tooltip` only), Tailwind.

**Spec:** `../panther_build/.specs/2026-09-11-reclustering-and-bucket-definitions-design.md` §5.1 and §6.3. **Note:** §5.1 currently carries a "Narrowed during implementation" paragraph saying only the `defines` path was built. This plan un-narrows it. Task 5 updates that paragraph — do not leave the spec contradicting the code.

**Sibling plan:** `panther_build/.plans/2026-09-12-headline-metric-definitions.md` supplies the definitions this plan makes visible. **This plan does not depend on it** — every task here is tested against a synthetic payload, and an undefined key still falls back to today's behaviour.

## Global Constraints

- `npm test` is **852 passing across 64 files**. It must stay green. Never loosen or delete an existing assertion.
- Never hand-edit `docs/build_state.json` or `tests/fixtures/build_state.reference.json`. Both are generator output.
- **Curated wins, always.** A generator definition may only fill a slot where `resolveMetricId` returned `null`. If you find yourself writing a comparison between a curated and a generated definition, stop — the design is that the question cannot arise.
- **Never invent a label.** Where neither a curated metric nor a generator definition resolves, the existing `ReportKeyLabel` behaviour stays exactly as it is: the report's own key, verbatim, in mono, with the honest "no definition is registered" tooltip. That fallback is deliberate and is not what this plan replaces.
- Every model function stays TOTAL: malformed input degrades through the `NoteSink`, never throws.
- `src/@panther.core/` stays free of feature knowledge, in code and in comments.
- `import type` for type-only imports. Prettier: no semicolons, single quotes, 2-space indent, 100-char width, `arrowParens: avoid`.
- Only `tests/**/*.test.{ts,tsx}` is collected by Vitest. `renderWithProviders` is at `@tests/test-utils`.
- Comments explain WHY, not what.
- Verify with `npm test`, `npm run type-check`, `npm run lint`. All three must pass.
- Do not commit. Stage with `git add`; the user commits.

---

### Task 1: Carry a definition id on every generic field

**Files:**
- Modify: `src/features/reports/model/genericView.ts:39-53` (`GenericField`), `:129-160` (`describeField`)
- Test: `tests/features/reports/genericView.test.ts`

**Interfaces:**
- Consumes: `GenericSectionView.definitions` (a `GeneratorDefinition[]` of `{term, label, definition}`) and `generatorDefinitionId(sectionId, term)`, both already exported from `@/features/build/model`.
- Produces: `GenericField.definitionId: string | null` — the namespaced registry id when the owning section defines this key, else `null`. Task 2 renders from it.

**Background you need.** `describeField(path, key, value, sectionId)` is the single builder for every generic field; all five call sites already pass `entry.sectionId`. It currently calls `resolveMetricId(key, sectionId)`, which consults three CURATED sources only — the `other_reports` key map, curated metrics' declared `source` paths, and the snake→camel form of the key. It never sees generator definitions. That is the gap.

`describeField` does not currently receive the section's definitions. You need to thread them in. The definitions live on `entry.generic.definitions` at the call sites in `readGenericSection` and `preservedFields`. Prefer passing a prepared lookup (a `Set<string>` of defined terms, or a small helper) rather than the whole array, so the function does no repeated scanning — check the call sites and pick whichever keeps them readable.

- [ ] **Step 1: Write the failing test**

Append to `tests/features/reports/genericView.test.ts`, matching the file's existing import and helper style — read the top of the file first:

```ts
describe('generator definitions on headline fields', () => {
  it('sets a namespaced definitionId for a key the section defines', () => {
    const view = readGenericSection(
      entryWith('recluster', {
        headline: { families_created: 153 },
        definitions: {
          families_created: {
            label: 'New families created',
            definition: 'Families minted by reclustering.',
          },
        },
      })
    )
    const field = view.headline.find(entry => entry.key === 'families_created')
    expect(field?.definitionId).toBe('recluster.families_created')
  })

  it('leaves definitionId null for a key the section does not define', () => {
    const view = readGenericSection(
      entryWith('recluster', {
        headline: { clusters_formed: 41234 },
        definitions: {
          families_created: { label: 'New families created', definition: 'x' },
        },
      })
    )
    expect(view.headline.find(entry => entry.key === 'clusters_formed')?.definitionId).toBeNull()
  })

  it('sets definitionId on rows[].metric keys too, not only headline keys', () => {
    const view = readGenericSection(
      entryWith('recluster', {
        rows: [{ metric: 'families_created', value: 153 }],
        definitions: {
          families_created: { label: 'New families created', definition: 'x' },
        },
      })
    )
    expect(view.rows[0]?.definitionId).toBe('recluster.families_created')
  })

  it('never lets a generator definition displace a curated metric', () => {
    // `genomes` resolves to a curated metric via the library section's source path.
    const view = readGenericSection(
      entryWith('library', {
        headline: { genomes: 131 },
        definitions: { genomes: { label: 'WRONG', definition: 'WRONG' } },
      })
    )
    const field = view.headline.find(entry => entry.key === 'genomes')
    expect(field?.metricId).not.toBeNull()
  })

  it('degrades to null rather than throwing when definitions are malformed', () => {
    const view = readGenericSection(
      entryWith('recluster', { headline: { families_created: 153 }, definitions: 'nonsense' })
    )
    expect(view.headline.find(entry => entry.key === 'families_created')?.definitionId).toBeNull()
  })
})
```

> `entryWith(sectionId, data)` is a sketch. Check how this suite already builds a `ReportRegistryEntry` — it must go through the real `parse`/`buildGenericView` path so `generic.definitions` is populated the way production does it, not hand-assembled. Reuse the existing helper if there is one; add one in this file's style if not.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/features/reports/genericView.test.ts`
Expected: FAIL — `definitionId` is `undefined`.

- [ ] **Step 3: Add the field to the type**

In `src/features/reports/model/genericView.ts`, add to `GenericField` beside `metricId`:

```ts
  /**
   * The generator's own definition for this key, namespaced `section.term`, when the owning
   * section supplied one. Consulted ONLY where `metricId` is null: a curated definition always
   * wins, so the two can never disagree on screen.
   */
  definitionId: string | null
```

- [ ] **Step 4: Set it in `describeField`**

Thread the section's defined terms into `describeField` and set the field:

```ts
  // Namespaced, so a generator term can extend the registry but never collide with a curated id.
  // Set only when the section really defines the key: pointing at an id the registry does not
  // hold would render "no definition registered", which is worse than the honest raw key.
  const definitionId =
    metricId === null && sectionId !== undefined && definedTerms?.has(key) === true
      ? generatorDefinitionId(sectionId, key)
      : null
```

Import `generatorDefinitionId` from `@/features/build/model`. Update all five `describeField` call sites to pass the terms; `readGenericSection` and `preservedFields` both have `entry.generic.definitions` in hand.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/features/reports/genericView.test.ts && npm test && npm run type-check`
Expected: PASS. `GenericField` gained a required field, so any object literal building one in a test helper needs `definitionId: null` — that is the type system doing its job.

- [ ] **Step 6: Stage**

```bash
git add src/features/reports/model/genericView.ts tests/features/reports/genericView.test.ts
```

---

### Task 2: Render the definition instead of the raw key

**Files:**
- Modify: `src/features/reports/components/GenericFields.tsx:74-95` (`GenericFigure`), `:140-156` (`GenericFieldRows`)
- Test: `tests/features/reports/GenericFields.test.tsx` (create if absent — check first)

**Interfaces:**
- Consumes: `GenericField.definitionId` from Task 1.
- Produces: no new exports. Behaviour only.

**Background.** `GenericFigure` renders through `MetricValue` when `field.metricId !== null`, and otherwise falls back to `ReportKeyLabel`, whose tooltip says "No specialised view or metric definition is registered for it". `GenericFieldRows` makes the same choice for its label. `MetricValue` takes a `metricId` STRING and looks it up in the definitions registry supplied by `MetricDefinitionsProvider` — which since the previous change already holds generator entries keyed `section.term`. So a `definitionId` can be handed straight to `MetricValue` and it resolves with no other change.

Precedence must read as one ordered decision in the code: curated metric, then generator definition, then the honest raw key.

- [ ] **Step 1: Write the failing test**

```tsx
const REGISTRY = {
  'recluster.sequences_in_inherited_families': {
    id: 'recluster.sequences_in_inherited_families',
    label: 'Sequences clustered into existing families',
    description: 'Sequences placed in families that already existed in the previous library.',
  },
}

const fieldOf = (overrides: Partial<GenericField>): GenericField => ({
  path: 'sequences_in_inherited_families',
  key: 'sequences_in_inherited_families',
  value: 4312,
  kind: 'scalar',
  formatted: '4,312',
  metricId: null,
  definitionId: 'recluster.sequences_in_inherited_families',
  namedVariable: false,
  ambiguousTerm: true,
  ...overrides,
})

describe('GenericFigure with a generator definition', () => {
  it('shows the generator label instead of the raw key', () => {
    renderWithProviders(
      <MetricDefinitionsProvider registry={REGISTRY}>
        <GenericFigure field={fieldOf({})} />
      </MetricDefinitionsProvider>
    )
    expect(screen.getByText('Sequences clustered into existing families')).toBeInTheDocument()
    expect(screen.queryByText('sequences_in_inherited_families')).not.toBeInTheDocument()
  })

  it('keeps the honest raw key when nothing defines it', () => {
    renderWithProviders(
      <MetricDefinitionsProvider registry={{}}>
        <GenericFigure field={fieldOf({ definitionId: null })} />
      </MetricDefinitionsProvider>
    )
    expect(screen.getByText('sequences_in_inherited_families')).toBeInTheDocument()
  })

  it('reveals the definition on keyboard focus', async () => {
    renderWithProviders(
      <MetricDefinitionsProvider registry={REGISTRY}>
        <GenericFigure field={fieldOf({})} />
      </MetricDefinitionsProvider>
    )
    await userEvent.tab()
    expect(
      await screen.findByText(/already existed in the previous library/)
    ).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/features/reports/GenericFields.test.tsx`
Expected: FAIL — the raw key renders.

- [ ] **Step 3: Add the middle branch**

In `GenericFigure`:

```tsx
export const GenericFigure = ({ field }: FieldLabelProps) => {
  // Curated first, then the generator's own vocabulary, then the honest raw key. A curated
  // definition carries ambiguity notes and metric-family grouping the generator contract does
  // not, which is why it wins outright rather than merging.
  const registryId = field.metricId ?? field.definitionId
  if (registryId !== null) {
    return (
      <MetricValue
        metricId={registryId}
        value={numericValue(field.value) ?? field.formatted}
        layout="stack"
      />
    )
  }

  return (
    <div className="flex flex-col gap-px" data-generic-figure={field.key}>
      <ReportKeyLabel field={field} />
      <span className="pb-figures text-ink text-sm leading-tight">{field.formatted}</span>
    </div>
  )
}
```

Make the same three-way choice in `GenericFieldRows`'s `label`. `MetricLabel` takes a `MetricId` and reads the curated model map, so it cannot serve a generator id — use `MetricValue`'s label path or a small shared helper rather than widening `MetricLabel`'s type. Decide which and say so in your report.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/features/reports/ && npm test && npm run type-check && npm run lint`
Expected: PASS.

- [ ] **Step 5: Stage**

```bash
git add src/features/reports/components/GenericFields.tsx tests/features/reports/GenericFields.test.tsx
```

---

### Task 3: Curate the seventh sequence count

**Files:**
- Modify: `src/features/build/model/definitions.ts`
- Modify: `src/features/build/model/types.ts` (the `MetricId` union)
- Test: `tests/features/build/model/definitions.test.ts`

**Interfaces:**
- Consumes: nothing from Tasks 1-2.
- Produces: a curated `MetricId` for the reclustering sequence counts, which by the precedence rule wins over the generator's.

**Why this is worth doing even though Task 1 would cover it.** `definitions.ts` exists to stop this report's sequence counts being confused with one another — its header says so, and `SEQUENCE_METRIC_IDS` groups the six it already knows. `sequences_in_inherited_families` and `sequences_in_new_families` are a seventh and eighth. The curated shape carries `ambiguityNote`, `shortLabel` and `family`, which the generator's `{label, definition}` cannot express. This is exactly the case the curated registry was built for.

- [ ] **Step 1: Write the failing test**

```ts
it('disambiguates the two reclustering sequence counts', () => {
  const inherited = METRIC_DEFINITIONS.reclusteredIntoExistingFamilies
  const created = METRIC_DEFINITIONS.reclusteredIntoNewFamilies
  expect(inherited.family).toBe('sequences')
  expect(created.family).toBe('sequences')
  // The whole point: a reader must be able to tell them apart from the label alone.
  expect(inherited.label).not.toBe(created.label)
  expect(inherited.ambiguityNote).toBeDefined()
  expect(created.ambiguityNote).toBeDefined()
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/features/build/model/definitions.test.ts`
Expected: FAIL — the ids do not exist.

- [ ] **Step 3: Add the two definitions**

Add `'reclusteredIntoExistingFamilies'` and `'reclusteredIntoNewFamilies'` to the `MetricId` union in `types.ts`, and to `SEQUENCE_METRIC_IDS` if that list is meant to be exhaustive — check its comment before assuming. Then in `definitions.ts`, beside the other sequence counts:

```ts
  {
    id: 'reclusteredIntoExistingFamilies',
    label: 'Sequences clustered into existing families',
    shortLabel: 'Into existing fams',
    definition:
      'Sequences that were unassigned after HMM scoring, were clustered by TribeMCL, and landed ' +
      'in a family that already existed in the PREVIOUS library — the cluster reclaimed that ' +
      'family rather than creating one.',
    unit: 'count',
    family: 'sequences',
    source: 'recluster.headline.sequences_in_inherited_families',
    ambiguityNote:
      'Reclaiming is not creating. Disjoint from the sequences in families this build minted; ' +
      'the report calls these "inherited" because the family is inherited from the previous library.',
  },
  {
    id: 'reclusteredIntoNewFamilies',
    label: 'Sequences in newly created families',
    shortLabel: 'Into new fams',
    definition:
      'Sequences that were unassigned after HMM scoring, were clustered by TribeMCL, and became ' +
      'the founding members of a PANTHER family this build created.',
    unit: 'count',
    family: 'sequences',
    source: 'recluster.headline.sequences_in_new_families',
    ambiguityNote:
      'These are the sequences the families-created figure is built from. Disjoint from the ' +
      'sequences that went into families reclaimed from the previous library.',
  },
```

The `source` paths matter: `resolveMetricId` reads `METRIC_BY_SOURCE_PATH` keyed `sectionId.key`, so these must be exactly `recluster.headline.<key>` or the lookup will miss. **Verify the format against neighbouring entries** — some use `section.headline.key` and some `section.key`, and picking the wrong one silently fails.

- [ ] **Step 4: Run the tests**

Run: `npm test && npm run type-check`
Expected: PASS. Some suite may assert the count of curated ids or of `SEQUENCE_METRIC_IDS` — if so, update that expected number; it is a real consequence of adding metrics, not a test to loosen.

- [ ] **Step 5: Verify the curated definition actually wins**

Add to `tests/features/reports/genericView.test.ts`:

```ts
it('prefers the curated reclustering metric over the generator definition', () => {
  const view = readGenericSection(
    entryWith('recluster', {
      headline: { sequences_in_inherited_families: 4312 },
      definitions: {
        sequences_in_inherited_families: { label: 'GENERATOR', definition: 'GENERATOR' },
      },
    })
  )
  const field = view.headline.find(entry => entry.key === 'sequences_in_inherited_families')
  expect(field?.metricId).toBe('reclusteredIntoExistingFamilies')
  expect(field?.definitionId).toBeNull()
})
```

- [ ] **Step 6: Run and stage**

Run: `npm test && npm run type-check && npm run lint`

```bash
git add src/features/build/model/definitions.ts src/features/build/model/types.ts \
        tests/features/build/model/definitions.test.ts tests/features/reports/genericView.test.ts
```

---

### Task 4: Documentation

**Files:**
- Modify: `docs/ui-roadmap.md`
- Modify: `../panther_build/.specs/2026-09-11-reclustering-and-bucket-definitions-design.md` §5.1

- [ ] **Step 1: Un-narrow the spec**

§5.1 of the spec carries a paragraph beginning "**Narrowed during implementation, 2026-09-11.**" which says only the `defines` column path was built and the other two were not. That is no longer true. Rewrite it to record what now exists: the `defines` table-cell path and the headline / `rows[].metric` path, both resolving generator definitions, with curated metrics taking precedence. Keep it as a dated amendment rather than deleting the history — the narrowing and its reversal are both part of how this landed.

- [ ] **Step 2: Correct the roadmap**

`docs/ui-roadmap.md` carries a dated paragraph stating three lookup paths were narrowed to one. Update it the same way, and say plainly which figures now resolve: any headline or metric key the generator defines, plus the curated reclustering sequence counts which take precedence over the generator's.

- [ ] **Step 3: Remove the follow-up that no longer applies**

`../panther_build/.plans/2026-08-13-build-state-report-follow-ups.md` has a bullet beginning "**Generator definitions resolve only in a `defines` table column.**" That deferral is now done. Replace it with a one-line note that it landed on 2026-09-12, rather than deleting it silently.

- [ ] **Step 4: Verify and stage**

Run: `npm test && npm run type-check && npm run lint`

```bash
git add docs/ui-roadmap.md
git -C ../panther_build add .specs/2026-09-11-reclustering-and-bucket-definitions-design.md \
                            .plans/2026-08-13-build-state-report-follow-ups.md
```

---

## Notes

- **Why `MetricValue` needs no change.** It already takes `metricId` as a plain string and resolves it against the provider registry, which holds curated and generator entries together. Handing it a `section.term` id is not a special case — it is the ordinary path.
- **Why `describeField` and not `resolveMetricId`.** `resolveMetricId` returns a `MetricId`, a closed union of curated ids. A generator id is not a member of it and must not be forced into it; keeping them as two separate fields is what makes "curated wins" checkable by reading one line.
- **The fallback is not a bug.** `ReportKeyLabel`'s "no definition is registered" tooltip is the correct answer for a key nothing defines, and stays. This plan reduces how often it fires; it does not remove it.
