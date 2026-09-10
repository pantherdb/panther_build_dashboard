/**
 * Byte counts, rendered as a reader would compare them against the cluster.
 *
 * Lives in `@panther.core` rather than `app/format.ts` because `src/features/build/model`
 * needs it too, and `app/format.ts` imports from that model -- putting it there would make the
 * dependency circular. This module imports nothing but the shared vocabulary, as `vocabulary.ts`
 * itself does.
 *
 * The report keeps byte counts NUMERIC in `build_state.json`; formatting happens here, at the
 * edge. That is deliberate: `GenericTable` sorts on the raw value while displaying the formatted
 * one, so a column stays ordered by true size. Formatting into the JSON instead would sort
 * lexicographically and put `9.1 MB` above `1.4 GB`.
 */

import { ABSENT_MARK } from './vocabulary'

/** 1024-based units, labelled as `ls -h` and `du -h` label them. */
const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const
const STEP = 1024

const KEY_SUFFIX = '_bytes'
const BARE_KEY = 'bytes'

/**
 * `1.4 GB`.
 *
 * 1024-based deliberately: these values come from `stat()` on build artifacts, so a reader who
 * sees `1.4 GB` here and runs `du -h` on the same path has to get the same number. Sizes below
 * 1 KB stay whole, where a decimal would be noise; above that, one decimal keeps two sizes an
 * order of magnitude apart from rendering identically.
 *
 * A negative or non-finite size is absent, not `0 B`: an empty file and an unknown size are
 * different claims, the same distinction `books_scan` draws between an empty artifact and a
 * missing one.
 */
export function formatFileSize(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0) {
    return ABSENT_MARK
  }
  let size = value
  let unit = 0
  while (size >= STEP && unit < UNITS.length - 1) {
    size /= STEP
    unit += 1
  }
  if (unit === 0) return `${size} ${UNITS[0]}`
  return `${size.toFixed(1)} ${UNITS[unit]}`
}

/**
 * Whether a table column or headline metric holds a byte count.
 *
 * Keyed on the name so the generic renderer can format a byte column without knowing which
 * section produced it. The unit is in the key by convention on the generator side, which is what
 * makes this safe: `bytes_checked` is a count of things, not a size, and is left alone.
 */
export function isFileSizeKey(key: string): boolean {
  return key === BARE_KEY || key.endsWith(KEY_SUFFIX)
}

/** `bytes` -> `size`, `tarball_bytes` -> `tarball size`: named for what it holds, not its unit. */
export function fileSizeLabel(key: string): string {
  if (key === BARE_KEY) return 'size'
  return `${key.slice(0, -KEY_SUFFIX.length).replace(/_/g, ' ')} size`
}
