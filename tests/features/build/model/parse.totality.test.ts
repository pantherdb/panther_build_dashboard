import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseBuildState } from '@/features/build/model'
import { buildStateSource } from '@/features/build/fixtures'
import { expectWellFormed } from '@tests/support/reportShape'

/**
 * Totality, per Phase 1 of `.plans/feature/01-report-model.md`: `parseBuildState` must not throw on
 * any input, and a failure must degrade one part of the report rather than the whole thing.
 *
 * The malformed inputs listed in the plan are covered here, plus the two shapes the fixture itself
 * proves are realistic: numbers arriving as strings, and sections in an unexpected order.
 */

const malformed: [string, unknown][] = [
  ['null', null],
  ['undefined', undefined],
  ['an empty object', {}],
  ['an empty array', []],
  ['a number', 42],
  ['a string', 'not a report'],
  ['sections as a string', { sections: 'nope' }],
  ['sections as an object', { sections: { progress: {} } }],
  ['a single empty section', { sections: [{}] }],
  ['sections containing non-objects', { sections: [1, 'two', null, []] }],
  ['a section whose data is a string', { sections: [{ id: 'progress', status: 'ok', data: 'x' }] }],
  ['a section whose data is an array', { sections: [{ id: 'mapping', status: 'ok', data: [1] }] }],
  ['phases as a string', { sections: [{ id: 'progress', status: 'ok', data: { phases: 'x' } }] }],
  [
    'steps as a string',
    { sections: [{ id: 'progress', status: 'ok', data: { phases: [{ name: 'p', steps: 'x' }] } }] },
  ],
  ['a garbage generated_at', { generated_at: 'not-a-date', sections: [] }],
  ['a deeply nested unknown payload', { sections: [{ id: 'x', data: { a: { b: [[[1]]] } } }] }],
]

describe('parseBuildState is total', () => {
  for (const [label, input] of malformed) {
    it(`returns a well-formed report for ${label}`, () => {
      expect(() => parseBuildState(input)).not.toThrow()
      expectWellFormed(parseBuildState(input))
    })
  }

  it('records why it degraded rather than failing silently', () => {
    const report = parseBuildState(null)
    expect(report.ingestNotes.length).toBeGreaterThan(0)
    expect(report.ingestNotes.some(note => note.severity === 'error')).toBe(true)
    expect(report.health.signal).toBe('degraded')
    expect(report.schema.state).toBe('unknown')
    expect(report.schema.degraded).toBe(true)
  })

  it('preserves the input untouched so nothing is discarded', () => {
    const input = { sections: 'nope', someFutureField: [1, 2, 3] }
    expect(parseBuildState(input).raw).toBe(input)
  })

  it('never invents a zero where a measurement is absent', () => {
    const report = parseBuildState({})
    expect(report.library.sequences).toBeNull()
    expect(report.mapping.inputSequences).toBeNull()
    expect(report.nodeTracking.nodesMapped).toBeNull()
    expect(report.trees.booksTotal).toBeNull()
    expect(report.freshness.leadSeconds).toBeNull()
    expect(report.timing.activitySpan.seconds).toBeNull()
    expect(report.pipeline.declaredHeadline.stepsTotal).toBeNull()
  })

  it('degrades only the malformed part', () => {
    const broken = {
      ...buildStateSource,
      sections: (buildStateSource.sections as unknown[]).map(section => {
        const entry = section as { id?: string }
        return entry.id === 'mapping' ? { ...entry, data: 'not an object' } : section
      }),
    }
    const report = parseBuildState(broken)
    expect(report.mapping.availability).toBe('absent')
    expect(report.mapping.stages).toEqual([])
    // Everything else still parses.
    expect(report.pipeline.frontierIndex).toBe(13)
    expect(report.nodeTracking.nodesMapped).toBe(2810967)
    expect(report.library.sequences).toBe(1742145)
    expect(report.ingestNotes.some(note => note.scope === 'section:mapping')).toBe(true)
    // And the payload is still available to the generic renderer.
    const entry = report.reports.find(item => item.sectionId === 'mapping')
    expect(entry?.generic.extra.data).toBe('not an object')
  })
})

