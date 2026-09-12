# Reclustering Section & Generator-Supplied Definitions — Dashboard Implementation Plan

**Status:** COMPLETE (2026-09-11) — all 8 tasks implemented and reviewed. `npm test` 842 passing
across 64 files, up from 801/56; type-check and lint clean. Staged, not committed.

## Summary

The `recluster` section is known, bound to the sequence-to-family-mapping phase, and renders
through the generic renderer. Generator-supplied definitions are parsed, namespaced `section.term`,
merged into the metric-definitions registry, and surfaced as hover text on the column a table marks
with `defines` — and on metric labels, which are now keyboard-reachable for the first time. The
glance row leads with the number of families the build created.

Corrections made against this plan during execution, all reviewed:
- The plan's `tests/support/reclusterSection.ts` approach was replaced by a `recluster` FIXTURE
  STATE (`withRecluster()` in `fixtures/transforms.ts`). The report is not in the Redux store, so a
  component test selects a fixture key rather than being handed a report.
- `selectBuildReport` (sketched in Task 2) does not exist; `useBuildReport()` is used in `App`.
- `resolveBinding()` returns no `contributingPhaseIds`; the Task 6 assertion uses `getBinding()`.
- `DefinedTerm` gained a `label` override so the dashboard's curated `MECHANISM_LABELS` beat the
  generator's, and a bug was caught where curated prose rendered with identifier styling.
- Mantine's `Tooltip` needed `events.focus` enabling theme-wide; without it a `tabIndex` is inert.
- **Scope narrowed:** the spec promised three definition lookup paths (headline keys,
  `rows[].metric` keys, `defines` cells). Only the `defines` column path was built — nothing needed
  the others, since every vocabulary here defines bucket strings that appear in table cells. See
  `../panther_build/.specs/2026-09-11-reclustering-and-bucket-definitions-design.md` §5.1, narrowed
  in place, and the follow-ups list in that repo.
- The task code blocks below are the plan as written and were NOT rewritten to match the
  corrections above. Read them as the argument, not as the landed code.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bind the new `recluster` report section to the pipeline spine, lead the build record with the count of families the build created, and turn generator-supplied bucket definitions into the tooltips the dashboard already knows how to show.

**Architecture:** The section body needs no new component — the generic renderer already handles `text`, `headline`, `rows`, `tables` and `warnings`. Three things do need building: a typed `recluster` extractor so the glance panel has numbers rather than `unknown`; a definitions path that lifts `data.definitions` into the existing `MetricDefinitionsProvider` registry, namespaced by section id; and a `DefinedTerm` primitive that renders a defined bucket string with a tooltip.

**Tech Stack:** React 19, TypeScript, Redux Toolkit, Vitest + Testing Library, Mantine (`Tooltip` only), Tailwind.

**Spec:** `../panther_build/.specs/2026-09-11-reclustering-and-bucket-definitions-design.md` — read §5 and §6 before Task 1. The spec lives in the sibling repo because it describes the seam; see `pipeline_and_dashboard/CLAUDE.md`.

**Sibling plan:** `panther_build/.plans/2026-09-11-reclustering-and-bucket-definitions.md` produces the payload this plan consumes. **This plan does not depend on that one having landed** — every task here is tested against a hand-built payload, and the dashboard renders an absent `recluster` section correctly.

## Global Constraints

- `npm test` is **801 passing across 56 files**. It must stay green. Never loosen a fixture-pinned assertion to make a change fit.
- Never edit `docs/build_state.json` or `tests/fixtures/build_state.reference.json` by hand. The reference is the frozen oracle; the live file is generator output.
- The frozen reference carries **9 sections** and no `recluster`. A test needing the section selects the `recluster` FIXTURE STATE (Task 6); the report is never injected, because the store holds only a fixture key and `useBuildReport` derives the report from it.
- Generator definitions are namespaced `${sectionId}.${term}`. Curated `METRIC_DEFINITIONS` ids are camelCase and must never be displaced.
- For `mapping`, curated `MECHANISM_LABELS` win; the generator's `label` fills in only where the dashboard has none.
- Every model extractor is total: a malformed input degrades through the `NoteSink` and never throws.
- Verify with `npm test`, `npm run type-check`, `npm run lint`. Dev server is `npm run dev` on :4310.
- Do not commit. Stage with `git add`; the user commits.

---

### Task 1: Parse `data.definitions` into the model

**Files:**
- Modify: `src/features/build/model/types.ts:720-728`
- Modify: `src/features/build/model/sections/generic.ts:33-40`
- Modify: `src/features/build/model/tables.ts:25-32,66-96`
- Test: `tests/features/build/model/sections/definitions.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface GeneratorDefinition { term: string; label: string; definition: string }`
  - `GenericSectionView.definitions: GeneratorDefinition[]`
  - `NormalisedTable.definesColumn: string | null`, read from a table's `defines` key
  - Task 2 turns these into registry entries; Task 4 reads `definesColumn`.

- [ ] **Step 1: Write the failing test**

Create `tests/features/build/model/sections/definitions.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildGenericView, createNoteSink, toSectionInput } from '@/features/build/model'
import type { RawSection } from '@/features/build/model'

/**
 * Generator-supplied vocabulary (spec §5).
 *
 * A collector writes the meaning of its bucket strings beside the tuple that lists them, and the
 * envelope carries it here. These tests pin the reading, not the rendering: a malformed entry is
 * dropped rather than thrown, because a bad definition must never cost a reader the numbers.
 */
function sectionOf(data: unknown) {
  return toSectionInput(
    { id: 'recluster', title: 'Reclustering', status: 'ok', data } as RawSection,
    1
  )
}

describe('generator definitions', () => {
  it('reads each term as a definition', () => {
    const sink = createNoteSink()
    const view = buildGenericView(
      sectionOf({
        definitions: {
          new_family: { label: 'Became a new family', definition: 'Minted a new PANTHER id.' },
        },
      }),
      sink
    )
    expect(view.definitions).toEqual([
      { term: 'new_family', label: 'Became a new family', definition: 'Minted a new PANTHER id.' },
    ])
  })

  it('does not leave definitions in extra, which would render them as raw JSON', () => {
    const sink = createNoteSink()
    const view = buildGenericView(
      sectionOf({ definitions: { a: { label: 'A', definition: 'a' } } }),
      sink
    )
    expect(view.extra).not.toHaveProperty('definitions')
  })

  it('drops an entry missing a label and notes it, rather than throwing', () => {
    const sink = createNoteSink()
    const view = buildGenericView(
      sectionOf({
        definitions: {
          good: { label: 'Good', definition: 'ok' },
          bad: { definition: 'no label' },
        },
      }),
      sink
    )
    expect(view.definitions.map(entry => entry.term)).toEqual(['good'])
    expect(sink.notes.length).toBeGreaterThan(0)
  })

  it('survives definitions that are not an object at all', () => {
    const sink = createNoteSink()
    expect(buildGenericView(sectionOf({ definitions: 'nope' }), sink).definitions).toEqual([])
  })

  it('reports no definitions for a section that carries none', () => {
    const sink = createNoteSink()
    expect(buildGenericView(sectionOf({ rows: [] }), sink).definitions).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/features/build/model/sections/definitions.test.ts`
