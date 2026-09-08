import { useMemo } from 'react'
import {
  DataTable,
  Disclosure,
  Panel,
  SectionHeading,
  StatusChip,
} from '@/@panther.core/components'
import type { DataColumn } from '@/@panther.core/components'
import { formatCount, plural } from '@/app/format'
import { useBuildReport } from '@/features/build/hooks'
import { reportElementId } from '@/features/build/model'
import type { BuildReport, ProteomeRosterRow } from '@/features/build/model'

/**
 * Where every reference proteome came from.
 *
 * This view exists because a library is not built from one release. The header used to claim a
 * single declared QfO version; the roster says this build drew from QfO 2026_02, RefProt 2026_02
 * and RefProt 2026_01 at once, and the directory name itself
 * (`QfO_release_2026_02_w_select_2026_01`) records the hand-picked selection.
 *
 * The composition leads, because it is the replacement claim. The off-majority mark is second,
 * because it is the only part a human has to adjudicate: the generator cannot tell a deliberate
 * hand-swap from a stamping error. The roster comes last - a reader who wants one species scrolls,
 * a reader who wants the shape of the release does not have to.
 */

/** Change codes the generator writes, in the words a reader uses. */
const CHANGE_LABELS: Record<string, string> = {
  new: 'new',
  up_changed: 'UP changed',
  source_changed: 'source changed',
  version_changed: 'release changed',
  same_up: 'same UP',
  unchanged: 'unchanged',
}

const rosterColumns: readonly DataColumn<ProteomeRosterRow>[] = [
  { id: 'up', header: 'UP', kind: 'mono', sortValue: row => row.up },
  { id: 'oscode', header: 'OSCODE', kind: 'mono', sortValue: row => row.oscode },
  { id: 'taxid', header: 'taxID', kind: 'number', sortValue: row => Number(row.taxid) },
  { id: 'name', header: 'Name', sortValue: row => row.name },
  { id: 'source', header: 'Source', sortValue: row => row.source },
  { id: 'release', header: 'Release', kind: 'mono', sortValue: row => row.version },
  {
    id: 'prev_up',
    header: 'Previous UP',
    kind: 'mono',
    sortValue: row => row.prevUp,
    render: row => row.prevUp ?? <span className="text-ink-faint">—</span>,
  },
  {
    id: 'change',
    header: 'Change',
    sortValue: row => row.change,
    render: row =>
      row.change === null ? (
        <span className="text-ink-faint">—</span>
      ) : (
        (CHANGE_LABELS[row.change] ?? row.change)
      ),
  },
]

const droppedColumns: readonly DataColumn<ProteomeRosterRow>[] = [
  { id: 'up', header: 'UP', kind: 'mono', sortValue: row => row.up },
  { id: 'oscode', header: 'OSCODE', kind: 'mono', sortValue: row => row.oscode },
  { id: 'taxid', header: 'taxID', kind: 'number', sortValue: row => Number(row.taxid) },
  { id: 'name', header: 'Name', sortValue: row => row.name },
]

const rowKey = (row: ProteomeRosterRow) => row.up ?? row.oscode ?? row.name ?? 'unknown'

export interface ProteomesReportViewProps {
  report: BuildReport
}

