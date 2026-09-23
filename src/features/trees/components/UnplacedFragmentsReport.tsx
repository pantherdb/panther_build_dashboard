import { TextInput } from '@mantine/core'
import { useMemo, useState } from 'react'
import {
  CopyButton,
  DataTable,
  FilterRow,
  LongMessage,
  Panel,
  SectionHeading,
  StatusChip,
  useMetricDefinitions,
} from '@/@panther.core/components'
import type { DataColumn } from '@/@panther.core/components'
import { ABSENT_MARK } from '@/@panther.core/vocabulary'
import { formatCount, plural } from '@/app/format'
import { useBuildReport, useSelectSpecies } from '@/features/build/hooks'
import {
  generatorDefinitionId,
  parseLongId,
  taxonomicNameByOscode,
  uniprotUrl,
} from '@/features/build/model'
import type {
  BuildReport,
  LongId,
  UnplacedFamilyRow,
  UnplacedSpeciesRow,
} from '@/features/build/model'
import { useUnplacedFamilies } from '@/features/trees/hooks'
import type { UnplacedFamiliesStatus } from '@/features/trees/hooks'

/**
 * Who GIGA left out of each tree.
 *
 * The family table is the navigation; the member table is the answer. The filter matches the
 * members as well as the family id, because the question a reviewer usually arrives with is
 * "where did Q12983 go?", not "what is in PTHR10057?".
 *
 * `members === null` is a family whose ids the report dropped to stay small. It is shown as
 * that, with the path to the file, and never as an empty list - "none were unplaced" is the
 * opposite claim.
 *
 * The `giga` section's own two family-id lists ("Families with an empty tree", "Families removed
 * after GIGA (single genome)") used to render here too. They moved to the generic renderer
 * (`src/features/reports/components/GenericTable.tsx`), which now collapses any single-column,
 * untruncated table into a disclosure by shape alone - `giga` is not `giga_usf`, and this Panel's
 * availability no longer has to borrow from a section it does not describe.
 */

/** `giga_usf.<term>` - this section's own namespace in the generator definitions registry. */
const usfDefinitionId = (term: string) => generatorDefinitionId('giga_usf', term)

/**
 * `giga_usf.<term>` hover text for a column header, shared by both tables in this view
 * (`ByProteomeTable` and the family table below) so the lookup is written once.
 */
function useUsfHint(): (term: string) => string | undefined {
  const definitions = useMetricDefinitions()
  return (term: string) => definitions[usfDefinitionId(term)]?.description
}

const formatPercent = (value: number | null): string =>
  value === null ? ABSENT_MARK : `${value.toFixed(2)}%`

/**
 * Copy for every status besides `ready` and `not-referenced` (which render the family table
 * itself, or fall back to it) and `loading` (its own line below). Each is a distinct failure mode
 * the report contract distinguishes, so each gets its own honest sentence rather than one generic
 * "no data" - see the plan's ruling on the states this view must tell apart.
 */
const FAMILY_STATUS_COPY: Partial<Record<UnplacedFamiliesStatus, string>> = {
  'not-shipped':
    'The per-family data file was not shipped with this report: copy ' +
    'build_state.giga_usf.json alongside build_state.json.',
  mismatched:
    'The per-family data file on this site belongs to a different report; refresh it ' +
    'alongside build_state.json.',
  'parse-error': 'The per-family data file could not be read.',
}

function matches(row: UnplacedFamilyRow, needle: string): boolean {
  if (row.family.toLowerCase().includes(needle)) return true
  return (row.members ?? []).some(id => id.toLowerCase().includes(needle))
}

/**
 * Every proteome the report's by-proteome table names - complete, never truncated, one row per
 * oscode including a measured zero. Sortable; defaults to the biggest problem first. On an older
 * report this reads the three-column fallback table instead (`extractUnplacedFragments`), so the
 * four new columns are simply `null` here rather than the view branching on report shape itself.
 */
