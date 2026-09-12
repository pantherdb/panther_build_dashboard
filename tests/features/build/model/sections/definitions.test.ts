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
