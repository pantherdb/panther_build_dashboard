import clsx from 'clsx'
import {
  BarCell,
  DataTable,
  DeltaValue,
  Disclosure,
  EmptyState,
  Provenance,
  SectionHeading,
  StatusChip,
  TruncationNotice,
} from '@/@panther.core/components'
import type { DataColumn } from '@/@panther.core/components'
import { formatCount, plural } from '@/app/format'
import { useSelectSpecies } from '@/features/build/hooks'
import type { SpeciesLink } from '@/features/build/model'
import type { ComparisonView, SpeciesChangeRow } from '@/features/comparison/model'

/**
 * Species-level change: what moved, what is a rename, and what deserves investigation.
 *
 * The exclusion rule is the substance of this view. `USTMA` drops 6,788 to zero and `MYCMD` appears
 * with exactly 6,788. Left in the rankings those two oscodes occupy two of the top slots and a
 * reviewer reads a catastrophic loss and a dramatic gain where the release has neither. They are
 * excluded and shown as a rename instead.
 *
 * `DAPPU` -> `DAPMA` is treated differently on purpose: 30,118 to 26,600 is 12 % apart, so part of
 * that change is real. It stays in the rankings and is marked inline, which is the honest reading
 * of a lower-confidence inference.
 *
 * `CRYNJ` -> `CRYD1` shows why the exact-count rule is drawn where it is. In the previous fixture
 * it was 6,604 to exactly 6,604 and read as a rename; in the current one it is 6,604 to 6,603, so
 * a single sequence of difference demotes it to the same lower-confidence replacement treatment as
 * `DAPPU`. That is the intended behaviour, not a regression - an exact-count claim has to actually
 * be exact.
 *
 * Everything derived here is scoped to the 50 rows the report actually carries, and the table
 * itself offers neither sort nor filter - the affordance that would let a reviewer conclude
 * "the largest decrease in the release is BRANA" from a partial set.
 */
export interface SpeciesChangesProps {
  view: ComparisonView
}

const LinkMark = ({ link, oscode }: { link: SpeciesLink; oscode: string }) => {
  const counterpart = link.removed === oscode ? link.added : link.removed
  const direction = link.removed === oscode ? 'to' : 'from'
  const word = link.kind === 'rename' ? 'rename' : 'likely replacement'
  return (
    <StatusChip
      status="changed"
      label={`${word} ${direction} ${counterpart}`}
      hint={link.evidence.join(' ')}
    />
  )
}

interface RankingProps {
  title: string
  rows: SpeciesChangeRow[]
  max: number
  onSelect: (oscode: string) => void
}

const Ranking = ({ title, rows, max, onSelect }: RankingProps) => (
  <div>
    <p className="text-ink-muted text-2xs mb-0.5 font-semibold uppercase">{title}</p>
    {rows.length === 0 ? (
      <p className="text-ink-faint text-2xs">No row in the included set moved in this direction.</p>
    ) : (
      <ul className="list-none p-0">
        {rows.map(row => (
          <li
            key={row.oscode}
            className={clsx(
              'flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-0.5',
              row.link !== null && 'bg-accent-wash -mx-1 px-1'
            )}
          >
            <button
              type="button"
              onClick={() => onSelect(row.oscode)}
              className="pb-ident text-accent hover:text-accent-hover w-16 shrink-0 cursor-pointer text-left text-xs"
            >
              {row.oscode}
            </button>
            <BarCell
              value={row.countDiff}
              max={max}
              baseline="center"
              label={
                row.countDiff === null
                  ? undefined
                  : `${row.countDiff > 0 ? '+' : '-'}${Math.abs(row.countDiff).toLocaleString()}`
              }
              title={`Change in sequence count for ${row.oscode}`}
            />
            {row.isAddition ? (
              <span className="text-ink-faint text-2xs">new — no previous count</span>
            ) : (
              <DeltaValue value={row.percentChange} kind="percent" className="text-2xs" />
            )}
            {row.link !== null && <LinkMark link={row.link} oscode={row.oscode} />}
          </li>
        ))}
      </ul>
    )}
  </div>
)

