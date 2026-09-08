import { Tooltip } from '@mantine/core'
import { Link } from 'react-router-dom'
import {
  CopyButton,
  Disclosure,
  KeyValueList,
  StatusChip,
  UnknownValue,
} from '@/@panther.core/components'
import type { KeyValueItem } from '@/@panther.core/components'
import { formatCount, formatUtc, plural } from '@/app/format'
import { useBuildReport } from '@/features/build/hooks'
import { formatDuration, reportRoute } from '@/features/build/model'
import type { BuildReport } from '@/features/build/model'
import type { StatusKey } from '@/@panther.core/vocabulary'
import { FixtureStateNotice } from '@/features/preamble/components/FixtureStateNotice'
import { SchemaNotice } from '@/features/preamble/components/SchemaNotice'
import { ReportMount } from '@/features/reports/registry'

/**
 * The header of a scientific build record.
 *
 * Deliberately not a hero: no large figure, no KPI cards, no colour blocks. Identity, freshness,
 * provenance and inputs are tight label/value rows with mono identifiers, and the only emphasis
 * available is the accent on a row that is genuinely anomalous - a dirty source tree, a declared
 * release that disagrees with the resolved path.
 *
 * Freshness sits here beside identity rather than in a diagnostics tab, because "is this report
 * describing the build I think it is" has to be answered before any figure below it means anything.
 * On the captured report it is Current, and Current is POSITIVE evidence: the report was generated
 * after every artifact it describes, so the lead time is shown as a fact rather than hidden behind
 * a neutral badge.
 *
 * Configuration and provenance are a preamble concern too, so the captured `config.mk` and the
 * resolved ledger hang from a disclosure here instead of becoming a peer report tab.
 */

interface BuildStatusReading {
  status: StatusKey
  label: string
  detail: string
}

function readBuildStatus(report: BuildReport): BuildStatusReading {
  const { pipeline } = report
  const phases = pipeline.phases
  const complete = pipeline.computedHeadline.phasesComplete ?? 0
  const steps = pipeline.computedHeadline.stepsComplete ?? 0
  const stepsTotal = pipeline.computedHeadline.stepsTotal ?? 0
  const detail = `${steps}/${stepsTotal} steps · ${complete}/${phases.length} phases`

  if (phases.length === 0) {
    return { status: 'unknown', label: 'No pipeline reported', detail }
  }
  if (pipeline.steps.some(step => step.status.kind === 'failed' || step.hasFailedAttempt)) {
    return { status: 'failed', label: 'Failed step in this build', detail }
  }
  if (phases.every(phase => phase.status === 'complete')) {
    return { status: 'complete', label: 'Build complete', detail }
  }
  if (pipeline.frontierIndex === null) {
    return { status: 'pending', label: 'Not started', detail }
  }
  return { status: 'active', label: 'Build in progress', detail }
}

function freshnessDetail(report: BuildReport): string | null {
  const lead = report.freshness.leadSeconds
  if (lead === null) return null
  const duration = formatDuration(Math.abs(lead))
  return lead >= 0
    ? `report generated ${duration} after the newest artifact`
    : `an artifact is ${duration} newer than the report`
}

