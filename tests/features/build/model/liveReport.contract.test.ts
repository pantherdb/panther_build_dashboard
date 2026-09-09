import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { KNOWN_SECTION_IDS, parseBuildState, UNATTACHED_PHASE_ID } from '@/features/build/model'
import { CHECK_RULES, runChecks } from '@/features/checks/model'
import { expectWellFormed } from '@tests/support/reportShape'
import type { BuildReport } from '@/features/build/model'

/**
 * The contract the LIVE report must keep.
 *
 * `docs/build_state.json` is production data: it is regenerated on every build, committed, and
 * compiled into the bundle the site serves. Every other suite in this repo reads the frozen
 * `tests/fixtures/build_state.reference.json` instead - a `test.alias` in `vite.config.ts`
 * redirects the import - precisely so that refreshing the live file costs nothing.
 *
 * This file is the exception, and it is the only place the live file is asserted against. It reads
 * it with `fs` so the alias cannot intercept it.
 *
 * THE RULE FOR THIS FILE: no number computed by hand from the data may appear here. Every
 * assertion is an *integration* property - can the dashboard ingest, bind and render whatever the
 * generator just produced - never a *data* property. A new build with different species counts,
 * different phases or a different frontier must pass this suite untouched. If an assertion here
 * starts failing on ordinary data variation, it is the wrong assertion: delete it, do not loosen
 * it, and say so.
 */

const LIVE_PATH = path.join(process.cwd(), 'docs', 'build_state.json')

/** Read past the alias. An `import` of this path resolves to the frozen reference under Vitest. */
function readLiveState(): unknown {
  return JSON.parse(fs.readFileSync(LIVE_PATH, 'utf8'))
}

const live: unknown = readLiveState()
const report: BuildReport = parseBuildState(live)

describe('the live report is ingestible', () => {
  it('exists and is a JSON object with a sections array', () => {
    expect(fs.existsSync(LIVE_PATH)).toBe(true)
    expect(live).toBeTypeOf('object')
    expect(live).not.toBeNull()
    expect(Array.isArray((live as { sections?: unknown }).sections)).toBe(true)
  })

  it('parses without throwing, into a report with every summary present', () => {
    expect(() => parseBuildState(live)).not.toThrow()
    expectWellFormed(report)
  })

  it('declares a schema version this dashboard supports', () => {
    // A generator-side SCHEMA_VERSION bump must be a deliberate, noticed event on this side.
    expect(report.schema.state).toBe('supported')
  })

  it('names a target and a parseable generation time', () => {
    expect(report.identity.target).toBeTypeOf('string')
    expect(report.identity.target?.length ?? 0).toBeGreaterThan(0)
    expect(report.identity.generatedAt.present).toBe(true)
    expect(Number.isFinite(Date.parse(report.identity.generatedAt.iso ?? ''))).toBe(true)
    // Freshness has to resolve to one of its states rather than being left undecidable.
    expect(report.freshness.state).toBeTypeOf('string')
    expect(report.freshness.state.length).toBeGreaterThan(0)
  })
})

describe('every section the generator emitted is one this dashboard knows', () => {
  /**
   * The drift detector, and the reason this suite exists.
   *
   * When the pipeline adds a collector, its section renders through the generic renderer but hangs
   * off no phase and joins no derived check - visible, but unbound. That is exactly what happened
   * to `proteomes`, and it was found by hand. This finds it on the next `npm test`.
   *
   * Fixing a failure here means steps 3-4 of "Landing a report change across both repos" in the
   * workspace CLAUDE.md: add the id to KNOWN_SECTION_IDS and give it a SECTION_BINDINGS entry.
   * It does not mean adding the id to an ignore list here.
   */
  it('emits no section id missing from KNOWN_SECTION_IDS', () => {
    const unknown = report.reports.filter(entry => !entry.known).map(entry => entry.sectionId)
    expect(unknown, `unknown section ids: ${unknown.join(', ') || '(none)'}`).toEqual([])
  })

  it('gives every section a placement rather than leaving one unattached', () => {
    // Only `unattached` is the failure. An empty `phaseIds` is legitimate for the two placements
    // that are not phase-hung: `config_ledger` sits in the preamble and `progress` IS the spine.
    const unattached = report.reports
      .filter(entry => entry.placement === UNATTACHED_PHASE_ID)
      .map(entry => entry.sectionId)
    expect(unattached, `unattached section ids: ${unattached.join(', ') || '(none)'}`).toEqual([])
  })
})