const ByProteomeTable = ({
  rows,
  taxonomicNames,
  selectSpecies,
}: {
  rows: readonly UnplacedSpeciesRow[]
  taxonomicNames: ReadonlyMap<string, string>
  selectSpecies: (oscode: string | null) => void
}) => {
  const hintFor = useUsfHint()

  const columns: readonly DataColumn<UnplacedSpeciesRow>[] = [
    {
      id: 'oscode',
      header: 'Species',
      kind: 'node',
      sortValue: row => row.oscode,
      render: row => (
        <button
          type="button"
          className="pb-ident text-accent hover:text-accent-hover cursor-pointer text-xs"
          onClick={() => selectSpecies(row.oscode)}
        >
          {row.oscode}
        </button>
      ),
    },
    {
      id: 'taxonomicName',
      header: 'Taxonomic name',
      sortValue: row => taxonomicNames.get(row.oscode) ?? null,
      render: row => taxonomicNames.get(row.oscode) ?? ABSENT_MARK,
    },
    {
      id: 'proteomeSeqs',
      header: 'Proteome seqs',
      hint: hintFor('proteome_seqs'),
      kind: 'number',
      sortValue: row => row.proteomeSeqs,
      render: row => formatCount(row.proteomeSeqs),
    },
    {
      id: 'gigaInputSeqs',
      header: 'Sent to GIGA',
      hint: hintFor('giga_input_seqs'),
      kind: 'number',
      sortValue: row => row.gigaInputSeqs,
      render: row => formatCount(row.gigaInputSeqs),
    },
    {
      id: 'unplaced',
      header: 'Unplaced',
      hint: hintFor('unplaced'),
      kind: 'number',
      sortValue: row => row.unplaced,
    },
    {
      id: 'families',
      header: 'Families',
      hint: hintFor('families'),
      kind: 'number',
      sortValue: row => row.families,
    },
    {
      id: 'pctProteome',
      header: '% of proteome',
      hint: hintFor('unplaced_pct_of_proteome'),
      kind: 'number',
      sortValue: row => row.unplacedPctOfProteome,
      render: row => formatPercent(row.unplacedPctOfProteome),
    },
    {
      id: 'pctGigaInput',
      header: '% of GIGA input',
      hint: hintFor('unplaced_pct_of_giga_input'),
      kind: 'number',
      sortValue: row => row.unplacedPctOfGigaInput,
      render: row => formatPercent(row.unplacedPctOfGigaInput),
    },
  ]

  return (
    <section>
      <SectionHeading
        level={3}
        count={`${formatCount(rows.length)} ${plural(rows.length, 'proteome')}`}
      >
        Unplaced fragments by proteome
      </SectionHeading>
      {rows.length === 0 ? (
        <p className="text-ink-muted text-xs">No per-proteome counts in this report.</p>
      ) : (
        <DataTable
          caption="Unplaced fragments by proteome"
          columns={columns}
          rows={rows}
          rowKey={row => row.oscode}
          defaultSort={{ columnId: 'unplaced', direction: 'desc' }}
          // Complete and never truncated (the generator's own contract) - scrolling beats paging a
          // set a reader scans.
          pageSize={0}
          maxHeight={420}
          density="tight"
        />
      )}
    </section>
  )
}

const MemberTable = ({
  family,
  taxonomicNames,
}: {
  family: UnplacedFamilyRow
  taxonomicNames: ReadonlyMap<string, string>
}) => {
  const selectSpecies = useSelectSpecies()
  const members = family.members
  const rows = useMemo(() => (members ?? []).map(parseLongId), [members])

  const columns: readonly DataColumn<LongId>[] = [
    {
      id: 'species',
      header: 'Species',
      kind: 'node',
      sortValue: row => row.oscode,
      render: row =>
        row.oscode === null ? (
          ABSENT_MARK
        ) : (
          <button
            type="button"
            className="pb-ident text-accent hover:text-accent-hover cursor-pointer text-xs"
            onClick={() => selectSpecies(row.oscode)}
          >
            {row.oscode}
          </button>
        ),
    },
    {
      id: 'taxonomicName',
      header: 'Taxonomic name',
      sortValue: row => (row.oscode === null ? null : (taxonomicNames.get(row.oscode) ?? null)),
      render: row =>
        row.oscode === null ? ABSENT_MARK : (taxonomicNames.get(row.oscode) ?? ABSENT_MARK),
    },
    {
      id: 'uniprot',
      header: 'UniProt',
      kind: 'node',
      sortValue: row => row.accession,
      render: row =>
        row.accession === null ? (
          ABSENT_MARK
        ) : (
          <a
            className="pb-ident text-accent hover:text-accent-hover text-xs"
            href={uniprotUrl(row.accession)}
            target="_blank"
            rel="noreferrer"
          >
            {row.accession}
          </a>
        ),
    },
    { id: 'raw', header: 'Long ID', kind: 'mono', sortValue: row => row.raw },
  ]

  if (members === null) {
    return (
      <p className="text-ink-muted text-2xs">
        {formatCount(family.unplaced)} sequences were unplaced in {family.family}. This report left
        these IDs out to stay small. They are in{' '}
        <code className="pb-ident">
          books/{family.family}/orig/tree/{family.family}.orig.usf
        </code>{' '}
        on the cluster.
      </p>
    )
  }

  return (
    <DataTable
      caption={`Unplaced in ${family.family}`}
      columns={columns}
      rows={rows}
      rowKey={row => row.raw}
      pageSize={50}
      density="tight"
      filters={
        <FilterRow actions={<CopyButton value={members.join('\n')} label="Copy long IDs" />}>
          {null}
        </FilterRow>
      }
    />
  )
}