export const ProteomesReportView = ({ report }: ProteomesReportViewProps) => {
  const proteomes = report.proteomes
  const { composition, changeCounts, offMajorityCount } = proteomes

  const offMajoritySources = useMemo(
    () =>
      [...new Set(composition.filter(bucket => !bucket.isSourceMajority).map(b => b.source))].filter(
        source => composition.some(other => other.source === source && other.isSourceMajority)
      ),
    [composition]
  )

  return (
    <Panel
      title="Reference proteomes"
      subtitle={proteomes.sectionId ?? 'proteomes'}
      availability={proteomes.availability}
      message={proteomes.message ?? undefined}
      missingSubject="the reference-proteome roster"
      anchorId={reportElementId('proteomes')}
      status={
        offMajorityCount > 0 ? (
          <StatusChip
            status="warn"
            label={`${offMajorityCount} off majority`}
            hint={`${offMajorityCount} ${plural(offMajorityCount, 'proteome')} are not on their source's majority release. Deliberate for a hand-swapped proteome; otherwise a stamping error.`}
          />
        ) : undefined
      }
    >
      <div className="space-y-gutter">
        <section>
          <SectionHeading
            level={3}
            description="A library is built from as many releases as its roster names. This is all of them."
          >
            Release composition
          </SectionHeading>
          <ul
            aria-label="Release composition"
            className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5"
          >
            {composition.map(bucket => (
              <li
                key={`${bucket.source}-${bucket.release}`}
                aria-label={`${bucket.source} ${bucket.release}`}
                className="flex items-baseline gap-1.5"
              >
                <span className="text-ink pb-ident text-2xs font-semibold">
                  {bucket.source} {bucket.release}
                </span>
                <span className="text-ink pb-figures text-2xs">{formatCount(bucket.count)}</span>
                {!bucket.isSourceMajority && offMajoritySources.includes(bucket.source) && (
                  <StatusChip status="warn" label="off majority" size="sm" variant="plain" />
                )}
              </li>
            ))}
          </ul>
          {proteomes.total !== null && (
            <p className="text-ink-faint mt-1 text-2xs">
              {formatCount(proteomes.total)} {plural(proteomes.total, 'proteome')} in total.
            </p>
          )}
        </section>

        <section>
          <SectionHeading level={3}>Change since the previous library</SectionHeading>
          <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5" aria-label="Proteome changes">
            {(
              [
                ['new', changeCounts.new],
                ['UP changed', changeCounts.upChanged],
                ['source changed', changeCounts.sourceChanged],
                ['release changed', changeCounts.versionChanged],
                ['same UP', changeCounts.sameUp],
                ['dropped', changeCounts.dropped],
              ] as const
            ).map(([label, value]) => (
              <li key={label} className="flex items-baseline gap-1.5">
                <span className="text-ink-faint text-2xs">{label}</span>
                <span className="text-ink pb-figures text-2xs font-semibold">
                  {value === null ? '—' : formatCount(value)}
                </span>
              </li>
            ))}
          </ul>
          {!proteomes.previousRosterStamped && (
            <p className="text-ink-faint mt-1 text-2xs">
              The previous roster predates per-proteome provenance, so it carries no source or
              release to compare against. A proteome keeping its UP number is counted as{' '}
              <span className="text-ink">same UP</span> rather than unchanged, and{' '}
              <span className="text-ink">release changed</span> is not measurable on this build —
              read it as unknown, not zero.
            </p>
          )}
        </section>

        <DataTable
          caption="Reference proteomes"
          captionVisible={false}
          columns={rosterColumns}
          rows={proteomes.roster.rows}
          rowKey={rowKey}
          completeness={
            proteomes.roster.truncation.truncated
              ? {
                  included: proteomes.roster.truncation.includedRows,
                  total: proteomes.roster.truncation.totalRows,
                  noun: 'proteomes',
                }
              : undefined
          }
          defaultSort={{ columnId: 'oscode', direction: 'asc' }}
          // The roster is complete and small; scrolling it beats paging a set a reader scans.
          pageSize={0}
          maxHeight={520}
          density="tight"
          footNote={proteomes.roster.truncation.label}
        />

        {proteomes.dropped.rows.length > 0 && (
          <Disclosure
            summary={`${formatCount(proteomes.dropped.rows.length)} ${plural(
              proteomes.dropped.rows.length,
              'proteome'
            )} dropped since the previous library`}
          >
            <DataTable
              caption="Proteomes dropped since the previous library"
              captionVisible={false}
              columns={droppedColumns}
              rows={proteomes.dropped.rows}
              rowKey={rowKey}
              completeness={
                proteomes.dropped.truncation.truncated
                  ? {
                      included: proteomes.dropped.truncation.includedRows,
                      total: proteomes.dropped.truncation.totalRows,
                      noun: 'proteomes',
                    }
                  : undefined
              }
              defaultSort={{ columnId: 'oscode', direction: 'asc' }}
              pageSize={0}
              density="tight"
            />
          </Disclosure>
        )}

        {proteomes.warnings.length > 0 && (
          <section>
            <SectionHeading level={3}>Generator warnings</SectionHeading>
            <ul aria-label="Generator warnings" className="mt-1.5 space-y-1">
              {proteomes.warnings.map(warning => (
                <li key={warning} className="text-ink-faint text-2xs">
                  <StatusChip status="warn" variant="quiet" size="sm" />{' '}
                  <span>{warning}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Panel>
  )
}

const ProteomesReport = () => <ProteomesReportView report={useBuildReport()} />

export default ProteomesReport
