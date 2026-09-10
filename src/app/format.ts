/**
 * Presentation formatting shared by the shell, the preamble and the pipeline.
 *
 * Every timestamp in this application is rendered in UTC from the report's own ISO string, and
 * never through `toLocaleString`. A build record is read years later on a different machine: a
 * value that shifts with the reader's timezone is not a record, and two components formatting the
 * same instant differently is how a report starts contradicting itself.
 */

import type { TimePoint } from '@/features/build/model'
import { ABSENT_MARK } from '@/@panther.core/vocabulary'

// Re-exported so callers reaching for a formatter find it here with the others. The
// implementation lives in @panther.core because features/build/model needs it too, and this
// module imports from that model -- see @panther.core/fileSize.ts.
export { formatFileSize } from '@/@panther.core/fileSize'

/** `2026-08-20 23:26:31 UTC`. */
export function formatUtc(point: TimePoint | null | undefined): string {
  if (!point?.iso) return ABSENT_MARK
  const [date, rest] = point.iso.split('T')
  const clock = (rest ?? '').replace('Z', '').split('.')[0]
  return `${date} ${clock} UTC`
}

/** `08-20 23:26` - for a dense column where the year is already established. */
export function formatUtcShort(point: TimePoint | null | undefined): string {
  if (!point?.iso) return ABSENT_MARK
  const [date, rest] = point.iso.split('T')
  const clock = (rest ?? '').replace('Z', '').split('.')[0]
  return `${date.slice(5)} ${clock.slice(0, 5)}`
}

/** `2026-08-20` - the calendar day only. */
export function formatUtcDate(point: TimePoint | null | undefined): string {
  if (!point?.iso) return ABSENT_MARK
  return point.iso.split('T')[0]
}

/** `23:26` from an epoch-seconds instant, for a wall-clock axis tick. */
export function formatUtcClockFromEpoch(epochSeconds: number): string {
  if (!Number.isFinite(epochSeconds)) return ABSENT_MARK
  return new Date(epochSeconds * 1000).toISOString().slice(11, 16)
}

/** `08-17 23:26` from an epoch-seconds instant. */
export function formatUtcShortFromEpoch(epochSeconds: number): string {
  if (!Number.isFinite(epochSeconds)) return ABSENT_MARK
  const iso = new Date(epochSeconds * 1000).toISOString()
  return `${iso.slice(5, 10)} ${iso.slice(11, 16)}`
}

/** A grouped integer, or the absent mark. Never a zero standing in for "unknown". */
export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return ABSENT_MARK
  return value.toLocaleString()
}

/** `1 hole` / `2 holes`. English pluralisation only; the app has no i18n layer. */
export function plural(count: number, singular: string, pluralForm?: string): string {
  return count === 1 ? singular : (pluralForm ?? `${singular}s`)
}
