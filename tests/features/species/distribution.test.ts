import { describe, expect, it } from 'vitest'
import { getFixtureReport } from '@/features/build/fixtures'
import type { NodeTrackingSummary, SpeciesTracking } from '@/features/build/model'
import {
  MAX_PLOT_LABELS,
  buildDistribution,
  layoutLabels,
  nodeCountBand,
  packSwarm,
  shortfallAxis,
} from '@/features/species/model/distribution'

const tracking = (): NodeTrackingSummary => getFixtureReport('real').nodeTracking

const withSpecies = (bySpecies: SpeciesTracking[]): NodeTrackingSummary => ({
  ...tracking(),
  bySpecies,
})

const species = (
  oscode: string,
  mapped: number,
  total: number,
  pct: number | null
): SpeciesTracking => ({
  oscode,
  mapped,
  total,
  pct,
  recomputedPct: total === 0 ? null : (mapped / total) * 100,
})

const PLOT = { x: 40, y: 10, width: 600, height: 176 }

/**
 * The distribution model is where the choice of axis lives, so these tests pin the two facts the
 * whole visual rests on: the shortfall spans four decades where the percentage spans one, and a
 * species with no shortfall at all is kept off the log axis rather than clamped onto its end.
 */
describe('buildDistribution', () => {
  it('reads all 131 species rows from the real report', () => {
    const model = buildDistribution(tracking())

    expect(model.speciesCount).toBe(131)
    expect(model.points).toHaveLength(131)
    expect(model.unusableOscodes).toEqual([])
    // Appendix A.6: 117 of 131 at or above 90 %, median 99.5, MAD 0.4.
    expect(model.atOrAboveThreshold).toBe(117)
    expect(model.medianPct).toBe(99.5)
    expect(model.madPct).toBe(0.4)
    expect(model.threshold).toBe(90)
  })

  it('sums the species rows to the LEAF node total, not the headline total', () => {
    const model = buildDistribution(tracking())

    // Appendix A.6 / A.7: LEAF total 1,742,145; the headline denominator is 3,031,716.
    expect(model.nodesInSpeciesRows).toBe(1_742_145)
    expect(model.unmappedInSpeciesRows).toBe(1_742_145 - 1_614_152)
  })

  it('lists the low tail from Appendix A.6, ascending by rate', () => {
    const model = buildDistribution(tracking())

    expect(model.low.map(point => point.oscode)).toEqual([
      'DAPMA',
      'IXOSC',
      'FELCA',
      'PHANO',
      'CAEBR',
      'POPTR',
      'TOBAC',
      'SPIOL',
      'BOVIN',
      'GOSHI',
      'MANES',
      'DANRE',
      'HELAN',
      'HORVV',
    ])
    expect(model.zeroOscodes).toEqual(['DAPMA'])
  })

  it('orders the same tail by shortfall magnitude, which is a different order', () => {
    const model = buildDistribution(tracking())

    // IXOSC loses 14,932 nodes at 17.1 %; POPTR loses 14,701 at 68.1 %; PHANO loses 3,116 at
    // 65.0 %. Rate alone misranks them: PHANO's rate is worse than POPTR's, but its loss is smaller.
    expect(model.lowByMagnitude[0].oscode).toBe('IXOSC')
    expect(model.lowByMagnitude[0].unmapped).toBe(14_932)
    expect(model.lowByMagnitude.findIndex(point => point.oscode === 'PHANO')).toBeGreaterThan(
      model.lowByMagnitude.findIndex(point => point.oscode === 'POPTR')
    )
  })

  it('labels the zero-percent species first and caps the label count', () => {
    const model = buildDistribution(tracking())

    expect(model.labelled).toHaveLength(MAX_PLOT_LABELS)
    expect(model.labelled[0]).toBe('DAPMA')
  })

  it('keeps species with no shortfall off the log axis', () => {
    const model = buildDistribution(tracking())

    // SHEON, LISMO and CHLAA tracked every node forward.
    expect(model.perfect.map(point => point.oscode).sort()).toEqual(['CHLAA', 'LISMO', 'SHEON'])
    expect(model.onAxis).toHaveLength(131 - 3)
    expect(model.perfect.every(point => point.shortfallPct === 0)).toBe(true)
  })

  it('recomputes the shortfall from the counts rather than from the rounded percentage', () => {
    const model = buildDistribution(withSpecies([species('AAA', 11_498, 17_677, 65.0)]))

    // 100 - 65.0 would say 35 %; the counts say 34.955 %.
    expect(model.points[0].shortfallPct).toBeCloseTo(34.955, 3)
  })

  it('treats a row with no readable percentage as unknown, never as zero', () => {
    const model = buildDistribution(withSpecies([species('AAA', 0, 0, null)]))

    expect(model.points[0].usable).toBe(false)
    expect(model.points[0].shortfallPct).toBeNull()
    expect(model.onAxis).toHaveLength(0)
    expect(model.unusableOscodes).toEqual(['AAA'])
  })

  it('bands a species by node count so magnitude survives into the mark', () => {
    expect(nodeCountBand(8_910).key).toBe('small')
    expect(nodeCountBand(17_677).key).toBe('medium')
    expect(nodeCountBand(46_055).key).toBe('large')
    expect(nodeCountBand(null).key).toBe('small')
  })
})

