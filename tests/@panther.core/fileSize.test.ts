import { describe, expect, it } from 'vitest'
import { fileSizeLabel, formatFileSize, isFileSizeKey } from '@/@panther.core/fileSize'
import { ABSENT_MARK } from '@/@panther.core/vocabulary'

/**
 * File sizes are read against the cluster, so they are 1024-based with `ls -h` / `du -h` labels:
 * a reader who sees `1.4 GB` here and runs `du -h` on the same path must get the same number.
 *
 * The key convention lets the generic renderer format a byte column without knowing which
 * section produced it. `orthologs` is the only collector emitting byte values today, so any
 * future one gets this free.
 */
describe('formatFileSize', () => {
  it('leaves small sizes in whole bytes, where a decimal would be noise', () => {
    expect(formatFileSize(0)).toBe('0 B')
    expect(formatFileSize(999)).toBe('999 B')
  })

  it('steps up a unit at 1024, not at 1000', () => {
    expect(formatFileSize(1023)).toBe('1023 B')
    expect(formatFileSize(1024)).toBe('1.0 KB')
    expect(formatFileSize(1024 * 1024)).toBe('1.0 MB')
    expect(formatFileSize(1024 ** 3)).toBe('1.0 GB')
    expect(formatFileSize(1024 ** 4)).toBe('1.0 TB')
  })

  it('keeps one decimal, so two sizes an order apart never render identically', () => {
    expect(formatFileSize(1_503_238_553)).toBe('1.4 GB')
    expect(formatFileSize(9_500_000)).toBe('9.1 MB')
  })

  it('stops at TB rather than inventing a unit', () => {
    expect(formatFileSize(1024 ** 5)).toBe('1024.0 TB')
  })

  it('marks a missing or nonsensical size absent instead of printing 0 B', () => {
    // A zero-byte file and "we do not know" are different claims -- the same distinction
    // books_scan draws between an empty artifact and a missing one.
    expect(formatFileSize(null)).toBe(ABSENT_MARK)
    expect(formatFileSize(undefined)).toBe(ABSENT_MARK)
    expect(formatFileSize(Number.NaN)).toBe(ABSENT_MARK)
    expect(formatFileSize(Number.POSITIVE_INFINITY)).toBe(ABSENT_MARK)
    expect(formatFileSize(-1)).toBe(ABSENT_MARK)
  })
})

describe('the byte-column convention', () => {
  it('recognises a bare `bytes` column and any `*_bytes` key', () => {
    expect(isFileSizeKey('bytes')).toBe(true)
    expect(isFileSizeKey('tarball_bytes')).toBe(true)
    expect(isFileSizeKey('orthologs_all_bytes')).toBe(true)
  })

  it('leaves anything else alone, including a count that merely mentions bytes', () => {
    expect(isFileSizeKey('book')).toBe(false)
    expect(isFileSizeKey('bytes_checked')).toBe(false)
    expect(isFileSizeKey('ht_nodes')).toBe(false)
  })

  it('names the column for what it holds rather than for its unit', () => {
    expect(fileSizeLabel('bytes')).toBe('size')
    expect(fileSizeLabel('tarball_bytes')).toBe('tarball size')
  })
})