describe('coercion of realistic-but-loose values', () => {
  it('reads numbers that arrive as strings', () => {
    const report = parseBuildState({
      schema_version: '1',
      target: 'target',
      generated_at: '2026-08-20T23:26:31Z',
      sections: [
        {
          id: 'progress',
          status: 'ok',
          data: {
            phases: [
              {
                name: 'Setup',
                done: '1',
                total: '2',
                steps: [
                  { goal: 'a', status: 'done', mtime: '1786898148.4' },
                  { goal: 'b', status: 'pending', mtime: null },
                ],
              },
            ],
            headline: { phases_complete: '0', steps_complete: '1', steps_total: '2' },
          },
        },
        {
          id: 'library',
          status: 'ok',
          data: { headline: { genomes: '131', sequences: '1736983', families: '15797' } },
        },
      ],
    })
    expect(report.schema.version).toBe(1)
    expect(report.schema.state).toBe('supported')
    expect(report.library.sequences).toBe(1736983)
    expect(report.pipeline.phases[0].declaredDone).toBe(1)
    expect(report.pipeline.phases[0].completedSteps).toBe(1)
    expect(report.pipeline.frontierIndex).toBe(0)
    expect(report.pipeline.steps[0].timing.artifactAt.present).toBe(true)
  })

  it('rejects a boolean as a measurement rather than coercing it to 1', () => {
    const report = parseBuildState({
      sections: [{ id: 'library', status: 'ok', data: { headline: { sequences: true } } }],
    })
    expect(report.library.sequences).toBeNull()
  })

  it('parses sections in reversed order identically', () => {
    const forward = parseBuildState(buildStateSource)
    const reversed = parseBuildState({
      ...buildStateSource,
      sections: [...(buildStateSource.sections as unknown[])].reverse(),
    })
    expect(reversed.pipeline.frontierIndex).toBe(forward.pipeline.frontierIndex)
    expect(reversed.pipeline.holes.map(hole => hole.index)).toEqual(
      forward.pipeline.holes.map(hole => hole.index)
    )
    expect(reversed.mapping.assignmentGainPoints).toBe(forward.mapping.assignmentGainPoints)
    expect(reversed.species.oscodeCount).toBe(forward.species.oscodeCount)
    expect(reversed.species.renames).toEqual(forward.species.renames)
    expect(reversed.freshness.state).toBe(forward.freshness.state)
    expect(reversed.consistency.familyAgreement.allEqual).toBe(
      forward.consistency.familyAgreement.allEqual
    )
    // Only the report registry order follows the report itself.
    expect(reversed.reports.map(entry => entry.sectionId)).toEqual(
      forward.reports.map(entry => entry.sectionId).reverse()
    )
  })

  it('flags a duplicate section id instead of losing the second one', () => {
    const report = parseBuildState({
      sections: [
        { id: 'library', status: 'ok', data: { headline: { sequences: 10 } } },
        { id: 'library', status: 'ok', data: { headline: { sequences: 20 } } },
      ],
    })
    expect(report.library.sequences).toBe(10)
    expect(report.reports).toHaveLength(2)
    expect(report.ingestNotes.some(note => note.message.includes('reuses this id'))).toBe(true)
  })
})

describe('purity of the model source', () => {
  /**
   * A clock or an RNG anywhere under `model/` would make the report non-reproducible and would
   * break the deep-equality guarantee the determinism suite relies on. Grepping the sources is
   * cruder than a runtime check but catches the mistake at the moment it is introduced.
   */
  it('uses no clock and no randomness', () => {
    const modelDir = path.join(process.cwd(), 'src', 'features', 'build', 'model')
    const files = collectTsFiles(modelDir)
    expect(files.length).toBeGreaterThan(10)

    const offenders: string[] = []
    for (const file of files) {
      // Comments are stripped first: the modules document the rule in prose, and a doc comment
      // saying "no Date.now()" must not read as a violation of it.
      const source = stripComments(fs.readFileSync(file, 'utf8'))
      for (const [pattern, label] of [
        [/\bDate\.now\s*\(/, 'Date.now()'],
        [/\bMath\.random\s*\(/, 'Math.random()'],
        [/\bnew Date\s*\(\s*\)/, 'argless new Date()'],
        [/\bperformance\.now\s*\(/, 'performance.now()'],
      ] as [RegExp, string][]) {
        if (pattern.test(source)) offenders.push(`${path.relative(process.cwd(), file)}: ${label}`)
      }
    }
    expect(offenders).toEqual([])
  })
})

/** Removes block and line comments so the purity scan reads code, not prose about the code. */
function stripComments(source: string): string {
  // `.` does not match a newline without the `s` flag, so a line comment stops at its own line.
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*/g, '$1')
}

function collectTsFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return collectTsFiles(full)
    return entry.name.endsWith('.ts') ? [full] : []
  })
}
