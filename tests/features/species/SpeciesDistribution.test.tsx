import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { getFixtureReport } from '@/features/build/fixtures'
import type { NodeTrackingSummary, SpeciesTracking } from '@/features/build/model'
import { buildDistribution } from '@/features/species/model/distribution'
import { SpeciesDistribution } from '@/features/species/components/SpeciesDistribution'
import { renderWithProviders } from '@tests/test-utils'

const base = (): NodeTrackingSummary => getFixtureReport('real').nodeTracking

const modelWith = (bySpecies: SpeciesTracking[]) => buildDistribution({ ...base(), bySpecies })

const species = (oscode: string, mapped: number, total: number, pct: number): SpeciesTracking => ({
  oscode,
  mapped,
  total,
  pct,
  recomputedPct: (mapped / total) * 100,
})

/** Marks live inside this group, so counting them is not confused by icon glyphs elsewhere. */
const markCount = () => document.querySelectorAll('[data-pb-swarm] circle').length

/**
 * jsdom measures every container at zero width, which is the one moment a chart can divide by zero
 * and emit a NaN coordinate - a NaN blanks an SVG attribute silently instead of throwing. The frame
 * is given a `minWidth`, so these tests exercise the real geometry and can assert that no
 * coordinate came out non-finite.
 */
const assertNoNaNCoordinates = () => {
  for (const element of Array.from(document.querySelectorAll('circle, line, text'))) {
    for (const name of ['cx', 'cy', 'x1', 'x2', 'y1', 'y2', 'x', 'y', 'r']) {
      const value = element.getAttribute(name)
      if (value === null) continue
      expect(Number.isNaN(Number(value)), `${element.tagName}.${name} = ${value}`).toBe(false)
    }
  }
}

describe('SpeciesDistribution', () => {
  it('draws one mark per species for all 131 rows of the real report', () => {
    const model = buildDistribution(base())
    renderWithProviders(<SpeciesDistribution model={model} />)

    expect(model.speciesCount).toBe(131)
    expect(markCount()).toBe(131)
    assertNoNaNCoordinates()
  })

  it('labels the low tail directly, DAPMA among them', () => {
    renderWithProviders(<SpeciesDistribution model={buildDistribution(base())} />)

    expect(screen.getByText('DAPMA')).toBeInTheDocument()
    expect(screen.getByText('FELCA')).toBeInTheDocument()
    // Not every point is labelled: the cluster carries no text.
    expect(screen.queryByText('HUMAN')).toBeNull()
  })

  it('labels the axis in forward-tracked percent even though the spacing is logarithmic', () => {
    renderWithProviders(<SpeciesDistribution model={buildDistribution(base())} />)

    for (const label of ['0 %', '90 %', '99 %', '99.9 %', '99.99 %', '100 %']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })

  it('says in the footer that the spacing is non-linear and what mark size means', () => {
    renderWithProviders(<SpeciesDistribution model={buildDistribution(base())} />)

    expect(screen.getByText(/drawn as wide as the gap between 0 % and 90 %/)).toBeInTheDocument()
    expect(
      screen.getByText(/under 10,000 nodes · 10,000 to 39,999 · 40,000 or more/)
    ).toBeInTheDocument()
    expect(screen.getByText(/separated slot at 100 %/)).toBeInTheDocument()
  })

  it('draws a single mark without collapsing the axis', () => {
    const model = modelWith([species('AAA', 5, 10, 50)])
    renderWithProviders(<SpeciesDistribution model={model} />)

    expect(markCount()).toBe(1)
    expect(screen.getByText('AAA')).toBeInTheDocument()
    assertNoNaNCoordinates()
  })

  it('draws nothing and says why when there are no species rows', () => {
    renderWithProviders(<SpeciesDistribution model={modelWith([])} />)

    expect(markCount()).toBe(0)
    expect(screen.getByText('No species rows to plot')).toBeInTheDocument()
    expect(screen.getByText(/Nothing here is inferred from that absence/)).toBeInTheDocument()
  })

  it('ships a table twin carrying the same numbers', async () => {
    const { user } = renderWithProviders(<SpeciesDistribution model={buildDistribution(base())} />)

    await user.click(screen.getByRole('radio', { name: 'Table' }))

    const table = screen.getByRole('table', { name: /Node forward tracking by species/ })
    expect(table).toHaveTextContent('DAPMA')
    expect(table).toHaveTextContent('10,544')
  })
})