Expected: FAIL — `view.definitions` is `undefined`.

- [ ] **Step 3: Add the type**

In `src/features/build/model/types.ts`, above `GenericSectionView`:

```ts
/**
 * One term a collector defined, carried in the section's `data.definitions`.
 *
 * The pipeline writes these beside the tuple that lists its buckets, so the vocabulary travels
 * with the numbers instead of being re-guessed here. Namespaced by section id before it reaches
 * the definitions registry, so two collectors may define the same word differently.
 */
export interface GeneratorDefinition {
  term: string
  label: string
  definition: string
}
```

and add to `GenericSectionView`:

```ts
  /** Vocabulary the generator supplied for this section's bucket strings and metric keys. */
  definitions: GeneratorDefinition[]
```

- [ ] **Step 4: Parse it in the generic view**

In `src/features/build/model/sections/generic.ts`, add `'definitions'` to `GENERIC_DATA_KEYS`, and
build the list alongside `headline`:

```ts
  // A malformed entry is dropped, never thrown: the vocabulary is an aid to reading the numbers,
  // and a bad definition must not cost a reader the numbers themselves.
  const definitionsRecord = asRecord(data?.definitions)
  const definitions: GeneratorDefinition[] = []
  for (const term of Object.keys(definitionsRecord ?? {})) {
    const entry = asRecord(definitionsRecord?.[term])
    const label = asNonEmptyString(entry?.label)
    const definition = asNonEmptyString(entry?.definition)
    if (label === null || definition === null) {
      sink.add('warning', scope, `Definition \`${term}\` is missing a label or a definition; ignored.`)
      continue
    }
    definitions.push({ term, label, definition })
  }
```

Add `definitions` to the returned object, and import `GeneratorDefinition` from `../types`.

- [ ] **Step 5: Read `defines` on a table**

In `src/features/build/model/tables.ts`, add to `NormalisedTable`:

```ts
  /** Column whose cell values are terms the section defined. `null` when the table names none. */
  definesColumn: string | null
```

and in `normaliseTable`'s return:

```ts
    definesColumn: asNonEmptyString(record?.defines),
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run tests/features/build/model/sections/definitions.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 7: Run the full suite and type-check**

Run: `npm test && npm run type-check`
Expected: PASS. `GenericSectionView` gained a required field, so any object literal building one in
a test helper needs `definitions: []` added — that is the type system doing its job.

- [ ] **Step 8: Stage**

```bash
git add src/features/build/model/types.ts src/features/build/model/sections/generic.ts \
        src/features/build/model/tables.ts \
        tests/features/build/model/sections/definitions.test.ts
```

---

### Task 2: Namespace definitions into the metric registry

**Files:**
- Modify: `src/features/build/model/definitions.ts:431-433`
- Modify: `src/app/metricRegistry.ts`
- Modify: `src/App.tsx`
- Test: `tests/app/metricRegistry.test.ts` (create)

**Interfaces:**
- Consumes: `GeneratorDefinition` and `GenericSectionView.definitions` from Task 1.
- Produces:
  - `generatorDefinitionId(sectionId: string, term: string): string` → `` `${sectionId}.${term}` ``
  - `generatorDefinitions(report: BuildReport): MetricDefinitionRegistry`
  - `buildMetricRegistry(report: BuildReport | null): MetricDefinitionRegistry`
  - Tasks 3–5 resolve definitions by calling `generatorDefinitionId`.

- [ ] **Step 1: Write the failing test**

Create `tests/app/metricRegistry.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildMetricRegistry } from '@/app/metricRegistry'
import { generatorDefinitionId } from '@/features/build/model'
import { getFixtureReport } from '@/features/build/fixtures'

/**
 * Curated and generated definitions in one registry (spec §6.2).
 *
 * Namespacing rather than precedence: a generator term is keyed `section.term` and a curated id is
 * camelCase, so collision is structurally impossible and there is no rule anyone has to remember.
 */
describe('buildMetricRegistry', () => {
  it('keeps every curated definition', () => {
    const registry = buildMetricRegistry(getFixtureReport('real'))
    expect(registry.assignedSequences?.label).toBe('Sequences assigned to a family')
  })

  it('namespaces a generator term by its section id', () => {
    expect(generatorDefinitionId('recluster', 'new_family')).toBe('recluster.new_family')
  })

  it('returns only curated definitions when the report is null', () => {
    const registry = buildMetricRegistry(null)
    expect(registry.assignedSequences).toBeDefined()
    expect(Object.keys(registry).some(key => key.includes('.'))).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/app/metricRegistry.test.ts`
Expected: FAIL — `buildMetricRegistry` and `generatorDefinitionId` are not exported.

- [ ] **Step 3: Add the id builder and collector**

Append to `src/features/build/model/definitions.ts`:

```ts
/**
 * The registry key a generator-supplied term takes.
 *
 * Namespaced by section so the 433 lines of curated camelCase ids above can never be displaced,
 * and so two collectors may define the same word — `applied` means one thing under forced
 * subfamily roots and could mean another elsewhere — without interfering.
 */
export function generatorDefinitionId(sectionId: string, term: string): string {
  return `${sectionId}.${term}`
}
```

Create `src/features/build/model/generatorDefinitions.ts`:

```ts
/**
 * Generator-supplied vocabulary, flattened into definitions-registry entries.
 *
 * The dashboard curates labels for the figures it has always shown; this covers the bucket strings
 * it has always shown BARE — `applied_under_ht`, `zero_seqs_matched`, `(other)`. The meanings were
 * always written down, as comments in the pipeline; this is the path by which they reach a reader.
 */
import { generatorDefinitionId } from './definitions'
import type { BuildReport } from './types'
import type { MetricDefinitionRegistry } from '@/@panther.core/components'

export function generatorDefinitions(report: BuildReport): MetricDefinitionRegistry {
  const entries: Record<string, MetricDefinitionRegistry[string]> = {}
  for (const section of report.reports) {
    for (const entry of section.generic.definitions) {
      const id = generatorDefinitionId(section.sectionId, entry.term)
      entries[id] = {
        id,
        label: entry.label,
        description: entry.definition,
        source: `${section.sectionId}.definitions.${entry.term}`,
      }
    }
  }
  return entries
}
```

Export both from `src/features/build/model/index.ts` alongside the existing definitions exports.

- [ ] **Step 4: Make the registry report-dependent**

Rewrite `src/app/metricRegistry.ts`, keeping the existing adapter comment and extending it:

```ts
import { METRIC_DEFINITIONS, generatorDefinitions } from '@/features/build/model'
import type { BuildReport } from '@/features/build/model'
import type { MetricDefinitionRegistry } from '@/@panther.core/components'

/**
 * Adapts the model's metric definitions to the registry the shared primitives consume.
 *
 * The two shapes differ deliberately: the model's entry carries domain fields (`family`,
 * `ambiguityNote`, `shortLabel`) that a primitive has no business knowing, and the primitive's
 * entry carries only what it renders. This adapter is the single crossing point, mounted once in
 * `App`, so `MetricValue` anywhere in the tree gets the same label and the same explanation - which
 * is what stops any screen from labelling one of the six sequence counts "Sequences".
 *
 * It also merges the vocabulary the GENERATOR supplied. Those ids are namespaced `section.term`,
 * so they extend the registry and can never displace a curated entry. A null report yields the
 * curated half alone, which is what renders before a report has parsed.
 */
export const curatedRegistry: MetricDefinitionRegistry = Object.fromEntries(
  Object.values(METRIC_DEFINITIONS).map(definition => [
    definition.id,
    {
      id: definition.id,
      label: definition.label,
      description:
        definition.ambiguityNote === undefined
          ? definition.definition
          : `${definition.definition} ${definition.ambiguityNote}`,
      source: definition.source,
    },
  ])
)

export function buildMetricRegistry(report: BuildReport | null): MetricDefinitionRegistry {
  if (report === null) return curatedRegistry
  return { ...curatedRegistry, ...generatorDefinitions(report) }
}
```

> If anything still imports the old `metricRegistry` const, keep a
> `export const metricRegistry = curatedRegistry` line so those call sites keep compiling, and let
> `npm run type-check` tell you whether it is needed.

- [ ] **Step 5: Merge it in `App`**

In `src/App.tsx`, select the report and memoise the registry:

```tsx
import { useMemo } from 'react'
import { buildMetricRegistry } from '@/app/metricRegistry'
import { selectBuildReport } from '@/features/build/slices/buildSlice'

  const report = useAppSelector(selectBuildReport)
  const registry = useMemo(() => buildMetricRegistry(report), [report])
```

and pass `registry` to `MetricDefinitionsProvider`.

> Check `buildSlice`'s actual selector name and return type first — if the report is only available
> through the `useBuildReport` hook and that hook cannot be called at `App`'s level, mount a small
> `MetricDefinitions` wrapper component inside the router instead. Either placement satisfies the
> tests; do not force the store shape to fit this sketch.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/app/metricRegistry.test.ts && npm test`
Expected: PASS.

- [ ] **Step 7: Stage**

```bash
git add src/features/build/model/definitions.ts \
        src/features/build/model/generatorDefinitions.ts \
        src/features/build/model/index.ts src/app/metricRegistry.ts src/App.tsx \
        tests/app/metricRegistry.test.ts
```

---

### Task 3: The `DefinedTerm` primitive, and keyboard-reachable tooltips

**Files:**
- Create: `src/@panther.core/components/DefinedTerm.tsx`
- Modify: `src/@panther.core/components/index.ts`
- Modify: `src/@panther.core/components/MetricValue.tsx:96-118`
- Test: `tests/@panther.core/components/DefinedTerm.test.tsx` (create)

**Interfaces:**
- Consumes: `useMetricDefinition` from `@/@panther.core/components/metricDefinitions`.
- Produces: `<DefinedTerm definitionId={string} fallback={string} />` — renders the registry label with a tooltip when the id resolves, and `fallback` verbatim in mono when it does not. Task 4 renders table cells through it.

- [ ] **Step 1: Write the failing test**

Create `tests/@panther.core/components/DefinedTerm.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DefinedTerm, MetricDefinitionsProvider } from '@/@panther.core/components'
import { renderWithProviders } from '../../test-utils'

/**
 * A bucket string with its meaning attached (spec §6.3).
 *
 * The affordance must be reachable without a mouse. Every definition in this app was hover-only
 * until this component: `MetricValue` wrapped its label in a Tooltip around a plain span, which no
 * keyboard and no touch screen can reach.
 */
const REGISTRY = {
  'recluster.new_family': {
    id: 'recluster.new_family',
    label: 'Became a new family',
    description: 'Minted a new PANTHER family id.',
  },
}

const renderTerm = (definitionId: string, fallback: string) =>
  renderWithProviders(
    <MetricDefinitionsProvider registry={REGISTRY}>
      <DefinedTerm definitionId={definitionId} fallback={fallback} />
    </MetricDefinitionsProvider>
  )

describe('DefinedTerm', () => {
  it('shows the registry label in place of the raw term', () => {
    renderTerm('recluster.new_family', 'new_family')
    expect(screen.getByText('Became a new family')).toBeInTheDocument()
  })

  it('is focusable, so the definition is reachable without a mouse', async () => {
    renderTerm('recluster.new_family', 'new_family')
    await userEvent.tab()
    expect(screen.getByText('Became a new family')).toHaveFocus()
  })

  it('reveals the definition on focus', async () => {
    renderTerm('recluster.new_family', 'new_family')
    await userEvent.tab()
    expect(await screen.findByText('Minted a new PANTHER family id.')).toBeInTheDocument()
  })

  it('shows the report\'s own term verbatim when nothing defines it', () => {
    renderTerm('recluster.unknown_bucket', 'unknown_bucket')
    expect(screen.getByText('unknown_bucket')).toBeInTheDocument()
  })

  it('does not make an undefined term focusable, since there is nothing to reveal', async () => {
    renderTerm('recluster.unknown_bucket', 'unknown_bucket')
    expect(screen.getByText('unknown_bucket')).not.toHaveAttribute('tabindex')
  })
})
```

> Check `tests/test-utils.tsx` for the actual render helper's name and import path before running;
> match what the other component suites in `tests/@panther.core/components/` use.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/@panther.core/components/DefinedTerm.test.tsx`
Expected: FAIL — `DefinedTerm` is not exported.

- [ ] **Step 3: Write the component**

Create `src/@panther.core/components/DefinedTerm.tsx`:

```tsx
import clsx from 'clsx'
import { Tooltip } from '@mantine/core'
import { useMetricDefinition } from '@/@panther.core/components/metricDefinitions'

/**
 * A bucket string with its definition attached.
 *
 * The report is full of vocabulary a reader cannot decode from the string alone -
 * `applied_under_ht`, `zero_seqs_matched`, `too_small`. The pipeline has always known what those
 * mean; this is where the meaning surfaces.
 *
 * An undefined term renders VERBATIM in mono, and is not focusable: there is nothing to reveal, and
 * a focus stop that opens nothing is worse than none. It is deliberately not humanised into prose -
 * a fallback that renders `too_small` as "Too small" invents a definition rather than admitting
 * there is none, which is the failure the metric definitions registry exists to prevent.
 */
export interface DefinedTermProps {
  /** Registry key, from `generatorDefinitionId(sectionId, term)`. */
  definitionId: string
  /** The report's own string, shown when nothing defines it. */
  fallback: string
  className?: string
}

export const DefinedTerm = ({ definitionId, fallback, className }: DefinedTermProps) => {
  const definition = useMetricDefinition(definitionId)

  if (definition === null) {
    return <span className={clsx('pb-ident', className)}>{fallback}</span>
  }

  return (
    <Tooltip label={definition.description} withArrow openDelay={200} multiline maw={300}>
      <span
        tabIndex={0}
        className={clsx(
          'decoration-ink-faint cursor-help underline decoration-dotted underline-offset-2',
          'focus-visible:outline-accent rounded-xs focus-visible:outline-2',
          className
        )}
      >
        {definition.label}
      </span>
    </Tooltip>
  )
}
```

