import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MetricDefinitionsProvider } from '@/@panther.core/components'
import { GenericFieldRows, GenericFigure } from '@/features/reports/components/GenericFields'
import type { GenericField } from '@/features/reports/model/genericView'
import { renderWithProviders } from '@tests/test-utils'

/**
 * The three-way label choice a generic render makes for a field: a curated metric, then the
 * generator's own definition (`definitionId`, landed in the previous task), then the honest raw
 * key. Only the middle branch is new here - the other two already had coverage via
 * `GenericReport.test.tsx` and `genericView.test.ts` - so these cases isolate it.
 */
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
    expect(await screen.findByText(/already existed in the previous library/)).toBeInTheDocument()
  })
})

describe('GenericFieldRows with a generator definition', () => {
  it('labels the row with the generator definition instead of the raw key', () => {
    renderWithProviders(
      <MetricDefinitionsProvider registry={REGISTRY}>
        <GenericFieldRows fields={[fieldOf({})]} />
      </MetricDefinitionsProvider>
    )
    expect(screen.getByText('Sequences clustered into existing families')).toBeInTheDocument()
    expect(screen.queryByText('sequences_in_inherited_families')).not.toBeInTheDocument()
  })

  it('keeps the honest raw key label when nothing defines it', () => {
    renderWithProviders(
      <MetricDefinitionsProvider registry={{}}>
        <GenericFieldRows fields={[fieldOf({ definitionId: null })]} />
      </MetricDefinitionsProvider>
    )
    expect(screen.getByText('sequences_in_inherited_families')).toBeInTheDocument()
  })

  it('reveals the row definition on keyboard focus', async () => {
    renderWithProviders(
      <MetricDefinitionsProvider registry={REGISTRY}>
        <GenericFieldRows fields={[fieldOf({})]} />
      </MetricDefinitionsProvider>
    )
    await userEvent.tab()
    expect(await screen.findByText(/already existed in the previous library/)).toBeInTheDocument()
  })
})

describe('GenericFieldRows with a curated metric', () => {
  // MetricLabel (the curated branch) used to be a plain, non-focusable span while DefinedTerm
  // (the generator branch) was already keyboard-reachable - two labels in one row list with
  // different affordances for no reason a reader could tell. This pins that both are now reachable
  // the same way.
  it('is keyboard focusable and reveals its explanation', async () => {
    renderWithProviders(
      <GenericFieldRows fields={[fieldOf({ metricId: 'prevLibSequences', definitionId: null })]} />
    )
    const label = screen.getByText('Previous-library reference sequences')
    expect(label).toHaveAttribute('tabIndex', '0')

    await userEvent.tab()
    expect(label).toHaveFocus()
    expect(await screen.findByText(/fed the previous library build/)).toBeInTheDocument()
  })

  // A curated label (MetricLabel) and a generator-defined label (DefinedTerm) sit side by side in
  // the same row list. Nothing about the report tells a reader that one convention backs a label
  // over the other, so both must present the same "this is hoverable" affordance - the dotted
  // underline and help cursor - or a mouse user sees one as inert text for no legible reason. This
  // compares the actual class sets rather than a hardcoded string, so it still passes if either
  // component's incidental styling (e.g. text size) is later split out from the shared affordance.
  it('gives a curated label the same hover affordance as a generator-defined label', () => {
    renderWithProviders(
      <MetricDefinitionsProvider registry={REGISTRY}>
        <GenericFieldRows
          fields={[
            fieldOf({
              path: 'reference_sequences',
              key: 'reference_sequences',
              metricId: 'prevLibSequences',
              definitionId: null,
            }),
            fieldOf({}),
          ]}
        />
      </MetricDefinitionsProvider>
    )
    const curatedLabel = screen.getByText('Previous-library reference sequences')
    const generatorLabel = screen.getByText('Sequences clustered into existing families')

    expect(new Set(curatedLabel.className.split(' '))).toEqual(
      new Set(generatorLabel.className.split(' '))
    )
  })
})