export const SpeciesChanges = ({ view }: SpeciesChangesProps) => {
  const selectSpecies = useSelectSpecies()

  const columns: readonly DataColumn<SpeciesChangeRow>[] = [
    {
      id: 'oscode',
      header: 'Species',
      kind: 'node',
      width: 92,
      render: row => (
        <button
          type="button"
          onClick={() => selectSpecies(row.oscode)}
          className="pb-ident text-accent hover:text-accent-hover cursor-pointer text-xs"
        >
          {row.oscode}
        </button>
      ),
      sortValue: row => row.oscode,
    },
    {
      id: 'previous',
      header: 'Previous count',
      kind: 'number',
      hint: 'Sequences for this species in the previous release, parsed from the report string column.',
      render: row => formatCount(row.previousCount),
      sortValue: row => row.previousCount,
    },
    {
      id: 'current',
      header: 'Current count',
      kind: 'number',
      render: row => formatCount(row.currentCount),
      sortValue: row => row.currentCount,
    },
    {
      id: 'change',
      header: 'Change',
      kind: 'node',
      render: row => (
        <BarCell
          value={row.countDiff}
          max={view.rankingMax}
          baseline="center"
          label={
            row.countDiff === null
              ? undefined
              : `${row.countDiff > 0 ? '+' : row.countDiff < 0 ? '-' : ''}${Math.abs(
                  row.countDiff
                ).toLocaleString()}`
          }
        />
      ),
      sortValue: row => row.countDiff,
    },
    {
      id: 'percent',
      header: 'Change (recomputed)',
      kind: 'node',
      align: 'right',
      hint: 'Recomputed from the two counts. A species that went to zero reads -100 %.',
      render: row =>
        row.isAddition ? (
          <span className="text-ink-faint text-2xs">new</span>
        ) : (
          <DeltaValue
            value={row.percentChange}
            kind="percent"
            absentReason="no previous count"
            className="text-2xs"
          />
        ),
      sortValue: row => row.percentChange,
    },
    {
      id: 'reported',
      header: 'pct_change as reported',
      kind: 'mono',
      align: 'right',
      hint: 'The report stores this as a fraction, so -1.0 means a complete removal. Shown verbatim; never formatted as a percentage.',
      render: row => (row.reportedPctChange === null ? '—' : row.reportedPctChange.toFixed(2)),
      sortValue: row => row.reportedPctChange,
    },
    {
      id: 'relationship',
      header: 'Inferred relationship',
      kind: 'node',
      render: row =>
        row.link === null ? (
          <span className="text-ink-faint text-2xs">—</span>
        ) : (
          <LinkMark link={row.link} oscode={row.oscode} />
        ),
    },
  ]

  const allLinks = [...view.renames, ...view.replacements]

  return (
    <div className="space-y-2">
      <SectionHeading
        level={4}
        count={`${view.speciesRows.length} ${plural(view.speciesRows.length, 'species row')}`}
        description={`Every figure here is recomputed from the two counts. Rankings are stated ${view.speciesScope}.`}
      >
        Species-level change
      </SectionHeading>

      {view.speciesCompleteness !== undefined && (
        <TruncationNotice
          completeness={view.speciesCompleteness}
          detail="The rankings and relationships below are derived from these rows only, and are worded that way."
        />
      )}

      {view.speciesOrdering === 'descending' && (
        <p className="text-ink-muted text-2xs flex flex-wrap items-baseline gap-x-2">
          <Provenance source="derived" detail="observed by this dashboard" />
          <span className="min-w-0 flex-1">
            The included rows are already ordered by the size of the change, largest first, so these
            are very likely the release&apos;s largest movements — but the report does not declare
            how it chose them, so the claim stays scoped to the rows present.
          </span>
        </p>
      )}

      {allLinks.length > 0 && (
        <div>
          <p className="text-ink-muted text-2xs mb-0.5 font-semibold uppercase">
            Likely renames and replacements ({allLinks.length})
          </p>
          <ul className="list-none p-0">
            {allLinks.map(link => (
              <li
                key={`${link.removed}-${link.added}`}
                className="pb-hairline-b flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-1"
              >
                <StatusChip
                  status="changed"
                  label={link.kind === 'rename' ? 'Rename' : 'Replacement'}
                  detail={link.confidence}
                />
                <button
                  type="button"
                  onClick={() => selectSpecies(link.removed)}
                  className="pb-ident text-accent hover:text-accent-hover cursor-pointer text-xs"
                >
                  {link.removed}
                </button>
                <span className="text-ink-faint text-2xs">→</span>
                <button
                  type="button"
                  onClick={() => selectSpecies(link.added)}
                  className="pb-ident text-accent hover:text-accent-hover cursor-pointer text-xs"
                >
                  {link.added}
                </button>
                <span className="pb-figures text-ink text-2xs">
                  {formatCount(link.removedCount)} → {formatCount(link.addedCount)}
                </span>
                <span className="text-ink-muted text-2xs min-w-0 flex-1">
                  {link.evidence.join(' ')}
                </span>
                <Provenance source="derived" detail="inferred from the count table" />
              </li>
            ))}
          </ul>
          <p className="text-ink-muted text-2xs mt-0.5">
            {view.excludedOscodes.length === 0
              ? 'No pair was excluded from the rankings.'
              : `${view.excludedOscodes.join(', ')} are excluded from the rankings below: an exact-count drop paired with an exact-count addition is one organism under a new oscode, not the release's largest loss and largest gain.`}{' '}
            {view.replacements.length > 0 &&
              'Lower-confidence replacements stay in the rankings, marked inline, because their counts differ and part of the change is real.'}
          </p>
        </div>
      )}

      <div className="gap-x-gutter grid grid-cols-1 gap-y-2 lg:grid-cols-2">
        <Ranking
          title={`Largest decreases (${view.decreases.length} shown)`}
          rows={view.decreases}
          max={view.rankingMax}
          onSelect={selectSpecies}
        />
        <Ranking
          title={`Largest increases (${view.increases.length} shown)`}
          rows={view.increases}
          max={view.rankingMax}
          onSelect={selectSpecies}
        />
      </div>

      <div className="gap-x-gutter grid grid-cols-1 gap-y-1 lg:grid-cols-2">
        <p className="text-ink-muted text-2xs">
          <span className="text-ink font-semibold">Newly added ({view.addedRows.length}): </span>
          {view.addedRows.length === 0 ? (
            'none in the included rows.'
          ) : (
            <span className="pb-ident">{view.addedRows.map(row => row.oscode).join(', ')}</span>
          )}
        </p>
        <p className="text-ink-muted text-2xs">
          <span className="text-ink font-semibold">Removed ({view.removedRows.length}): </span>
          {view.removedRows.length === 0 ? (
            'none in the included rows.'
          ) : (
            <span className="pb-ident">{view.removedRows.map(row => row.oscode).join(', ')}</span>
          )}
        </p>
      </div>

      <Disclosure
        summary="Previous versus new sequence counts, as reported"
        count={`${view.speciesRows.length} ${plural(view.speciesRows.length, 'row')}`}
        bare
      >
        {view.speciesRows.length === 0 ? (
          <EmptyState
            title="No species count rows in this report"
            description="The previous-versus-new count table is not present, so no species-level change is shown."
          />
        ) : (
          <DataTable
            caption="Sequence counts by species, previous versus new"
            columns={columns}
            rows={view.speciesRows}
            rowKey={row => row.oscode}
            completeness={view.speciesCompleteness}
            completenessDetail="Sorting and filtering are withheld: over a subset they would imply a ranking the report cannot support."
            pageSize={0}
            density="tight"
            maxHeight={420}
            onRowClick={row => selectSpecies(row.oscode)}
            footNote="Counts are parsed from string columns. The recomputed change column is the one to read; pct_change as reported is a fraction."
          />
        )}
      </Disclosure>
    </div>
  )
}
