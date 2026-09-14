/**
 * The `mapping` section: how family assignment changes stage by stage.
 *
 * Two facts about this data shape the extractor.
 *
 * `by_mechanism` counts are CUMULATIVE TOTALS at that stage, not per-stage increments, so the
 * per-stage gain has to be differenced against the previous stage that reported the mechanism.
 *
 * There are exactly four mechanisms - `ID`, `BLAST`, `HMM_scoring`, `RECLUSTER_NEW`. `exten` is a
 * STAGE whose gain is booked to `HMM_scoring`; the brief lists "extension" as a mechanism and the
 * data disagrees. Each mechanism gets a stable slot and every stage carries the same
 * `mechanismOrder`, so a chart segment cannot change colour between stages.
 */

import {
  asArray,
  asInteger,
  asNonEmptyString,
  asNumber,
  asRecord,
  percentOf,
  pickUnknown,
  roundTo,
  slugify,
} from '../primitives'
import { generatorDefinitionId } from '../definitions'
import { makeMeta } from '../notes'
import { availabilityFor } from '../status'
import type { NoteSink } from '../notes'
import type {
  KnownMechanism,
  MappingStage,
  MappingSummary,
  MechanismCount,
  MechanismSlot,
} from '../types'
import { sectionBaseNotes } from './input'
import type { SectionInput } from './input'

/** Slot order is fixed here so segment colours are stable across every stage and every state. */
export const KNOWN_MECHANISM_ORDER: readonly KnownMechanism[] = [
  'ID',
  'BLAST',
  'HMM_scoring',
  'RECLUSTER_NEW',
]

export const MECHANISM_LABELS: Record<KnownMechanism, string> = {
  ID: 'ID match',
  BLAST: 'BLAST',
  HMM_scoring: 'HMM scoring',
  RECLUSTER_NEW: 'Reclustering (new)',
}

const STAGE_KEYS = [
  'order',
  'stage',
  'mapping_file',
  'total_seqs',
  'assigned',
  'unassigned',
  'pct_assigned',
  'n_families',
] as const

export function isKnownMechanism(value: string): value is KnownMechanism {
  return (KNOWN_MECHANISM_ORDER as readonly string[]).includes(value)
}

function buildMechanismOrder(mechanisms: readonly string[]): MechanismSlot[] {
  const slots: MechanismSlot[] = KNOWN_MECHANISM_ORDER.map((mechanism, slot) => ({
    mechanism,
    slot,
    label: MECHANISM_LABELS[mechanism],
    definitionId: generatorDefinitionId('mapping', mechanism),
    known: true,
  }))
  // Unknown mechanisms are appended in first-appearance order, never inserted among the known.
  for (const mechanism of mechanisms) {
    if (isKnownMechanism(mechanism)) continue
    if (slots.some(slot => slot.mechanism === mechanism)) continue
    slots.push({
      mechanism,
      slot: slots.length,
      // No curated label: RECLUSTER, `(blank)` and `(other)` have always rendered as the raw
      // string here. `DefinedTerm` substitutes the generator's label when one exists.
      label: mechanism,
      definitionId: generatorDefinitionId('mapping', mechanism),
      known: false,
    })
  }
  return slots
}

