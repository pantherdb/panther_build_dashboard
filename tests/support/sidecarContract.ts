/**
 * The sidecar invariant `liveReport.contract.test.ts` enforces: any section whose `data.sidecar`
 * names a file must have that file actually copied alongside the main report, parseable, and
 * describing the SAME report - `section_id`, `target` and `generated_at` all equal - with `bytes`
 * and `sha256` (whichever the reference carries) matching the bytes really on disk.
 *
 * Pulled out into its own pure function so it can be exercised directly against a synthetic
 * broken input in `sidecarContract.test.ts`, not only against whatever the live report happens to
 * reference today - the live file currently references none at all, which would otherwise leave
 * this invariant untested by omission.
 */

import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { isRecord } from '@/features/build/model'

export function findSidecarContractOffenders(raw: unknown, docsDir: string): string[] {
  const offenders: string[] = []
  const root = isRecord(raw) ? raw : null
  const sections = Array.isArray(root?.sections) ? root.sections : []

  for (const section of sections) {
    if (!isRecord(section)) continue
    const sectionId = typeof section.id === 'string' ? section.id : '(unknown section)'
    const data = isRecord(section.data) ? section.data : null
    const sidecarRef = data !== null && isRecord(data.sidecar) ? data.sidecar : null
    if (sidecarRef === null) continue

    const file = typeof sidecarRef.file === 'string' ? sidecarRef.file : null
    if (file === null) {
      offenders.push(`${sectionId}: sidecar reference has no file name`)
      continue
    }

    const sidecarPath = path.join(docsDir, file)
    if (!fs.existsSync(sidecarPath)) {
      offenders.push(
        `${sectionId}: references ${file}, missing from docs/ - copy it alongside build_state.json`
      )
      continue
    }

    const bytes = fs.readFileSync(sidecarPath)
    let parsed: unknown
    try {
      parsed = JSON.parse(bytes.toString('utf8'))
    } catch (error) {
      offenders.push(`${sectionId}: ${file} does not parse as JSON (${String(error)})`)
      continue
    }
    if (!isRecord(parsed)) {
      offenders.push(`${sectionId}: ${file} is not a JSON object`)
      continue
    }

    if (parsed.section_id !== sectionId) {
      offenders.push(`${sectionId}: ${file}'s section_id is ${String(parsed.section_id)}`)
    }
    if (parsed.target !== root?.target) {
      offenders.push(`${sectionId}: ${file}'s target does not match the main report's`)
    }
    if (parsed.generated_at !== root?.generated_at) {
      offenders.push(`${sectionId}: ${file}'s generated_at does not match the main report's`)
    }
    if (typeof sidecarRef.bytes === 'number' && sidecarRef.bytes !== bytes.length) {
      offenders.push(
        `${sectionId}: ${file} is ${bytes.length} bytes on disk, reference says ${sidecarRef.bytes}`
      )
    }
    if (typeof sidecarRef.sha256 === 'string') {
      const hash = createHash('sha256').update(bytes).digest('hex')
      if (hash !== sidecarRef.sha256) {
        offenders.push(`${sectionId}: ${file}'s sha256 does not match the reference`)
      }
    }
  }
  return offenders
}
