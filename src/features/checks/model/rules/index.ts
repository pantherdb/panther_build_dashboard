/**
 * The rule registry.
 *
 * Adding a check is adding a module here and a line below. Nothing in the parser changes, nothing
 * in the components changes, and no existing rule is touched - which is the property the whole
 * layer exists to have.
 *
 * Order is display order within a group. The generator's own warnings come first because they are
 * what the report itself said; everything after them is the dashboard's reading.
 */

import { generatorWarningsRule } from './generatorWarnings'
import { freshnessRule } from './freshness'
import { familyAgreementRule } from './familyAgreement'
import { leafLibraryRule } from './leafLibrary'
import { treeCompletenessRule } from './treeCompleteness'
import { speciesDenominatorRule } from './speciesDenominator'
import { sequenceTerminologyRule } from './sequenceTerminology'
import { nodeTypeCoverageRule } from './nodeTypeCoverage'
import { artifactOrderingRule } from './artifactOrdering'
import { pipelineHolesRule } from './pipelineHoles'
import { proteomeMajorityReleaseRule } from './proteomeMajorityRelease'
import { configSourceStateRule, configUnresolvedRule } from './configSourceState'
import { configLineageRule } from './configLineage'
import { configNotableRule } from './configNotable'
import type { CheckRule } from '../types'

export const CHECK_RULES: readonly CheckRule[] = [
  generatorWarningsRule,
  freshnessRule,
  familyAgreementRule,
  leafLibraryRule,
  treeCompletenessRule,
  speciesDenominatorRule,
  sequenceTerminologyRule,
  nodeTypeCoverageRule,
  artifactOrderingRule,
  pipelineHolesRule,
  proteomeMajorityReleaseRule,
  configSourceStateRule,
  configUnresolvedRule,
  configLineageRule,
  configNotableRule,
]

export {
  artifactOrderingRule,
  configLineageRule,
  configNotableRule,
  configSourceStateRule,
  configUnresolvedRule,
  familyAgreementRule,
  freshnessRule,
  generatorWarningsRule,
  leafLibraryRule,
  nodeTypeCoverageRule,
  pipelineHolesRule,
  proteomeMajorityReleaseRule,
  sequenceTerminologyRule,
  speciesDenominatorRule,
  treeCompletenessRule,
}
