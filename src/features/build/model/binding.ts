/**
 * The section-to-phase binding registry.
 *
 * The pipeline is the spine of the experience, so reports hang from the phase they describe
 * rather than forming a navigation model that mirrors `sections[].id`. This registry is the one
 * place that relationship is written down. It supports many sections per phase and one section
 * contributing to several phases, and it reads an optional per-section phase hint first so the
 * binding can become data-driven later without a model change.
 *
 * Anything unmapped collects under `UNATTACHED_PHASE_ID` at the end of the spine. Unknown future
 * sections are surfaced there, never hidden.
 */

import { slugify } from './primitives'
import type { RawSection, ReportPlacement } from './types'

/**
 * Phase ids are slugs of the phase names the report declares, so they stay stable across the
 * fixture transforms. These constants exist so the registry does not hard-code strings twice.
 */
export const PHASE_IDS = {
  setup: 'setup-resource-download',
  previousLibraryRebuild: 'previous-library-rebuild',
  sequenceToFamilyMapping: 'sequence-to-family-mapping',
  mappingCleanupPass1: 'mapping-cleanup-pass-1',
  extenBuildAndScoring: 'exten-build-and-scoring',
  mappingCleanupPass2: 'mapping-cleanup-pass-2',
  msaBuild: 'msa-build-orig',
  treeBuilding: 'tree-building-giga',
  nodeForwardTracking: 'node-forward-tracking',
  subfamiliesHtOrthologs: 'subfamilies-ht-orthologs',
  dbLoadFileGeneration: 'db-load-file-generation',
  newLibraryHmmGeneration: 'new-library-hmm-generation',
  libraryExportProducts: 'library-export-products',
  finalPackaging: 'final-packaging',
} as const

/** The synthetic phase every unmapped or unknown section hangs from. */
export const UNATTACHED_PHASE_ID = 'unattached'
export const UNATTACHED_PHASE_NAME = 'Unattached reports'

export interface SectionBinding {
  sectionId: string
  /** Where the section belongs in the layout, independent of which phase it describes. */
  placement: ReportPlacement
  /** The phase the section primarily describes. `null` for preamble/pipeline-wide sections. */
  primaryPhaseId: string | null
  /**
   * Further phases the section contributes to. Mapping stages, for instance, span the cleanup and
   * extension phases as well as the mapping phase itself.
   */
  contributingPhaseIds: readonly string[]
  /** Why this binding exists, so a future reader does not have to guess. */
  rationale: string
}

const BINDINGS: readonly SectionBinding[] = [
  {
    sectionId: 'config_ledger',
    placement: 'preamble',
    primaryPhaseId: null,
    contributingPhaseIds: [PHASE_IDS.setup],
    rationale:
      'Configuration and provenance are the header of the build record, not a peer report tab. ' +
      'The snapshot is taken at build start, which is why it also contributes to setup.',
  },
  {
    sectionId: 'proteomes',
    placement: 'phase',
    primaryPhaseId: PHASE_IDS.setup,
    contributingPhaseIds: [],
    rationale:
      'The roster is stamped by create_taxonomy.pl while the proteomes are downloaded, so it ' +
      'describes setup. It is the per-proteome answer to the question the config ledger used to ' +
      'answer once for the whole build.',
  },
  {
    sectionId: 'progress',
    placement: 'pipeline',
    primaryPhaseId: null,
    contributingPhaseIds: [],
    rationale: 'This section IS the spine; it does not hang from a phase.',
  },
  {
    sectionId: 'mapping',
    placement: 'phase',
    primaryPhaseId: PHASE_IDS.sequenceToFamilyMapping,
    contributingPhaseIds: [
      PHASE_IDS.mappingCleanupPass1,
      PHASE_IDS.extenBuildAndScoring,
      PHASE_IDS.mappingCleanupPass2,
      PHASE_IDS.treeBuilding,
    ],
    rationale:
      'Mapping stages run across the mapping, cleanup, extension and post-GIGA phases, so one ' +
      'report legitimately contributes to five places on the spine.',
  },
  {
    sectionId: 'recluster',
    placement: 'phase',
    primaryPhaseId: PHASE_IDS.sequenceToFamilyMapping,
    contributingPhaseIds: [],
    rationale:
      'Reclustering is one stage of the mapping phase - order 60, between HMM scoring and the ' +
      'first cleanup pass - so unlike `mapping`, which spans five places on the spine, this ' +
      'section describes exactly one. It is where new families are created, which `mapping` ' +
      'records only as a rise in the family count across one stage boundary.',
  },
  {
    sectionId: 'msa',
    placement: 'phase',
    primaryPhaseId: PHASE_IDS.msaBuild,
    contributingPhaseIds: [PHASE_IDS.extenBuildAndScoring],
    rationale:
      'One report covering both seeded MAFFT passes. The `orig` pass IS the MSA build phase; ' +
      'the `exten` pass runs inside exten build and scoring, and is the one that aligns against ' +
      "the previous release rather than against this build's own draft. Splitting them into two " +
      'sections would put the same five outcome buckets on the spine twice and lose the ' +
      'comparison between them, which is the reading the section exists for.',
  },
  {
    sectionId: 'giga',
    placement: 'phase',
    primaryPhaseId: PHASE_IDS.treeBuilding,
    contributingPhaseIds: [],
    rationale: 'GIGA statistics describe tree building.',
  },
  {
    sectionId: 'node_tracking',
    placement: 'phase',
    primaryPhaseId: PHASE_IDS.nodeForwardTracking,
    contributingPhaseIds: [],
    rationale: 'Node forward tracking statistics describe their own phase.',
  },
  {
    sectionId: 'ibd_sf_roots',
    placement: 'phase',
    primaryPhaseId: PHASE_IDS.subfamiliesHtOrthologs,
    contributingPhaseIds: [],
    rationale:
      'The two stages it reports -- building the force list of PAINT-implied subfamily roots, ' +
      'and re-partitioning auto_subfamily output to honour them -- both run inside this phase. ' +
      'Its subfamily before/after counts are also the only report on what auto_subfamily itself ' +
      'produced, since that step writes only the input the re-partition consumes.',
  },
  {
    sectionId: 'list_ht',
    placement: 'phase',
    primaryPhaseId: PHASE_IDS.subfamiliesHtOrthologs,
    contributingPhaseIds: [],
    rationale:
      'listHT runs in this phase and nowhere else; the HT in the phase name is this section. ' +
      'It reports horizontal transfer nodes per family, not the row count of listHTFams.tsv, ' +
      'because one node emits a row per recipient species.',
  },
  {
    sectionId: 'orthologs',
    placement: 'phase',
    primaryPhaseId: PHASE_IDS.subfamiliesHtOrthologs,
    contributingPhaseIds: [],
    rationale:
      'The pairwise homolog run, the O/LDO filter and the FTP product build are all stages of ' +
      'this phase. It reports coverage, scale and product completeness rather than pair counts: ' +
      'the per-book files are pairwise across ~15,000 books, so counting rows is not affordable.',
  },
  {
    sectionId: 'library',
    placement: 'phase',
    primaryPhaseId: PHASE_IDS.libraryExportProducts,
    contributingPhaseIds: [PHASE_IDS.dbLoadFileGeneration, PHASE_IDS.subfamiliesHtOrthologs],
    rationale:
      'Library contents are what the export phase produces; the counts are assembled during DB ' +
      'load generation and subfamily work.',
  },
  {
    sectionId: 'prev_lib',
    placement: 'phase',
    primaryPhaseId: PHASE_IDS.previousLibraryRebuild,
    contributingPhaseIds: [],
    rationale: 'The previous-library comparison depends on the previous library rebuild inputs.',
  },
  {
    sectionId: 'other_reports',
    placement: 'phase',
    primaryPhaseId: PHASE_IDS.previousLibraryRebuild,
    contributingPhaseIds: [PHASE_IDS.sequenceToFamilyMapping, PHASE_IDS.libraryExportProducts],
    rationale:
      'Previous-versus-new counts and UniProt agreement come from the previous-library inputs; ' +
      'the BLAST QC metrics belong to mapping and the UniRules table to export products.',
  },
]

