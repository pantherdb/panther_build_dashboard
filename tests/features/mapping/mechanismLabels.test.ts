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