describe('shortfallAxis', () => {
  it('places 0 % at the left, 99.99 % at the right of the log region, and 100 % beyond a break', () => {
    const axis = shortfallAxis(PLOT, true)

    expect(axis.usable).toBe(true)
    expect(axis.x(100)).toBeLessThan(axis.x(10))
    expect(axis.x(10)).toBeLessThan(axis.x(0.01))
    expect(axis.x(0.01)).toBeCloseTo(axis.logRight, 6)
    expect(axis.perfectX).toBeGreaterThan(axis.logRight)
    expect(axis.breakX).toBeGreaterThan(axis.logRight)
    expect(axis.breakX).toBeLessThan(axis.perfectX)
  })

  it('spaces the decades evenly, so 99.9 % to 99.99 % is as wide as 0 % to 90 %', () => {
    const axis = shortfallAxis(PLOT, true)
    const decade = axis.x(10) - axis.x(100)

    expect(axis.x(1) - axis.x(10)).toBeCloseTo(decade, 6)
    expect(axis.x(0.01) - axis.x(0.1)).toBeCloseTo(decade, 6)
  })

  it('labels the ticks in forward-tracked percent, which is the published figure', () => {
    const axis = shortfallAxis(PLOT, true)

    expect(axis.ticks.map(tick => tick.label)).toEqual([
      '0 %',
      '90 %',
      '99 %',
      '99.9 %',
      '99.99 %',
      '100 %',
    ])
  })

  it('drops the 100 % slot when no species has a zero shortfall', () => {
    const axis = shortfallAxis(PLOT, false)

    expect(axis.breakX).toBeNull()
    expect(axis.ticks).toHaveLength(5)
    expect(axis.perfectX).toBeCloseTo(axis.logRight, 6)
  })

  it('never returns a non-finite coordinate, whatever it is handed', () => {
    const axis = shortfallAxis(PLOT, true)

    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, -1, 0, 1e9]) {
      expect(Number.isFinite(axis.x(value))).toBe(true)
    }
  })

  it('reports itself unusable rather than dividing by a zero-width plot', () => {
    const axis = shortfallAxis({ x: 0, y: 0, width: 0, height: 100 }, true)

    expect(axis.usable).toBe(false)
    expect(Number.isFinite(axis.x(50))).toBe(true)
  })
})

describe('packSwarm', () => {
  it('is deterministic: the same input twice gives identical positions', () => {
    const items = Array.from({ length: 40 }, (_, index) => ({
      key: `S${index}`,
      x: 100 + (index % 7),
      radius: 4,
    }))
    const first = packSwarm(items, { centerY: 100, halfHeight: 40 })
    const second = packSwarm([...items].reverse(), { centerY: 100, halfHeight: 40 })

    expect(first).toEqual(second)
  })

  it('spreads a column of coincident marks instead of stacking them', () => {
    const placements = packSwarm(
      ['A', 'B', 'C', 'D'].map(key => ({ key, x: 200, radius: 4 })),
      { centerY: 100, halfHeight: 40 }
    )
    const ys = placements.map(placement => placement.y)

    expect(new Set(ys).size).toBe(4)
  })

  it('never places a mark outside the band, even when the column overflows', () => {
    const placements = packSwarm(
      Array.from({ length: 60 }, (_, index) => ({ key: `S${index}`, x: 200, radius: 4 })),
      { centerY: 100, halfHeight: 20 }
    )

    for (const placement of placements) {
      expect(Math.abs(placement.y - 100)).toBeLessThanOrEqual(20)
      expect(Number.isFinite(placement.y)).toBe(true)
    }
  })

  it('drops non-finite input rather than emitting a NaN coordinate', () => {
    const placements = packSwarm(
      [
        { key: 'good', x: 10, radius: 4 },
        { key: 'bad', x: Number.NaN, radius: 4 },
      ],
      { centerY: 50, halfHeight: 20 }
    )

    expect(placements.map(placement => placement.key)).toEqual(['good'])
  })
})

describe('layoutLabels', () => {
  it('never overlaps two labels in one lane', () => {
    const placed = layoutLabels(
      ['AAAAA', 'BBBBB', 'CCCCC', 'DDDDD', 'EEEEE', 'FFFFF'].map((text, index) => ({
        key: text,
        text,
        x: 100 + index * 4,
        y: 150,
      })),
      { laneYs: [10, 24, 38], right: 600 }
    )

    for (const lane of [10, 24, 38]) {
      const inLane = placed
        .filter(label => label.labelY === lane)
        .sort((a, b) => a.labelX - b.labelX)
      for (let index = 1; index < inLane.length; index += 1) {
        expect(inLane[index].labelX).toBeGreaterThanOrEqual(
          inLane[index - 1].labelX + inLane[index - 1].text.length * 6
        )
      }
    }
  })

  it('keeps a label inside the plot', () => {
    const placed = layoutLabels([{ key: 'A', text: 'DAPMA', x: 590, y: 100 }], {
      laneYs: [10],
      right: 600,
    })

    expect(placed[0].labelX + 'DAPMA'.length * 6.2).toBeLessThanOrEqual(600)
  })
})
