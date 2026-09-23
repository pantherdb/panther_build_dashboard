import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { findSidecarContractOffenders } from '@tests/support/sidecarContract'

/**
 * `findSidecarContractOffenders` against synthetic input, in a real temp directory on disk (not
 * `docs/` - nothing here ever touches the checked-in report). The live report references no
 * sidecar today, so `liveReport.contract.test.ts` alone would never actually exercise a failure;
 * this is what proves the invariant catches each of the ways "copy both files" can be missed.
 */

let dir: string

afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true })
  dir = ''
})

function mainReport(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    target: 'target_test',
    generated_at: '2026-09-22T00:00:00Z',
    sections: [
      {
        id: 'giga_usf',
        status: 'ok',
        data: { sidecar: { file: 'build_state.giga_usf.json', bytes: 0, sha256: '' } },
      },
    ],
    ...overrides,
  }
}

function writeSidecar(fileName: string, content: string): { bytes: number; sha256: string } {
  dir = dir || fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-contract-'))
  fs.writeFileSync(path.join(dir, fileName), content)
  const bytes = Buffer.byteLength(content)
  const sha256 = createHash('sha256').update(content).digest('hex')
  return { bytes, sha256 }
}

describe('findSidecarContractOffenders', () => {
  it('has no offenders when the sidecar matches on every field', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-contract-'))
    const content = JSON.stringify({
      schema_version: 1,
      target: 'target_test',
      generated_at: '2026-09-22T00:00:00Z',
      section_id: 'giga_usf',
      data: { families: [] },
    })
    const { bytes, sha256 } = writeSidecar('build_state.giga_usf.json', content)
    const raw = mainReport({
      sections: [
        {
          id: 'giga_usf',
          status: 'ok',
          data: { sidecar: { file: 'build_state.giga_usf.json', bytes, sha256 } },
        },
      ],
    })
    expect(findSidecarContractOffenders(raw, dir)).toEqual([])
  })

  it('is empty when no section references a sidecar at all', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-contract-'))
    const raw = mainReport({ sections: [{ id: 'giga', status: 'ok', data: {} }] })
    expect(findSidecarContractOffenders(raw, dir)).toEqual([])
  })

  it('flags a referenced file missing from docs/', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-contract-'))
    const raw = mainReport()
    const offenders = findSidecarContractOffenders(raw, dir)
    expect(offenders).toHaveLength(1)
    expect(offenders[0]).toMatch(/missing from docs\//)
  })

  it('flags a sidecar whose target does not match the main report', () => {
    const content = JSON.stringify({
      schema_version: 1,
      target: 'a_different_target',
      generated_at: '2026-09-22T00:00:00Z',
      section_id: 'giga_usf',
      data: { families: [] },
    })
    const { bytes, sha256 } = writeSidecar('build_state.giga_usf.json', content)
    const raw = mainReport({
      sections: [
        {
          id: 'giga_usf',
          status: 'ok',
          data: { sidecar: { file: 'build_state.giga_usf.json', bytes, sha256 } },
        },
      ],
    })
    const offenders = findSidecarContractOffenders(raw, dir)
    expect(offenders.some(m => m.includes('target does not match'))).toBe(true)
  })

  it('flags a sidecar whose generated_at does not match the main report', () => {
    const content = JSON.stringify({
      schema_version: 1,
      target: 'target_test',
      generated_at: '2099-01-01T00:00:00Z',
      section_id: 'giga_usf',
      data: { families: [] },
    })
    const { bytes, sha256 } = writeSidecar('build_state.giga_usf.json', content)
    const raw = mainReport({
      sections: [
        {
          id: 'giga_usf',
          status: 'ok',
          data: { sidecar: { file: 'build_state.giga_usf.json', bytes, sha256 } },
        },
      ],
    })
    const offenders = findSidecarContractOffenders(raw, dir)
    expect(offenders.some(m => m.includes('generated_at does not match'))).toBe(true)
  })

  it('flags a sidecar whose section_id does not match its owning section', () => {
    const content = JSON.stringify({
      schema_version: 1,
      target: 'target_test',
      generated_at: '2026-09-22T00:00:00Z',
      section_id: 'giga',
      data: { families: [] },
    })
    const { bytes, sha256 } = writeSidecar('build_state.giga_usf.json', content)
    const raw = mainReport({
      sections: [
        {
          id: 'giga_usf',
          status: 'ok',
          data: { sidecar: { file: 'build_state.giga_usf.json', bytes, sha256 } },
        },
      ],
    })
    const offenders = findSidecarContractOffenders(raw, dir)
    expect(offenders.some(m => m.includes('section_id is'))).toBe(true)
  })

  it('flags a byte-count mismatch', () => {
    const content = JSON.stringify({
      schema_version: 1,
      target: 'target_test',
      generated_at: '2026-09-22T00:00:00Z',
      section_id: 'giga_usf',
      data: { families: [] },
    })
    const { sha256 } = writeSidecar('build_state.giga_usf.json', content)
    const raw = mainReport({
      sections: [
        {
          id: 'giga_usf',
          status: 'ok',
          data: { sidecar: { file: 'build_state.giga_usf.json', bytes: 99999, sha256 } },
        },
      ],
    })
    const offenders = findSidecarContractOffenders(raw, dir)
    expect(offenders.some(m => m.includes('bytes on disk'))).toBe(true)
  })

  it('flags a sha256 mismatch', () => {
    const content = JSON.stringify({
      schema_version: 1,
      target: 'target_test',
      generated_at: '2026-09-22T00:00:00Z',
      section_id: 'giga_usf',
      data: { families: [] },
    })
    const { bytes } = writeSidecar('build_state.giga_usf.json', content)
    const raw = mainReport({
      sections: [
        {
          id: 'giga_usf',
          status: 'ok',
          data: {
            sidecar: { file: 'build_state.giga_usf.json', bytes, sha256: 'not-the-real-hash' },
          },
        },
      ],
    })
    const offenders = findSidecarContractOffenders(raw, dir)
    expect(offenders.some(m => m.includes('sha256 does not match'))).toBe(true)
  })

  it('flags a sidecar file that is not valid JSON', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-contract-'))
    fs.writeFileSync(path.join(dir, 'build_state.giga_usf.json'), '{not json')
    const raw = mainReport()
    const offenders = findSidecarContractOffenders(raw, dir)
    expect(offenders.some(m => m.includes('does not parse as JSON'))).toBe(true)
  })
})