Export it from `src/@panther.core/components/index.ts` beside `MetricValue`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/@panther.core/components/DefinedTerm.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write the failing test for `MetricValue`'s accessibility gap**

Append to `tests/@panther.core/components/MetricValue.test.tsx` — or create it if absent, matching
the suite style of its neighbours:

```tsx
it('makes a defined label reachable without a mouse', async () => {
  renderWithProviders(
    <MetricDefinitionsProvider
      registry={{ m: { id: 'm', label: 'A metric', description: 'What it counts.' } }}
    >
      <MetricValue metricId="m" value={1} />
    </MetricDefinitionsProvider>
  )
  await userEvent.tab()
  expect(screen.getByText('A metric')).toHaveFocus()
})

it('does not make an undefined label focusable', async () => {
  renderWithProviders(
    <MetricDefinitionsProvider registry={{}}>
      <MetricValue metricId="unregistered" value={1} />
    </MetricDefinitionsProvider>
  )
  expect(screen.getByText(/unregistered/)).not.toHaveAttribute('tabindex')
})
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run tests/@panther.core/components/MetricValue.test.tsx`
Expected: FAIL — the label span is not focusable.

- [ ] **Step 7: Fix `MetricValue`**

In `src/@panther.core/components/MetricValue.tsx`, give the label span a focus stop **only** in the
resolved branch. Change the `labelNode` construction so the `tabIndex` is applied when `resolved`
is non-null:

```tsx
  const labelNode = (
    <span
      tabIndex={resolved ? 0 : undefined}
      className={clsx(
        'text-2xs',
        resolved ? 'text-ink-muted' : 'text-status-warn pb-ident',
        !resolved && 'underline decoration-dotted',
        resolved && 'focus-visible:outline-accent rounded-xs focus-visible:outline-2'
      )}
    >
      {label}
      {!resolved && ' (no definition registered)'}
    </span>
  )
```

Add a line to the component docstring recording why:

```
 * The label carries a focus stop when it resolves to a definition, so the explanation is reachable
 * by keyboard and on touch. Without it the tooltip is mouse-only, which made every definition in
 * this app unreachable for anyone not using a pointer.
```

- [ ] **Step 8: Run the tests**

Run: `npx vitest run tests/@panther.core/components/ && npm test`
Expected: PASS.

- [ ] **Step 9: Stage**

```bash
git add src/@panther.core/components/DefinedTerm.tsx \
        src/@panther.core/components/index.ts \
        src/@panther.core/components/MetricValue.tsx \
        tests/@panther.core/components/DefinedTerm.test.tsx \
        tests/@panther.core/components/MetricValue.test.tsx
```

---

### Task 4: Render defined terms in generic tables

**Files:**
- Modify: `src/features/reports/model/genericView.ts:162-182`
- Modify: `src/features/reports/components/GenericTable.tsx:69-90`
- Test: `tests/features/reports/GenericTable.test.tsx` (create)

**Interfaces:**
- Consumes: `NormalisedTable.definesColumn` (Task 1), `generatorDefinitionId` (Task 2), `DefinedTerm` (Task 3).
- Produces: `GenericTableView.definesColumn: string | null` and `GenericTableView.sectionId: string`, so the view can build the registry key for a cell.

- [ ] **Step 1: Write the failing test**

Create `tests/features/reports/GenericTable.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { MetricDefinitionsProvider } from '@/@panther.core/components'
import { GenericTable } from '@/features/reports/components/GenericTable'
import { renderWithProviders } from '../../test-utils'

/**
 * A table from an unfamiliar section, with its bucket column defined (spec §6.3).
 *
 * Only the column the generator named is treated as vocabulary. Matching any cell whose value
 * happens to equal a defined term would eventually put a tooltip on a family id.
 */
const REGISTRY = {
  'recluster.new_family': {
    id: 'recluster.new_family',
    label: 'Became a new family',
    description: 'Minted a new PANTHER family id.',
  },
}

const TABLE = {
  key: 'recluster_table_1',
  sectionId: 'recluster',
  name: 'Cluster outcomes',
  columns: ['outcome', 'clusters'],
  rows: [{ outcome: 'new_family', clusters: 153 }],
  includedRows: 1,
  totalRows: 1,
  raggedRows: null,
  definesColumn: 'outcome',
}

describe('GenericTable with a defined column', () => {
  it('renders a defined cell as its label', () => {
    renderWithProviders(
      <MetricDefinitionsProvider registry={REGISTRY}>
        <GenericTable table={TABLE} />
      </MetricDefinitionsProvider>
    )
    expect(screen.getByText('Became a new family')).toBeInTheDocument()
    expect(screen.queryByText('new_family')).not.toBeInTheDocument()
  })

  it('leaves every other column untouched', () => {
    renderWithProviders(
      <MetricDefinitionsProvider registry={REGISTRY}>
        <GenericTable table={TABLE} />
      </MetricDefinitionsProvider>
    )
    expect(screen.getByText('153')).toBeInTheDocument()
  })

  it('shows the raw term when the column is defined but the term is not', () => {
    renderWithProviders(
      <MetricDefinitionsProvider registry={REGISTRY}>
        <GenericTable table={{ ...TABLE, rows: [{ outcome: 'mystery', clusters: 1 }] }} />
      </MetricDefinitionsProvider>
    )
    expect(screen.getByText('mystery')).toBeInTheDocument()
  })

  it('does not define cells in a table that names no column', () => {
    renderWithProviders(
      <MetricDefinitionsProvider registry={REGISTRY}>
        <GenericTable table={{ ...TABLE, definesColumn: null }} />
      </MetricDefinitionsProvider>
    )
    expect(screen.getByText('new_family')).toBeInTheDocument()
    expect(screen.queryByText('Became a new family')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/features/reports/GenericTable.test.tsx`
Expected: FAIL — a type error on the extra fields, then the raw term rendering.

- [ ] **Step 3: Carry the fields through the view**

In `src/features/reports/model/genericView.ts`, add to `GenericTableView`:

```ts
  /** The section that owns this table, needed to namespace a cell's definition id. */
  sectionId: string
  /** Column whose cell values the section defined, or `null`. */
  definesColumn: string | null
```

`fromDerivedTable` needs the owning section id. Give it a second parameter and pass the id from its
caller:

```ts
function fromDerivedTable(
  table: DerivedTable<Record<string, unknown>>,
  sectionId: string
): GenericTableView {
```

> `DerivedTable` may not currently carry `definesColumn`. If it does not, thread it through
> `makeDerivedTable` in `model/tables.ts` the same way `truncation` is threaded — check that file
> before assuming either shape.

- [ ] **Step 4: Render the column through `DefinedTerm`**

In `src/features/reports/components/GenericTable.tsx`, inside the `columns` map:

```tsx
    const defines = table.definesColumn === column
    return {
      id: column,
      header: <span className="pb-ident">{isSize ? fileSizeLabel(column) : column}</span>,
      kind: defines ? 'node' : numeric || isSize ? 'number' : 'mono',
      render: entry => {
        // Only the column the generator named. Matching any cell that happens to equal a defined
        // term would eventually put a bucket definition on a family id.
        if (defines) {
          const term = String(entry.row[column] ?? '')
          return (
            <DefinedTerm
              definitionId={generatorDefinitionId(table.sectionId, term)}
              fallback={term}
            />
          )
        }
        return isSize
          ? formatFileSize(asFiniteNumber(entry.row[column]))
          : formatCell(entry.row[column])
      },
      sortValue: entry => sortValueOf(entry.row[column]),
    }
```

Import `DefinedTerm` from `@/@panther.core/components` and `generatorDefinitionId` from
`@/features/build/model`. Note `kind: 'node'` — the column is a caller-rendered cell now and must
get no mono text treatment.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/features/reports/GenericTable.test.tsx && npm test && npm run type-check`
Expected: PASS.

- [ ] **Step 6: Stage**

```bash
git add src/features/reports/model/genericView.ts \
        src/features/reports/components/GenericTable.tsx \
        src/features/build/model/tables.ts \
        tests/features/reports/GenericTable.test.tsx
```

---

### Task 5: Mechanism labels read the registry

**Files:**
- Modify: `src/features/build/model/sections/mapping.ts:69-82`
- Test: `tests/features/mapping/mechanismLabels.test.ts` (create)

**Interfaces:**
- Consumes: `generatorDefinitionId` (Task 2).
- Produces: `MechanismSlot.definitionId: string` — the registry key for that mechanism, so `GlanceCharts`' legend and `MappingReport` can render it through `DefinedTerm`.

- [ ] **Step 1: Write the failing test**

Create `tests/features/mapping/mechanismLabels.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { getFixtureReport } from '@/features/build/fixtures'

/**
 * Curated labels win; the generator supplies the explanation (spec §5.3).
 *
 * `MECHANISM_LABELS` has said "ID match" and "Reclustering (new)" since before the generator
 * carried any vocabulary, and those readings are better than a collector's. What the dashboard has
 * never had is a definition for RECLUSTER, `(blank)` and `(other)`, all three of which fall through
 * as bare strings today.
 */