export interface UnplacedFragmentsReportViewProps {
  report: BuildReport
}

export const UnplacedFragmentsReportView = ({ report }: UnplacedFragmentsReportViewProps) => {
  const summary = report.unplacedFragments
  const { status: familiesStatus, families } = useUnplacedFamilies(report)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const selectSpecies = useSelectSpecies()
  const hintFor = useUsfHint()

  const taxonomicNames = useMemo(
    () => taxonomicNameByOscode(report.proteomes.roster.rows),
    [report.proteomes.roster.rows]
  )

  const familyColumns: readonly DataColumn<UnplacedFamilyRow>[] = [
    { id: 'family', header: 'Family', kind: 'mono', sortValue: row => row.family },
    {
      id: 'inputSeqs',
      header: 'Input seqs',
      hint: hintFor('input_seqs'),
      kind: 'number',
      sortValue: row => row.inputSeqs,
      render: row => formatCount(row.inputSeqs),
    },
    {
      id: 'unplaced',
      header: 'Unplaced',
      hint: hintFor('unplaced'),
      kind: 'number',
      sortValue: row => row.unplaced,
    },
    {
      id: 'leaves',
      header: 'In final tree',
      hint: hintFor('tree_leaves'),
      kind: 'number',
      sortValue: row => row.treeLeaves,
      render: row => formatCount(row.treeLeaves),
    },
    {
      id: 'fraction',
      header: 'Share unplaced',
      hint: hintFor('unplaced_fraction'),
      kind: 'number',
      sortValue: row => row.unplacedFraction,
      render: row =>
        row.unplacedFraction === null ? ABSENT_MARK : `${(row.unplacedFraction * 100).toFixed(1)}%`,
    },
  ]

  const needle = query.trim().toLowerCase()
  const visible = useMemo(
    () => families.filter(row => needle === '' || matches(row, needle)),
    [families, needle]
  )
  const selectedRow = families.find(row => row.family === selected) ?? null
  const present = summary.availability === 'available'
  /** `ready` (sidecar) and `not-referenced` (old in-report shape, already synchronous) are the
   *  only two statuses with a usable family list; the rest get their own copy below instead of
   *  the table. */
  const familiesAvailable = familiesStatus === 'ready' || familiesStatus === 'not-referenced'
  const familyStatusMessage = FAMILY_STATUS_COPY[familiesStatus]

  /**
   * `matches()` can only test a family's members against the filter text when it has them.
   * `members === null` families (the report left their ids out to stay small - see
   * `membersTruncated`) can only match on family id, so a filter that finds nothing for a member
   * id silently reads as "not present" rather than "not searchable". Say so, but only while a
   * filter is actually narrowing the list - the note has nothing to add against the full list.
   */
  const hiddenMemberFamilyCount = families.filter(row => row.members === null).length
  const showHiddenMembersNote =
    needle !== '' && (summary.membersTruncated || hiddenMemberFamilyCount > 0)

  return (
    <Panel
      title="Unplaced fragments"
      subtitle={summary.sectionId ?? 'giga_usf'}
      availability={summary.availability}
      message={summary.message ?? undefined}
      missingSubject="unplaced fragments"
    >
      <div className="space-y-gutter">
        {present && (
          <>
            <p className="pb-figures text-ink-muted text-xs">
              {formatCount(summary.familiesWithUnplaced)} of {formatCount(summary.booksScanned)}{' '}
              books had sequences GIGA could not place · {formatCount(summary.unplacedTotal)}{' '}
              sequences
            </p>
            {summary.unassignedInMapping === null ? (
              <p className="text-ink-faint text-2xs">
                <StatusChip status="warn" variant="quiet" size="sm" />{' '}
                <span>
                  post-GIGA mapping not checked: these may still carry a family assignment there.
                </span>
              </p>
            ) : (
              <p className="pb-figures text-ink-muted text-2xs">
                {formatCount(summary.unassignedInMapping)} unassigned in the post-GIGA mapping
              </p>
            )}
            <ByProteomeTable
              rows={summary.bySpecies}
              taxonomicNames={taxonomicNames}
              selectSpecies={selectSpecies}
            />
            {familiesStatus === 'loading' && (
              <p className="text-ink-muted text-2xs">Loading families…</p>
            )}
            {familyStatusMessage !== undefined && (
              <p className="text-ink-faint text-2xs">
                <StatusChip status="warn" variant="quiet" size="sm" />{' '}
                <span>{familyStatusMessage}</span>
              </p>
            )}
            {familiesAvailable && (
              <>
                {summary.inputMismatchFamilies !== null && summary.inputMismatchFamilies > 0 && (
                  <p className="text-ink-faint text-2xs">
                    <StatusChip status="warn" variant="quiet" size="sm" />{' '}
                    <span>
                      {formatCount(summary.inputMismatchFamilies)}{' '}
                      {plural(summary.inputMismatchFamilies, 'family', 'families')}: input ≠
                      unplaced + in final tree — see generator warnings.
                    </span>
                  </p>
                )}
                {showHiddenMembersNote && (
                  <p className="text-ink-faint text-2xs">
                    <StatusChip status="warn" variant="quiet" size="sm" />{' '}
                    <span>
                      IDs for {formatCount(hiddenMemberFamilyCount)}{' '}
                      {plural(hiddenMemberFamilyCount, 'family', 'families')} are not in this
                      report; this search covers the rest.
                    </span>
                  </p>
                )}
                <DataTable
                  caption="Families with unplaced fragments"
                  columns={familyColumns}
                  rows={visible}
                  rowKey={row => row.family}
                  defaultSort={{ columnId: 'unplaced', direction: 'desc' }}
                  onRowClick={row => setSelected(row.family)}
                  selectedRowKey={selected}
                  pageSize={25}
                  maxHeight={480}
                  filters={
                    <FilterRow summary={`${visible.length} of ${families.length} families`}>
                      <TextInput
                        label="Filter families"
                        placeholder="PTHR id, oscode or accession"
                        value={query}
                        onChange={event => setQuery(event.currentTarget.value)}
                        size="xs"
                      />
                    </FilterRow>
                  }
                />
              </>
            )}
          </>
        )}
        {present && familiesAvailable && selectedRow && (
          <section>
            <SectionHeading level={3} count={`${formatCount(selectedRow.unplaced)} sequences`}>
              {selectedRow.family}
            </SectionHeading>
            <MemberTable family={selectedRow} taxonomicNames={taxonomicNames} />
          </section>
        )}
        {present && summary.warnings.length > 0 && (
          <section>
            <SectionHeading level={3}>Generator warnings</SectionHeading>
            <ul aria-label="Generator warnings" className="mt-1.5 space-y-1">
              {summary.warnings.map(warning => (
                <li
                  key={warning}
                  className="text-ink-faint text-2xs flex flex-wrap items-baseline gap-x-1.5"
                >
                  <StatusChip status="warn" variant="quiet" size="sm" />
                  <LongMessage message={warning} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Panel>
  )
}

const UnplacedFragmentsReport = () => <UnplacedFragmentsReportView report={useBuildReport()} />

export default UnplacedFragmentsReport