export const BuildPreamble = () => {
  const report = useBuildReport()
  const { identity, freshness, health, config, schema, proteomes } = report
  const status = readBuildStatus(report)
  const lead = freshnessDetail(report)
  const configEntry = report.reports.find(entry => entry.sectionId === 'config_ledger') ?? null

  const identityItems: KeyValueItem[] = [
    { key: 'library', label: 'Library', value: identity.libraryLabel },
    {
      key: 'version',
      label: 'PANTHER version',
      value: identity.pantherVersion,
      absentReason: 'not resolved in the config ledger',
    },
    { key: 'target', label: 'Build target', value: identity.target },
    {
      key: 'generated',
      label: 'Report generated',
      value: formatUtc(identity.generatedAt),
    },
    {
      key: 'sections',
      label: 'Sections in report',
      value: formatCount(identity.sectionCount),
    },
  ]

  const sourceItems: KeyValueItem[] = [
    {
      key: 'revision',
      label: 'Source revision',
      value: identity.sourceRevision,
      absentReason: 'not captured',
      aside:
        identity.sourceRevision === null ? undefined : (
          <CopyButton
            value={identity.sourceRevision}
            iconOnly
            ariaLabel="Copy the full source revision"
          />
        ),
    },
    {
      key: 'dirty',
      label: 'Source tree',
      value:
        identity.sourceDirty === null
          ? null
          : identity.sourceDirty
            ? 'dirty — uncommitted changes at build time'
            : 'clean',
      mono: false,
      attention: identity.sourceDirty === true,
      absentReason: 'not reported',
    },
    { key: 'config-file', label: 'Config file', value: identity.configFile },
    {
      key: 'config-captured',
      label: 'Config snapshot',
      value: formatUtc(config.generatedAt),
      aside: (
        <Tooltip
          label="The config ledger is captured at build start, not at report time."
          withArrow
          multiline
          maw={260}
        >
          <span className="text-ink-faint text-2xs">at build start</span>
        </Tooltip>
      ),
    },
    {
      key: 'unresolved',
      label: 'Unresolved variables',
      value: config.unresolvedVars.length === 0 ? 'none' : config.unresolvedVars.join(', '),
      mono: config.unresolvedVars.length > 0,
      attention: config.unresolvedVars.length > 0,
    },
  ]

  const inputItems: KeyValueItem[] = [
    {
      key: 'qfo-dir',
      label: 'Reference proteome',
      value: identity.qfoDataDir,
      absentReason: 'not resolved',
    },
    {
      // Issue #65 retired QFO_RELEASE_VERSION, and a single declared release could never have
      // described a library drawn from three of them. The roster's own composition replaces it.
      key: 'proteome-releases',
      label: 'Proteome releases',
      value:
        proteomes.compositionLabel === null ? null : (
          <Link
            to={reportRoute('proteomes')}
            className="hover:text-accent underline decoration-dotted underline-offset-2"
          >
            {proteomes.compositionLabel}
          </Link>
        ),
      mono: false,
      absentReason: 'no roster recorded',
      attention: proteomes.offMajorityCount > 0,
      aside:
        proteomes.offMajorityCount > 0 ? (
          <Tooltip
            label={`${proteomes.offMajorityCount} ${plural(
              proteomes.offMajorityCount,
              'proteome'
            )} are not on their source's majority release. Deliberate for a hand-swapped proteome; otherwise a stamping error.`}
            withArrow
            multiline
            maw={300}
          >
            <span>
              <StatusChip
                status="warn"
                label={`${proteomes.offMajorityCount} off majority`}
                size="sm"
                variant="plain"
              />
            </span>
          </Tooltip>
        ) : undefined,
    },
    {
      key: 'previous-library',
      label: 'Previous library',
      value: identity.previousLibraryLabel,
      absentReason: 'no PREV_* inputs resolved',
    },
    {
      key: 'schema',
      label: 'Report schema',
      value: schema.degraded ? (
        <UnknownValue value={schema.reported} kind="schema version" />
      ) : (
        `${schema.version} (supported)`
      ),
      mono: false,
    },
    {
      key: 'activity',
      label: 'Artifact activity',
      value: report.timing.activitySpan.label,
      aside: (
        <StatusChip
          status={report.timing.hasMeasuredTiming ? 'measured' : 'inferred'}
          variant="plain"
        />
      ),
    },
  ]

  const warningStatus: StatusKey = health.generatorWarningCount > 0 ? 'warn' : 'pass'

  return (
    <header
      className="bg-surface-raised rounded-panel pb-raised pb-hairline"
      data-pb-break="avoid"
      aria-label="Build record header"
    >
      <div className="pb-hairline-b flex flex-wrap items-baseline gap-x-3 gap-y-1.5 px-3 py-2">
        <h1 className="text-ink text-sm leading-5 font-semibold">
          {identity.libraryLabel ?? 'Build report'}
        </h1>
        <span className="pb-ident text-ink-faint text-2xs">{identity.target ?? 'no target'}</span>

        <StatusChip status={status.status} label={status.label} detail={status.detail} size="md" />

        <span className="flex flex-wrap items-baseline gap-x-1.5">
          <StatusChip
            status={freshness.state}
            label={`Report ${freshness.label.toLowerCase()}`}
            size="md"
            hint={freshness.explanation}
          />
          {lead !== null && <span className="text-ink-muted text-2xs">{lead}</span>}
        </span>

        <span className="ml-auto flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <StatusChip
            status={warningStatus}
            label={
              health.generatorWarningCount === 0
                ? 'No generator warnings'
                : `${health.generatorWarningCount} generator ${plural(
                    health.generatorWarningCount,
                    'warning'
                  )}`
            }
            hint="Emitted by the report generator. Dashboard-derived checks are counted separately."
          />
          {health.absentSectionIds.length > 0 && (
            <StatusChip
              status="absent"
              label={`${health.absentSectionIds.length} ${plural(
                health.absentSectionIds.length,
                'section'
              )} absent`}
              hint={`Absent: ${health.absentSectionIds.join(', ')}`}
            />
          )}
          {health.truncatedTableCount > 0 && (
            <StatusChip
              status="partial"
              label={`${health.truncatedTableCount} truncated ${plural(
                health.truncatedTableCount,
                'table'
              )}`}
              hint="Some tables carry only part of their result set; sorting and filtering are disabled on them."
            />
          )}
        </span>
      </div>

      <FixtureStateNotice />
      <SchemaNotice schema={schema} />

      <div className="grid gap-x-6 gap-y-1 px-3 py-2 md:grid-cols-2 xl:grid-cols-3">
        <KeyValueList items={identityItems} labelWidth={17} />
        <KeyValueList items={sourceItems} labelWidth={17} />
        <KeyValueList items={inputItems} labelWidth={17} />
      </div>

      {configEntry !== null && (
        <div className="px-3 pb-2">
          <Disclosure
            summary={
              <span className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-ink">Configuration and provenance</span>
                <span className="pb-ident text-ink-faint text-2xs">{configEntry.sectionId}</span>
              </span>
            }
            summaryAside={
              <span className="pb-figures text-ink-muted text-2xs flex flex-wrap items-baseline gap-x-2">
                <span>
                  {config.ledgerEntries.length} ledger {plural(config.ledgerEntries.length, 'row')}{' '}
                  · {config.resolvedEntries.length} resolved{' '}
                  {plural(config.resolvedEntries.length, 'value')}
                </span>
                {/* The ledger is append-only: one record per run of the build driver. More than one
                    means the configuration changed while this build was running, so the values
                    below describe the latest run and not necessarily the inputs every artifact was
                    produced against. That is worth surfacing here rather than leaving it to whoever
                    opens the section. */}
                {config.recordCount !== null && config.recordCount > 1 && (
                  <StatusChip
                    status="warning"
                    label={`config changed during the build · ${config.recordCount} records`}
                  />
                )}
              </span>
            }
          >
            <ReportMount report={configEntry} />
          </Disclosure>
        </div>
      )}
    </header>
  )
}

export default BuildPreamble