describe('the parser did not have to degrade anything', () => {
  it('records no ingest note at error severity', () => {
    const errors = report.ingestNotes
      .filter(note => note.severity === 'error')
      .map(note => `${note.scope}: ${note.message}`)
    expect(errors, `ingest errors:\n${errors.join('\n') || '(none)'}`).toEqual([])
  })

  it('agrees with the generator about its own headline', () => {
    // The generator counts its phases and steps; so does the model. A disagreement means one of
    // the two misread the progress section, and the number on screen would be arbitrary.
    expect(report.pipeline.headlineConsistent).toBe(true)
    expect(report.pipeline.declaredHeadline).toEqual(report.pipeline.computedHeadline)
  })

  it('derives no NaN or Infinity anywhere in the model', () => {
    // A string where a number was expected, or arithmetic over absent data, surfaces as NaN in a
    // rendered figure rather than as an exception. `raw` is the input by reference, not derived.
    const derived: Record<string, unknown> = { ...report }
    delete derived.raw
    const offenders: string[] = []
    const seen = new WeakSet<object>()
    const walk = (value: unknown, at: string): void => {
      if (typeof value === 'number') {
        if (!Number.isFinite(value)) offenders.push(`${at} = ${value}`)
        return
      }
      if (value === null || typeof value !== 'object') return
      if (seen.has(value)) return
      seen.add(value)
      if (Array.isArray(value)) value.forEach((item, i) => walk(item, `${at}[${i}]`))
      else for (const [key, item] of Object.entries(value)) walk(item, `${at}.${key}`)
    }
    walk(derived, 'report')
    expect(offenders, `non-finite numbers:\n${offenders.join('\n') || '(none)'}`).toEqual([])
  })
})

describe('every derived check survives this data', () => {
  it('runs the full rule registry without throwing', () => {
    expect(() => runChecks(report)).not.toThrow()
  })

  it('gets a well-formed finding out of every rule that produced one', () => {
    // A rule that chokes on next month's shape must not be able to emit a half-built finding: the
    // checks panel renders these directly.
    const offenders: string[] = []
    for (const rule of CHECK_RULES) {
      let findings
      try {
        findings = rule.run(report)
      } catch (error) {
        offenders.push(`${rule.id} threw: ${String(error)}`)
        continue
      }
      if (!Array.isArray(findings)) {
        offenders.push(`${rule.id} returned ${typeof findings}, not an array`)
        continue
      }
      for (const finding of findings) {
        if (finding === null || typeof finding !== 'object') {
          offenders.push(`${rule.id} produced a non-object finding`)
          continue
        }
        // The `Check` contract in the model: every one of these is rendered directly by the
        // checks panel, so a rule may not emit a finding with a hole in it.
        for (const key of ['id', 'state', 'weight', 'label', 'explanation', 'anchor'] as const) {
          if (finding[key] === undefined || finding[key] === null) {
            offenders.push(`${rule.id} produced a finding with no ${key}`)
          }
        }
      }
    }
    expect(offenders, `rule failures:\n${offenders.join('\n') || '(none)'}`).toEqual([])
  })

  it('produces a check summary without leaving a finding unevaluated by accident', () => {
    const result = runChecks(report)
    expect(Array.isArray(result.checks)).toBe(true)
    expect(result.summary).toBeTypeOf('object')
    expect(result.summary).not.toBeNull()
  })
})

describe('the section inventory is internally coherent', () => {
  it('gives every section a unique id and a stable anchor', () => {
    const ids = report.reports.map(entry => entry.sectionId)
    expect(new Set(ids).size, `duplicate section ids in ${ids.join(', ')}`).toBe(ids.length)
    for (const entry of report.reports) {
      expect(entry.anchor, `anchor for ${entry.sectionId}`).toBeTypeOf('string')
      expect(entry.anchor.length, `anchor for ${entry.sectionId}`).toBeGreaterThan(0)
    }
  })

  it('orders the sections as the generator sent them', () => {
    // `index` is the join back to the generator's REGISTRY order; a gap means a section was
    // dropped somewhere between the JSON and the registry.
    expect(report.reports.map(entry => entry.index)).toEqual(report.reports.map((_, i) => i))
  })

  it('knows about at least as many section ids as the report carries', () => {
    expect(report.reports.length).toBeLessThanOrEqual(KNOWN_SECTION_IDS.length)
  })
})
