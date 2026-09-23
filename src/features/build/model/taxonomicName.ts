/**
 * Turning a stored proteome name into the form a reader expects to see.
 *
 * The roster stores names lowercase with underscores for spaces (`create_taxonomy.pl`'s own
 * convention: "homo_sapiens", "fusobacterium_nucleatum_subsp._nucleatum"). Only the very first
 * letter is capitalised - anything past it, including a subspecies qualifier like "subsp." or
 * "pv.", is left exactly as the roster stored it, so title-casing never invents capitals a
 * taxonomist did not write.
 */

import type { ProteomeRosterRow } from './types'

export function humaniseTaxonomicName(name: string): string {
  const spaced = name.replace(/_/g, ' ').trim()
  if (spaced === '') return spaced
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/**
 * One lookup built once per report: the proteome roster's `name`, humanised, keyed by `oscode`.
 * A row missing either field contributes nothing - there is no name to show for it either way.
 */
export function taxonomicNameByOscode(
  roster: readonly ProteomeRosterRow[]
): ReadonlyMap<string, string> {
  const byOscode = new Map<string, string>()
  for (const row of roster) {
    if (row.oscode === null || row.name === null) continue
    byOscode.set(row.oscode, humaniseTaxonomicName(row.name))
  }
  return byOscode
}