describe('mechanism slots', () => {
  it('keeps the curated label for a known mechanism', () => {
    const report = getFixtureReport('real')
    const slot = report.mapping.mechanismOrder.find(entry => entry.mechanism === 'ID')
    expect(slot?.label).toBe('ID match')
  })

  it('gives every mechanism a namespaced definition id', () => {
    const report = getFixtureReport('real')
    for (const slot of report.mapping.mechanismOrder) {
      expect(slot.definitionId).toBe(`mapping.${slot.mechanism}`)
    }
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/features/mapping/mechanismLabels.test.ts`
Expected: FAIL — `definitionId` does not exist on `MechanismSlot`.

- [ ] **Step 3: Add the field**

In `src/features/build/model/types.ts`, add to `MechanismSlot`:

```ts
  /** Registry key for this mechanism's generator-supplied definition. */
  definitionId: string
```

In `src/features/build/model/sections/mapping.ts`, set it in `buildMechanismOrder` for both the
known and the unknown branch:

```ts
  const slots: MechanismSlot[] = KNOWN_MECHANISM_ORDER.map((mechanism, slot) => ({
    mechanism,
    slot,
    label: MECHANISM_LABELS[mechanism],
    definitionId: generatorDefinitionId('mapping', mechanism),
    known: true,
  }))
```

and, in the unknown-mechanism loop:

```ts
    slots.push({
      mechanism,
      slot: slots.length,
      // No curated label: RECLUSTER, `(blank)` and `(other)` have always rendered as the raw
      // string here. `DefinedTerm` substitutes the generator's label when one exists.
      label: mechanism,
      definitionId: generatorDefinitionId('mapping', mechanism),
      known: false,
    })
```

- [ ] **Step 4: Render the legend through `DefinedTerm`**

In `src/features/overview/components/GlanceCharts.tsx`, the "Assignment mechanism" legend builds its
items from `composition.labelFor(mechanism)`. Change `labelFor` to return the node:

```tsx
    const labelFor = (mechanism: string) => {
      const slot = mapping.mechanismOrder.find(entry => entry.mechanism === mechanism)
      return (
        <DefinedTerm
          definitionId={slot?.definitionId ?? generatorDefinitionId('mapping', mechanism)}
          fallback={slot?.label ?? mechanism}
        />
      )
    }
```

> `ChartLegend`'s `label` and `TableView`'s cell may be typed `string`. If so, keep `labelFor`
> returning a string for the `TableView` and add a separate `nodeFor` used only by `ChartLegend` —
> do not widen a shared type to make one call site fit.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/features/mapping/ && npm test && npm run type-check`
Expected: PASS.

- [ ] **Step 6: Stage**

```bash
git add src/features/build/model/types.ts src/features/build/model/sections/mapping.ts \
        src/features/overview/components/GlanceCharts.tsx \
        tests/features/mapping/mechanismLabels.test.ts
```

---

### Task 6: Bind the `recluster` section to the spine

**Files:**
- Modify: `src/features/build/model/parse.ts:73-87`
- Modify: `src/features/build/model/binding.ts`
- Modify: `src/features/build/fixtures/transforms.ts`
- Modify: `src/features/build/fixtures/index.ts`
- Test: `tests/features/build/model/binding.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `'recluster'` in `KNOWN_SECTION_IDS`, bound to `PHASE_IDS.sequenceToFamilyMapping`
  - `reclusterPayload(overrides?)` and `withRecluster(): BuildStateTransform`, exported from `src/features/build/fixtures/transforms.ts`
  - a `'recluster'` entry in `FIXTURE_STATE_KEYS` — Task 7's tests select it by key.

**Why the fixture transforms and not `tests/support/`.** The report is not in the Redux store: the
store holds a `fixtureStateKey`, and `useBuildReport` derives the report from it through
`getFixtureReport`. A component test therefore cannot be handed a report — it selects a fixture
state. `transforms.ts` is where a state is defined, its docstring is explicit that states are
recipes over the real report rather than parallel JSON, and `withUnknownSection` is the existing
precedent for synthesising a whole section. Adding a key also earns free coverage: `tests/app/
fixtureStates.test.tsx` renders every member of `FIXTURE_STATE_KEYS`.

- [ ] **Step 1: Add the fixture transform**

Append to `src/features/build/fixtures/transforms.ts`, following `withUnknownSection` (which
synthesises a whole section the same way):

```ts
/** Figures from the 2026-02 build where they are known; the rest are shaped, not measured. */
const RECLUSTER_HEADLINE = {
  families_created: 153,
  sequences_in_new_families: 2823,
  families_inherited: 0,
  sequences_in_inherited_families: 0,
  clusters_formed: 41234,
  sequences_offered: 493583,
  new_family_id_min: 'PTHR90001',
  new_family_id_max: 'PTHR90153',
}

/** The `recluster` section as the generator writes it. Exported so the model's own tests can
 *  read a payload without building a whole state. */
export function reclusterPayload(overrides: Record<string, unknown> = {}) {
  return {
    text: 'Reclustering created 153 new PANTHER families from 2,823 sequences.',
    headline: { ...RECLUSTER_HEADLINE },
    rows: Object.entries(RECLUSTER_HEADLINE).map(([metric, value]) => ({ metric, value })),
    tables: [
      {
        name: 'Cluster outcomes',
        columns: ['outcome', 'clusters', 'sequences'],
        defines: 'outcome',
        rows: [
          { outcome: 'new_family', clusters: 153, sequences: 2823 },
          { outcome: 'inherited_family', clusters: 0, sequences: 0 },
          { outcome: 'single_organism', clusters: 30140, sequences: 61230 },
          { outcome: 'too_small', clusters: 10941, sequences: 38122 },
        ],
        total_rows: 4,
        truncated: false,
      },
    ],
    definitions: {
      new_family: {
        label: 'Became a new family',
        definition:
          'A TribeMCL cluster that was minted a new PANTHER family id. Requires at least 2 ' +
          'organisms, at least 10 sequences, and no previous-library family to inherit.',
      },
      inherited_family: {
        label: 'Reclaimed an existing family',
        definition: 'A cluster handed back a previous-library family. Reclaiming is not creating.',
      },
      single_organism: {
        label: 'Discarded — single organism',
        definition: 'All sequences from one organism. Never eligible for a family.',
      },
      too_small: {
        label: 'Discarded — fewer than 10 sequences',
        definition: 'Multi-organism, below the size floor, with nothing to inherit.',
      },
    },
    warnings: [],
    ...overrides,
  }
}

/**
 * Adds the `recluster` section the frozen reference predates.
 *
 * Idempotent like every transform here: a state that already carries the section passes through,
 * so a recipe may compose it twice. Inserted after `mapping`, which is where the generator's
 * REGISTRY emits it.
 */
export function withRecluster(): BuildStateTransform {
  return state => {
    if (!isRecord(state)) return state
    const next = clone(state)
    const sections = asArray(next.sections)
    if (sections.filter(isRecord).some(section => asString(section.id) === 'recluster')) {
      return next
    }
    const at = sections.findIndex(
      section => isRecord(section) && asString(section.id) === 'mapping'
    )
    const addition: RawSection = {
      id: 'recluster',
      title: 'Reclustering (TribeMCL)',
      status: 'ok',
      message: null,
      data: reclusterPayload(),
    }
    sections.splice(at < 0 ? sections.length : at + 1, 0, addition)
    next.sections = sections
    return next
  }
}
```

> `withUnknownSection` assigns its result back to `next.sections` in whatever way that file already
> uses — match it rather than the `splice`-in-place sketch above if the two differ.

- [ ] **Step 1b: Register the fixture state**

In `src/features/build/fixtures/index.ts`, add `'recluster'` to `FIXTURE_STATE_KEYS` and a
definition beside the others:

```ts
  {
    key: 'recluster',
    label: 'With reclustering',
    description:
      'The real report plus the reclustering section, which the frozen reference predates: 153 ' +
      'families created from 2,823 sequences.',
    transforms: ['withRecluster'],
    apply: withRecluster(),
  },
```

Import `withRecluster` at the top of the file alongside the other transforms.

- [ ] **Step 2: Write the failing test**

Append to `tests/features/build/model/binding.test.ts`:

```ts
describe('the recluster section', () => {
  it('is a known section id', () => {
    expect(KNOWN_SECTION_IDS).toContain('recluster')
  })

  it('hangs from sequence-to-family mapping, where reclustering runs', () => {
    const binding = resolveBinding('recluster')
    expect(binding.placement).toBe('phase')
    expect(binding.primaryPhaseId).toBe(PHASE_IDS.sequenceToFamilyMapping)
  })

  it('contributes to no other phase, unlike mapping', () => {
    expect(resolveBinding('recluster').contributingPhaseIds).toEqual([])
  })
})
```

> Match the existing imports and `resolveBinding` call shape used elsewhere in this file; the
> sketch above assumes a signature you should verify first.

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run tests/features/build/model/binding.test.ts`
Expected: FAIL — `recluster` is not in `KNOWN_SECTION_IDS`.

- [ ] **Step 4: Register the id and the binding**

In `src/features/build/model/parse.ts`, add `'recluster'` to `KNOWN_SECTION_IDS` immediately after
`'mapping'`.

In `src/features/build/model/binding.ts`, add after the `mapping` entry:

```ts
  {
    sectionId: 'recluster',
    placement: 'phase',
    primaryPhaseId: PHASE_IDS.sequenceToFamilyMapping,
    contributingPhaseIds: [],
    rationale:
      'Reclustering is one stage of the mapping phase - order 60, between HMM scoring and the ' +
      'first cleanup pass - so unlike `mapping`, which spans five places on the spine, this ' +
      'section describes exactly one. It is where new families are created, which `mapping` ' +
      'records only as a rise in the family count across one stage boundary.',
  },
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/features/build/model/binding.test.ts && npm test`
Expected: PASS. `liveReport.contract.test.ts` still passes — it asserts every id in the LIVE report
resolves to a placement, and the live report does not yet carry `recluster`.

- [ ] **Step 6: Stage**

```bash
git add src/features/build/model/parse.ts src/features/build/model/binding.ts \
        src/features/build/fixtures/transforms.ts src/features/build/fixtures/index.ts \
        tests/features/build/model/binding.test.ts
```

---

### Task 7: The extractor and the glance panel

**Files:**
- Create: `src/features/build/model/sections/recluster.ts`
- Modify: `src/features/build/model/types.ts`, `src/features/build/model/parse.ts`, `src/features/build/model/sections/index.ts`
- Modify: `src/features/overview/components/GlanceCharts.tsx`
- Test: `tests/features/build/model/sections/recluster.test.ts`, `tests/features/overview/GlanceCharts.test.tsx` (create both)

**Interfaces:**
- Consumes: `reclusterPayload` and the `'recluster'` fixture state (Task 6), `DefinedTerm` (Task 3).
- Produces: `ReclusterSummary extends SummaryMeta` with `familiesCreated`, `sequencesInNewFamilies`, `familiesInherited`, `clustersFormed`, `sequencesOffered`, `newFamilyIdMin`, `newFamilyIdMax`, `outcomes` — all `number | null` or `string | null`; and `report.recluster` on `BuildReport`.

- [ ] **Step 1: Write the failing extractor test**

Create `tests/features/build/model/sections/recluster.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createNoteSink, extractRecluster, toSectionInput } from '@/features/build/model'
import type { RawSection } from '@/features/build/model'
import { reclusterPayload } from '@/features/build/fixtures/transforms'

/**
 * The headline result of a build: how many families it created.
 *
 * Absent is not zero. A build that has not reached reclustering created no families YET, and a
 * panel that renders that as "0" states a finding the report never made.
 */
const sectionOf = (data: unknown, overrides: Partial<RawSection> = {}) =>
  toSectionInput(
    { id: 'recluster', title: 'Reclustering', status: 'ok', data, ...overrides } as RawSection,
    1
  )

describe('extractRecluster', () => {
  it('reads the families created', () => {
    const summary = extractRecluster(sectionOf(reclusterPayload()), createNoteSink())
    expect(summary.familiesCreated).toBe(153)
    expect(summary.sequencesInNewFamilies).toBe(2823)
    expect(summary.clustersFormed).toBe(41234)
  })

  it('reports absent rather than zero when the section is absent', () => {
    const summary = extractRecluster(
      sectionOf(null, { status: 'absent', message: 'inputs not present yet' }),
      createNoteSink()
    )
    expect(summary.familiesCreated).toBeNull()
    expect(summary.availability).not.toBe('present')
  })

  it('distinguishes a build that created zero families from one that did not get there', () => {
    const summary = extractRecluster(
      sectionOf(reclusterPayload({ headline: { families_created: 0, clusters_formed: 12 } })),
      createNoteSink()
    )
    expect(summary.familiesCreated).toBe(0)
  })

  it('keeps the outcome rows for the panel bar', () => {
    const summary = extractRecluster(sectionOf(reclusterPayload()), createNoteSink())
    expect(summary.outcomes.map(entry => entry.outcome)).toEqual([
      'new_family',
      'inherited_family',
      'single_organism',
      'too_small',
    ])
  })

  it('degrades to nulls on a payload whose headline is not a record', () => {
    const summary = extractRecluster(
      sectionOf(reclusterPayload({ headline: 'nonsense' })),
      createNoteSink()
    )
    expect(summary.familiesCreated).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/features/build/model/sections/recluster.test.ts`
Expected: FAIL — `extractRecluster` is not exported.

- [ ] **Step 3: Add the types**

In `src/features/build/model/types.ts`, beside `NodeTrackingSummary`:

```ts
/** One row of the generator's cluster-outcome table. */
export interface ReclusterOutcome {
  outcome: string
  clusters: number | null
  sequences: number | null
}

export interface ReclusterSummary extends SummaryMeta {
  familiesCreated: number | null
  sequencesInNewFamilies: number | null
  familiesInherited: number | null
  sequencesInInheritedFamilies: number | null
  clustersFormed: number | null
  sequencesOffered: number | null
  newFamilyIdMin: string | null
  newFamilyIdMax: string | null
  outcomes: ReclusterOutcome[]
  warnings: string[]
}
```

and add to `BuildReport`, after `mapping`:

```ts
  recluster: ReclusterSummary
```

- [ ] **Step 4: Write the extractor**

Create `src/features/build/model/sections/recluster.ts`:

```ts
/**
 * The `recluster` section: what TribeMCL reclustering created.
 *
 * The typed reading exists for one reason the generic view cannot serve - the glance panel leads
 * the build record with the number of families this build created, and a panel cannot lead with an
 * `unknown`. The section BODY still renders generically; there is no bespoke view. So this
 * extractor is deliberately thin: the headline, and the outcome table the panel's bar draws from.
 *
 * Absent is never zero. A build that has not reached reclustering has created no families YET,
 * which is a different claim from having created none, and the panel must be able to tell them
 * apart.
 */

import { asArray, asInteger, asNonEmptyString, asRecord, asStringArray } from '../primitives'
import { makeMeta } from '../notes'
import { availabilityFor } from '../status'
import type { NoteSink } from '../notes'
import type { ReclusterOutcome, ReclusterSummary } from '../types'
import { sectionBaseNotes } from './input'
import type { SectionInput } from './input'

export function extractRecluster(section: SectionInput, sink: NoteSink): ReclusterSummary {
  const scope = `section:${section.sectionId}`
  const hasData = section.dataRecord !== null
  const notes = sectionBaseNotes(section, sink, 'reclustering statistics')

  const meta = makeMeta({
    availability: availabilityFor(section.status, hasData),
    sectionId: section.sectionId,
    message: section.message,
    status: section.status,
    notes,
  })

  const headline = asRecord(section.dataRecord?.headline)

  // The cluster-outcome table, by name rather than by position: a collector may add a table
  // before it, and reading `tables[0]` would then silently draw the panel's bar from the wrong one.
  const outcomeTable = asArray(section.dataRecord?.tables)
    .map(entry => asRecord(entry))
    .find(record => asNonEmptyString(record?.name) === 'Cluster outcomes')

  const outcomes: ReclusterOutcome[] = asArray(outcomeTable?.rows)
    .map(entry => asRecord(entry))
    .filter((record): record is Record<string, unknown> => {
      if (record === null) {
        sink.add('warning', scope, 'A cluster-outcome row is not an object; skipped.')
        return false
      }
      return true
    })
    .map(record => ({
      outcome: asNonEmptyString(record.outcome) ?? 'UNKNOWN',
      clusters: asInteger(record.clusters),
      sequences: asInteger(record.sequences),
    }))

  return {
    ...meta,
    familiesCreated: asInteger(headline?.families_created),
    sequencesInNewFamilies: asInteger(headline?.sequences_in_new_families),
    familiesInherited: asInteger(headline?.families_inherited),
    sequencesInInheritedFamilies: asInteger(headline?.sequences_in_inherited_families),
    clustersFormed: asInteger(headline?.clusters_formed),
    sequencesOffered: asInteger(headline?.sequences_offered),
    newFamilyIdMin: asNonEmptyString(headline?.new_family_id_min),
    newFamilyIdMax: asNonEmptyString(headline?.new_family_id_max),
    outcomes,
    warnings: asStringArray(section.dataRecord?.warnings),
  }
}
```

> `asInteger` must return `null` for a missing key — that is what makes absent-vs-zero work. Confirm
> its behaviour in `../primitives` before relying on it; if it coerces missing to `0`, use the
> guarded form the other extractors use instead.

- [ ] **Step 5: Add the fallback and wire it in**

In `src/features/build/model/fallbacks.ts`, beside `absentNodeTracking`:

```ts
export function absentRecluster(meta: SummaryMeta): ReclusterSummary {
  return {
    ...meta,
    familiesCreated: null,
    sequencesInNewFamilies: null,
    familiesInherited: null,
    sequencesInInheritedFamilies: null,
    clustersFormed: null,
    sequencesOffered: null,
    newFamilyIdMin: null,
    newFamilyIdMax: null,
    outcomes: [],
    warnings: [],
  }
}
```

In `src/features/build/model/parse.ts`, beside the `mapping` extraction:

```ts
  const recluster = safe(
    sink,
    'section:recluster',
    () => extractRecluster(pick('recluster'), sink),
    reason => absentRecluster(errorMeta('recluster', reason))
  )
```

and add `recluster` to the returned report object. Export `extractRecluster` from
`src/features/build/model/sections/index.ts` and the types from `types.ts` via the model's
`index.ts`, following how `extractNodeTracking` is exported.

- [ ] **Step 6: Run the extractor test**

Run: `npx vitest run tests/features/build/model/sections/recluster.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 7: Write the failing panel test**

Create `tests/features/overview/GlanceCharts.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { GlanceCharts } from '@/features/overview/components/GlanceCharts'
import { initialBuildUiState } from '@/features/build/slices/buildSlice'
import { renderWithProviders } from '../../test-utils'

/**
 * The count of families created, above the fold (spec §6.4).
 *
 * The absence case is the load-bearing one: no figure is derived from the mapping family delta,
 * because that delta is a NET change and would undercount silently if anything were dropped at the
 * same stage. A panel that showed 153 either way would be stating a finding the report never made.
 *
 * The report is selected by fixture-state key rather than injected: the store holds the key, and
 * `useBuildReport` derives the report from it.
 */
const renderGlance = (fixtureStateKey: 'real' | 'recluster') =>
  renderWithProviders(<GlanceCharts />, {
    preloadedState: { build: { ...initialBuildUiState, fixtureStateKey } },
  })

describe('GlanceCharts reclustering panel', () => {
  it('leads with the number of families created', () => {
    renderGlance('recluster')
    expect(screen.getByText('153')).toBeInTheDocument()
    expect(screen.getByText(/families created/i)).toBeInTheDocument()
  })

  it('states no figure when the report carries no reclustering section', () => {
    renderGlance('real')
    expect(screen.queryByText(/families created/i)).not.toBeInTheDocument()
    expect(screen.getByText(/reclustering statistics/i)).toBeInTheDocument()
  })
})
```

> The absence assertion depends on what `Panel`'s `UnavailableNotice` actually renders for a
> `missingSubject`. Check `src/@panther.core/components/UnavailableNotice.tsx` and match its real
> copy rather than guessing at `/not reported/`.

- [ ] **Step 8: Run it to verify it fails**

Run: `npx vitest run tests/features/overview/GlanceCharts.test.tsx`
Expected: FAIL — no panel renders the figure.

- [ ] **Step 9: Add the panel**

In `src/features/overview/components/GlanceCharts.tsx`, pull `recluster` from the report and add a
fourth `Panel` after "Assignment mechanism":

```tsx
      <Panel
        title="New families"
        subtitle="created by reclustering"
        availability={recluster.availability}
        message={recluster.message ?? undefined}
        missingSubject="Reclustering statistics"
        density="tight"
        provenance="generator"
      >
        {/* The headline result of a build, stated rather than derived. `mapping` carries the same
            fact only as a rise in the family count across one stage boundary, which is a NET
            change and undercounts if anything is also dropped there. */}
        <div className="space-y-1">
          <div className="flex flex-wrap items-baseline gap-x-3">
            <span className="text-ink pb-figures text-display leading-none font-semibold">
              {recluster.familiesCreated === null
                ? '—'
                : recluster.familiesCreated.toLocaleString()}
            </span>
            <span className="text-ink-faint text-2xs tracking-wide uppercase">
              families created
            </span>
          </div>
          <p className="text-ink-muted text-2xs">
            {recluster.sequencesInNewFamilies === null
              ? null
              : `${formatCount(recluster.sequencesInNewFamilies)} sequences, from ` +
                `${formatCount(recluster.clustersFormed ?? 0)} TribeMCL clusters`}
          </p>
        </div>
      </Panel>
```

Add `recluster.availability` to the `hasAnything` guard so the row still renders when only this
panel has data.

- [ ] **Step 10: Run the tests**

Run: `npx vitest run tests/features/overview/ && npm test && npm run type-check && npm run lint`
Expected: PASS.

- [ ] **Step 11: Check it at phone width**

Run: `npm run dev`, open `http://localhost:4310`, narrow to ~400px.
Expected: four panels wrap to 2×2 then one column; no horizontal page scroll.

- [ ] **Step 12: Stage**

```bash
git add src/features/build/model/sections/recluster.ts \
        src/features/build/model/fallbacks.ts \
        src/features/build/model/sections/index.ts \
        src/features/build/model/types.ts src/features/build/model/parse.ts \
        src/features/overview/components/GlanceCharts.tsx \
        tests/features/build/model/sections/recluster.test.ts \
        tests/features/overview/GlanceCharts.test.tsx
```

---

### Task 8: Documentation

**Files:**
- Modify: `docs/ui-roadmap.md`
- Modify: `.plans/feature/2026-09-11-reclustering-and-definitions.md` (this file)

- [ ] **Step 1: Update the roadmap's inventory**

`docs/ui-roadmap.md` audits what the UI can and cannot promise, written against 8 collectors. Add a
row for `recluster`, marked **verified** for the figures the collector reads from the TribeMCL
report, and note that the definitions now shown in tooltips are generator-supplied rather than
dashboard-curated — which changes who owns their accuracy.

- [ ] **Step 2: Mark the plan complete**

Set **Status: COMPLETE**, tick every step, and add a `## Summary`.

- [ ] **Step 3: Final verification**

Run: `npm test && npm run type-check && npm run lint`
Expected: PASS, 801 + new tests.

- [ ] **Step 4: Stage**

```bash
git add docs/ui-roadmap.md .plans/feature/2026-09-11-reclustering-and-definitions.md
```

---

## Notes

- **Why no specialised renderer.** The generic renderer already handles the entire `recluster`
  payload. A bespoke component would duplicate `GenericTable` for no gain. The typed extractor
  exists only because the glance panel cannot lead with an `unknown`.
- **Why the live report is untouched.** `docs/build_state.json` gets a `recluster` section only when
  someone regenerates on the cluster (spec §8). Until then the glance panel shows its absence state
  — designed behaviour, not a bug. `liveReport.contract.test.ts` stays green throughout, because it
  asserts that ids in the live report resolve, not that known ids appear in it.
- **The one test that will go red later.** When the refreshed report lands, `liveReport.contract`
  checks the new id resolves to a placement. Task 6 is what makes that pass. Landing Task 6 before
  the refresh is why the spec puts the dashboard before the copy.
