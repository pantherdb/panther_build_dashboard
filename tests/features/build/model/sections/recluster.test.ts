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