export function extractMapping(section: SectionInput, sink: NoteSink): MappingSummary {
  const scope = `section:${section.sectionId}`
  const hasData = section.dataRecord !== null
  const notes = sectionBaseNotes(section, sink, 'sequence mapping')

  const meta = makeMeta({
    availability: availabilityFor(section.status, hasData),
    sectionId: section.sectionId,
    message: section.message,
    status: section.status,
    notes,
  })

  /* Stage rows, ordered by the report's own `order` field where it is usable. */
  const rawRows = asArray(section.dataRecord?.rows)
  const rowSeeds = rawRows
    .map((raw, index) => ({ raw, record: asRecord(raw), index }))
    .filter(seed => {
      if (seed.record === null) {
        sink.add('warning', scope, `Mapping row ${seed.index + 1} is not an object; skipped.`)
        return false
      }
      return true
    })
  const orders = rowSeeds.map(seed => asInteger(seed.record?.order))
  const orderable = orders.every(order => order !== null)
  const ordered = [...rowSeeds].sort((a, b) => {
    if (orderable) {
      const delta = (asInteger(a.record?.order) ?? 0) - (asInteger(b.record?.order) ?? 0)
      if (delta !== 0) return delta
    }
    return a.index - b.index
  })

  /* Cumulative mechanism totals, keyed by stage name. */
  const mechanismSeen: string[] = []
  const cumulativeByStage = new Map<string, Map<string, number>>()
  for (const entry of asArray(section.dataRecord?.by_mechanism)) {
    const record = asRecord(entry)
    if (record === null) {
      sink.add('warning', scope, 'A by_mechanism row is not an object; skipped.')
      continue
    }
    const stage = asNonEmptyString(record.stage)
    const mechanism = asNonEmptyString(record.mechanism)
    const count = asInteger(record.count)
    if (stage === null || mechanism === null) {
      sink.add('warning', scope, 'A by_mechanism row is missing its stage or mechanism; skipped.')
      continue
    }
    if (!mechanismSeen.includes(mechanism)) mechanismSeen.push(mechanism)
    if (!isKnownMechanism(mechanism)) {
      sink.add(
        'info',
        scope,
        `Mechanism "${mechanism}" is not one of the four this model knows; it is given its own slot.`
      )
    }
    const forStage = cumulativeByStage.get(stage) ?? new Map<string, number>()
    if (count !== null) forStage.set(mechanism, count)
    cumulativeByStage.set(stage, forStage)
  }

  const mechanismOrder = buildMechanismOrder(mechanismSeen)

  /* Stages, with mechanism deltas differenced against the last stage that reported each one. */
  const lastCumulative = new Map<string, number>()
  let previousAssigned: number | null = null
  let previousTotal: number | null = null
  let previousFamilies: number | null = null

  const stages: MappingStage[] = ordered.map(seed => {
    const record = seed.record
    const stageName = asNonEmptyString(record?.stage) ?? `stage_${seed.index + 1}`
    const totalSequences = asInteger(record?.total_seqs)
    const assigned = asInteger(record?.assigned)
    const unassigned = asInteger(record?.unassigned)
    const families = asInteger(record?.n_families)
    const reportedPct = asNumber(record?.pct_assigned)
    const forStage = cumulativeByStage.get(stageName) ?? new Map<string, number>()

    const byMechanism: MechanismCount[] = mechanismOrder.map(slot => {
      const cumulative = forStage.get(slot.mechanism)
      if (cumulative === undefined) {
        // Not reported at this stage. Absence is not zero, so the value stays null.
        return {
          mechanism: slot.mechanism,
          slot: slot.slot,
          cumulative: null,
          delta: null,
          isFirstAppearance: false,
        }
      }
      const previous = lastCumulative.get(slot.mechanism)
      const isFirstAppearance = previous === undefined
      return {
        mechanism: slot.mechanism,
        slot: slot.slot,
        cumulative,
        delta: isFirstAppearance ? cumulative : cumulative - previous,
        isFirstAppearance,
      }
    })
    for (const [mechanism, cumulative] of forStage) lastCumulative.set(mechanism, cumulative)

    const stage: MappingStage = {
      id: slugify(stageName),
      stage: stageName,
      order: asInteger(record?.order),
      mappingFile: asNonEmptyString(record?.mapping_file),
      totalSequences,
      assigned,
      unassigned,
      pctAssigned: reportedPct,
      recomputedPctAssigned: percentOf(assigned, totalSequences),
      families,
      assignedDelta:
        previousAssigned === null || assigned === null ? null : assigned - previousAssigned,
      totalSequencesDelta:
        previousTotal === null || totalSequences === null ? null : totalSequences - previousTotal,
      familiesDelta:
        previousFamilies === null || families === null ? null : families - previousFamilies,
      byMechanism,
      unknownFields: pickUnknown(record, STAGE_KEYS),
    }

    if (assigned !== null) previousAssigned = assigned
    if (totalSequences !== null) previousTotal = totalSequences
    if (families !== null) previousFamilies = families
    return stage
  })

  const orphanStages = [...cumulativeByStage.keys()].filter(
    stage => !stages.some(entry => entry.stage === stage)
  )
  if (orphanStages.length > 0) {
    sink.add(
      'warning',
      scope,
      'by_mechanism references stages with no matching mapping row.',
      orphanStages.join(', ')
    )
  }

  const first = stages[0] ?? null
  const final = stages[stages.length - 1] ?? null
  const firstPct = first === null ? null : (first.pctAssigned ?? first.recomputedPctAssigned)
  const finalPct = final === null ? null : (final.pctAssigned ?? final.recomputedPctAssigned)

  const headlineRecord = asRecord(section.dataRecord?.headline)

  return {
    ...meta,
    stages,
    mechanismOrder,
    firstStageId: first?.id ?? null,
    finalStageId: final?.id ?? null,
    inputSequences: first?.totalSequences ?? null,
    finalTotalSequences: final?.totalSequences ?? null,
    finalAssigned: final?.assigned ?? null,
    finalFamilies: final?.families ?? null,
    firstPctAssigned: firstPct,
    finalPctAssigned: finalPct,
    assignmentGainPoints:
      firstPct === null || finalPct === null ? null : roundTo(finalPct - firstPct, 1),
    declaredHeadline: {
      finalStage: asNonEmptyString(headlineRecord?.final_stage),
      finalTotalSeqs: asInteger(headlineRecord?.final_total_seqs),
      finalAssigned: asInteger(headlineRecord?.final_assigned),
      finalPctAssigned: asNumber(headlineRecord?.final_pct_assigned),
      finalFamilies: asInteger(headlineRecord?.final_n_families),
    },
  }
}