const BINDING_BY_SECTION = new Map(BINDINGS.map(binding => [binding.sectionId, binding]))

export const SECTION_BINDINGS: readonly SectionBinding[] = BINDINGS

export function hasBinding(sectionId: string): boolean {
  return BINDING_BY_SECTION.has(sectionId)
}

export function getBinding(sectionId: string): SectionBinding | null {
  return BINDING_BY_SECTION.get(sectionId) ?? null
}

/**
 * Reads the optional per-section phase hint. Two spellings are accepted because the future schema
 * has not settled on one; whichever appears wins over the static registry.
 */
export function phaseHintOf(section: RawSection | null | undefined): string | null {
  if (section === null || section === undefined) return null
  const raw = typeof section.phase_id === 'string' ? section.phase_id : section.phase
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return trimmed === '' ? null : slugify(trimmed)
}

export interface ResolvedBinding {
  placement: ReportPlacement
  primaryPhaseId: string | null
  /** Primary first, then contributing, de-duplicated. Empty for preamble/pipeline sections. */
  phaseIds: string[]
  /** The hint value, when the generator supplied one. */
  phaseHint: string | null
  /** True when a static registry entry exists for this section id. */
  known: boolean
}

/**
 * Resolves a section to its phases. Order of authority: the data-driven hint, then the static
 * registry, then `unattached`.
 */
export function resolveBinding(
  sectionId: string,
  section?: RawSection | null,
  knownPhaseIds?: readonly string[]
): ResolvedBinding {
  const hint = phaseHintOf(section)
  const binding = getBinding(sectionId)
  const phaseSet = new Set<string>()

  let placement: ReportPlacement = binding?.placement ?? 'unattached'
  let primary: string | null = binding?.primaryPhaseId ?? null

  if (hint !== null) {
    primary = hint
    placement = 'phase'
  }
  if (primary !== null) phaseSet.add(primary)
  for (const phaseId of binding?.contributingPhaseIds ?? []) phaseSet.add(phaseId)

  let phaseIds = [...phaseSet]
  if (knownPhaseIds !== undefined && knownPhaseIds.length > 0) {
    const known = new Set(knownPhaseIds)
    phaseIds = phaseIds.filter(phaseId => known.has(phaseId))
    if (primary !== null && !known.has(primary)) primary = phaseIds[0] ?? null
  }

  // A section that claims a phase nobody declared is surfaced, not silently dropped.
  if (placement === 'phase' && phaseIds.length === 0) placement = 'unattached'

  return {
    placement,
    primaryPhaseId: primary,
    phaseIds,
    phaseHint: hint,
    known: binding !== null,
  }
}

/** Every section bound to a phase, primary bindings first. */
export function sectionIdsForPhase(
  phaseId: string,
  resolved: readonly { sectionId: string; primaryPhaseId: string | null; phaseIds: string[] }[]
): string[] {
  const primary = resolved
    .filter(entry => entry.primaryPhaseId === phaseId)
    .map(entry => entry.sectionId)
  const contributing = resolved
    .filter(entry => entry.primaryPhaseId !== phaseId && entry.phaseIds.includes(phaseId))
    .map(entry => entry.sectionId)
  return [...primary, ...contributing]
}
