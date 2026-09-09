import { screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import { MetricDefinitionsProvider } from '@/@panther.core/components'
import { metricRegistry } from '@/app/metricRegistry'
import { getFixtureReport } from '@/features/build/fixtures'
import { ComparisonReportView } from '@/features/comparison/components/ComparisonReport'
import {
  buildComparisonView,
  completenessOf,
  missingColumnsIn,
  orderingOf,
} from '@/features/comparison/model'
import { renderWithProviders } from '@tests/test-utils'

/**
 * The release comparison, and the truncation rule that governs it.
 *
 * Three properties are worth more than the rest. The view has to be PARTIAL rather than absent and
 * has to name `prev_lib` as what is missing. A removed species has to read -100 %, not the -1 % the
 * report's own fraction would format to. And the three truncated tables must not offer sort or
 * filter, because a sortable subset is how a reviewer concludes "the largest decrease in the release
 * is BRANA" from data that cannot support it.
 *
 * Rendering assertions are grouped rather than split one per `it`: this view mounts four panels,
 * three tables and around a hundred inline bars, so repeated mounts of the same tree slow the suite
 * enough to time out under parallel load.
 */

const withDefinitions = (ui: ReactElement) => (
  <MetricDefinitionsProvider registry={metricRegistry}>{ui}</MetricDefinitionsProvider>
)

/** Text that spans several nodes; RTL's default matcher only sees direct text children. */
const spanningText = (fragment: string) =>
  screen.queryAllByText((_content, element) => element?.textContent?.includes(fragment) ?? false)

/**
 * Mounting one of these views in jsdom costs a few hundred milliseconds, and the FIRST mount in a
 * file also pays the Mantine + floating-layer warm-up, which pushes past Vitest's 5 s default on a
 * loaded machine. The render tests therefore carry an explicit timeout rather than being split into
 * more, smaller mounts of the same tree.
 */
const RENDER_TIMEOUT = 30_000

const report = getFixtureReport('real')
const view = buildComparisonView(report)

const headerButtons = (caption: string): number =>
  screen.getByRole('table', { name: caption }).querySelectorAll('thead button').length

describe('assembled comparison model', () => {
  it('is partial, not absent, and knows exactly which source is missing', () => {
    expect(view.summary.availability).toBe('partial')
    expect(view.missingSources.map(entry => entry.sectionId)).toEqual(['prev_lib'])
    expect(view.presentSources.map(entry => entry.sectionId)).toEqual([
      'other_reports',
      'library',
      'mapping',
      'node_tracking',
    ])
    expect(view.summary.previousLibrary.message).toBe('inputs not present yet')
    // Only the input-sequence comparison has both sides; the rest lost prev_lib's own totals.
    expect(view.metricsWithPrevious).toBe(1)
  })

  it('recomputes change from the counts instead of echoing pct_change', () => {
    const brana = view.speciesRows.find(row => row.oscode === 'BRANA')
    expect(brana?.previousCount).toBe(57383)
    expect(brana?.currentCount).toBe(0)
    expect(brana?.percentChange).toBe(-100)
    // The report's own field is a fraction, kept only as provenance.
    expect(brana?.reportedPctChange).toBe(-1)

    // An addition has no baseline, so there is no percentage rather than an invented one.
    const dapma = view.speciesRows.find(row => row.oscode === 'DAPMA')
    expect(dapma?.previousCount).toBe(0)
    expect(dapma?.currentCount).toBe(26600)
    expect(dapma?.percentChange).toBeNull()
  })

  it('turns the model truncation flags into the completeness that withholds sort and filter', () => {
    expect(view.speciesTruncation.allowClientSort).toBe(false)
    expect(view.speciesTruncation.allowClientFilter).toBe(false)
    expect(view.speciesCompleteness).toEqual({ included: 50, total: 147, noun: 'species' })
    expect(view.uniprotCompleteness).toEqual({ included: 20, total: 132, noun: 'proteomes' })
    expect(view.uniRuleCompleteness).toEqual({ included: 20, total: 808, noun: 'UniRules' })
    expect(view.speciesScope).toBe('among the 50 species rows included in the report')
    expect(view.uniprotScope).toBe('among the 20 proteome rows included in the report')

    // A complete table gets no completeness at all, so its affordances stay.
    expect(
      completenessOf({
        truncated: false,
        includedRows: 12,
        totalRows: 12,
        raggedRows: 0,
        hasRaggedRows: false,
        allowClientSort: true,
        allowClientFilter: true,
        label: '12 rows',
      })
    ).toBeUndefined()
  })

  it('reads ragged_rows as a count and checks the included rows independently', () => {
    expect(view.uniRuleTruncation.raggedRows).toBe(808)
    expect(view.uniRuleTruncation.hasRaggedRows).toBe(true)
    // The generator flags every row, yet no included row is actually short of a column.
    expect(view.uniRuleRagged.rowsMissingColumns).toHaveLength(0)
    expect(view.uniRuleRagged.columns).toEqual(['unirule', 'families', 'family_count'])

    expect(missingColumnsIn({ a: 1, b: '' }, ['a', 'b', 'c'])).toEqual(['b', 'c'])
    expect(missingColumnsIn(null, ['a'])).toEqual(['a'])
  })

  it('observes the row ordering without claiming to know the selection rule', () => {
    expect(view.speciesOrdering).toBe('descending')
    expect(view.uniprotOrdering).toBe('ascending')
    expect(orderingOf([1, 2, 3])).toBe('ascending')
    expect(orderingOf([3, 2, 1])).toBe('descending')
    expect(orderingOf([1, 3, 2])).toBe('none')
    expect(orderingOf([2, 2, 2])).toBe('none')
    expect(orderingOf([1, 2])).toBe('none')
  })

  it('excludes the one exact-count rename pair from the rankings and keeps both replacements', () => {
    // CRYNJ (6,604) -> CRYD1 (6,603) is off by one on this fixture, so it no longer qualifies as an
    // exact-count rename; only USTMA -> MYCMD (6,788 -> 6,788) still does. CRYNJ/CRYD1 falls through
    // to the same prefix-and-tolerance replacement matching as DAPPU/DAPMA, so it stays in the
    // rankings, marked, rather than being excluded.
    expect(view.renames.map(link => `${link.removed}->${link.added}`)).toEqual(['USTMA->MYCMD'])
    expect([...view.excludedOscodes].sort()).toEqual(['MYCMD', 'USTMA'])
    expect(view.replacements.map(link => `${link.removed}->${link.added}`)).toEqual([
      'CRYNJ->CRYD1',
      'DAPPU->DAPMA',
    ])

    const increaseCodes = view.increases.map(row => row.oscode)
    const decreaseCodes = view.decreases.map(row => row.oscode)
    expect(increaseCodes).not.toContain('MYCMD')
    expect(decreaseCodes).not.toContain('USTMA')
    // CRYD1/CRYNJ are a replacement, not a rename, so `excludedFromRankings` is false for both -
    // they are eligible for the rankings, even though CRYD1's +6,603 is large enough to place inside
    // the top 10 increases while CRYNJ's -6,604 is not large enough to place inside the top 10
    // decreases (14 other species dropped by more).
    const cryd1 = view.speciesRows.find(row => row.oscode === 'CRYD1')
    const crynj = view.speciesRows.find(row => row.oscode === 'CRYNJ')
    expect(cryd1?.excludedFromRankings).toBe(false)
    expect(crynj?.excludedFromRankings).toBe(false)
    expect(increaseCodes).toContain('CRYD1')
    expect(decreaseCodes).not.toContain('CRYNJ')

    // Real change is what the rankings now show.
    expect(increaseCodes.slice(0, 3)).toEqual(['DAPMA', 'POPTR', 'HELAN'])
    expect(decreaseCodes.slice(0, 3)).toEqual(['BRANA', 'SOLTU', 'EUCGR'])

    // The replacement stays in - its counts differ, so part of the change is real - and is marked.
    const dappu = view.decreases.find(row => row.oscode === 'DAPPU')
    expect(dappu?.link?.kind).toBe('replacement')
    expect(dappu?.link?.confidence).toBe('likely')

    // CRYNJ falls outside the top-10 decreases window, but its own row (from the full species
    // cross-section, not the truncated ranking) still carries the same replacement marking.
    expect(cryd1?.link?.kind).toBe('replacement')
    expect(cryd1?.link?.confidence).toBe('likely')
    expect(crynj?.link?.kind).toBe('replacement')
    expect(crynj?.link?.confidence).toBe('likely')
  })

  it('separates the UniProt table aggregate row from the proteomes', () => {
    expect(view.uniprotRows).toHaveLength(19)
    expect(view.uniprotRows.map(row => row.oscode)).not.toContain('TOTAL')
    expect(view.uniprotTotals?.oscode).toBe('TOTAL')
    expect(view.uniprotTotals?.pctSameUniprot).toBe(88.2)
    expect(view.uniprotProteomes).toBe(131)
  })

  it('lists the additions and removals present in the included rows', () => {
    expect(view.addedRows.map(row => row.oscode)).toEqual(['DAPMA', 'MYCMD', 'CRYD1'])
    expect(view.removedRows).toHaveLength(16)
  })
})

describe('ComparisonReportView', () => {
  it(
    'says what is missing and why, then still shows what is known',
    () => {
      renderWithProviders(withDefinitions(<ComparisonReportView report={report} />))

      expect(
        screen.getByText('Direct previous-library totals — Partially available')
      ).toBeInTheDocument()
      expect(spanningText('Assembled from 4 of 5 report sections.')).not.toHaveLength(0)
      expect(spanningText('Missing: prev_lib')).not.toHaveLength(0)
      expect(screen.getByText('prev_lib')).toBeInTheDocument()
      // The generator's own words, not a paraphrase.
      expect(screen.getAllByText('inputs not present yet').length).toBeGreaterThanOrEqual(2)

      // Both sides of the one complete comparison, each with its own definition.
      expect(screen.getByText('Previous-library reference sequences')).toBeInTheDocument()
      expect(screen.getByText('2,692,827')).toBeInTheDocument()
      expect(screen.getByText('Reference-proteome input sequences')).toBeInTheDocument()
      expect(screen.getByText('-394,394')).toBeInTheDocument()

      // A comparison with no previous figure keeps its current value and states the gap.
      expect(screen.getAllByText('not in this report')).toHaveLength(4)
      expect(screen.getAllByText('no previous figure to compare')).toHaveLength(4)
      expect(screen.getByText('Subfamilies')).toBeInTheDocument()
      expect(screen.getByText('117,592')).toBeInTheDocument()
      expect(screen.getByText('Sequences in the built library')).toBeInTheDocument()
      expect(screen.getByText('1,742,145')).toBeInTheDocument()

      // Differing species denominators, kept apart rather than read as a contradiction.
      expect(screen.getByText('Species across both releases')).toBeInTheDocument()
      expect(screen.getByText('147')).toBeInTheDocument()
      expect(screen.getByText('Species in node forward tracking')).toBeInTheDocument()
      expect(screen.getAllByText('Genomes in the library')).toHaveLength(1)
      expect(
        spanningText('so it exceeds the number of genomes this library actually holds')
      ).not.toHaveLength(0)

      // Terminology: no count reaches the screen labelled just "Sequences".
      expect(screen.queryByText('Sequences')).toBeNull()
      expect(screen.queryByText(/no definition registered/)).toBeNull()
    },
    RENDER_TIMEOUT
  )

  it(
    'renders a removed species as -100 %, never the reported -1 %',
    () => {
      renderWithProviders(withDefinitions(<ComparisonReportView report={report} />))

      expect(screen.getAllByText('-100.0 %').length).toBeGreaterThanOrEqual(1)
      expect(screen.queryByText('-1.0 %')).toBeNull()
      expect(screen.queryByText('-1 %')).toBeNull()
      // Shown verbatim in its own column, labelled as the raw field.
      expect(screen.getAllByText('-1.00').length).toBeGreaterThanOrEqual(1)
    },
    RENDER_TIMEOUT
  )

  it(
    'withholds sort and filter on all three truncated tables and scopes its claims',
    () => {
      renderWithProviders(withDefinitions(<ComparisonReportView report={report} />))

      expect(
        screen.getAllByText('50 of 147 species included in report').length
      ).toBeGreaterThanOrEqual(1)
      expect(
        screen.getAllByText('20 of 132 proteomes included in report').length
      ).toBeGreaterThanOrEqual(1)
      expect(
        screen.getAllByText('20 of 808 UniRules included in report').length
      ).toBeGreaterThanOrEqual(1)

      expect(headerButtons('Sequence counts by species, previous versus new')).toBe(0)
      expect(headerButtons('Previous-UniProt-ID match by proteome')).toBe(0)
      expect(headerButtons('UniRules gaining membership in more than one family')).toBe(0)
      expect(document.querySelectorAll('[aria-sort]')).toHaveLength(0)

      expect(
        spanningText('Rankings are stated among the 50 species rows included in the report.')
      ).not.toHaveLength(0)
      expect(spanningText('the report does not declare how it chose them')).not.toHaveLength(0)

      // Ragged rows: the generator's count, then an independent reading of the rows present.
      expect(
        spanningText('The report marks 808 rows of the full result set as ragged.')
      ).not.toHaveLength(0)
      expect(
        spanningText('carries all 3 declared columns, so within this subset nothing is missing')
      ).not.toHaveLength(0)
      expect(screen.getAllByText('none').length).toBeGreaterThanOrEqual(20)
    },
    RENDER_TIMEOUT
  )

  it(
    'presents the exact-count pairs as renames and says why they left the rankings',
    () => {
      renderWithProviders(withDefinitions(<ComparisonReportView report={report} />))

      // Only USTMA -> MYCMD is an exact-count pair on this fixture; CRYNJ -> CRYD1 is off by one
      // and renders as the second replacement alongside DAPPU -> DAPMA.
      expect(screen.getAllByText('Rename')).toHaveLength(1)
      expect(screen.getAllByText('Replacement')).toHaveLength(2)
      expect(
        spanningText('USTMA, MYCMD are excluded from the rankings below')
      ).not.toHaveLength(0)
      expect(screen.getAllByText('likely replacement from DAPPU').length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText('likely replacement to DAPMA').length).toBeGreaterThanOrEqual(1)
      expect(spanningText('Newly added (3)')).not.toHaveLength(0)
      expect(spanningText('Removed (16)')).not.toHaveLength(0)
    },
    RENDER_TIMEOUT
  )

  it(
    'labels the aggregate row, flags the unmatched proteome, and links to the species detail',
    async () => {
      const { store, user } = renderWithProviders(
        withDefinitions(<ComparisonReportView report={report} />)
      )

      expect(screen.getByText('Aggregate row from the report (TOTAL)')).toBeInTheDocument()
      expect(screen.getByText('Sequences keeping the same UniProt ID')).toBeInTheDocument()
      expect(screen.getByText('2,028,319')).toBeInTheDocument()
      expect(screen.getAllByText('every sequence unmatched').length).toBeGreaterThanOrEqual(1)
      expect(spanningText('Every sequence unmatched: ')).not.toHaveLength(0)

      // The shell owns the species detail; this view only moves the selection.
      expect(store.getState().build.selectedOscode).toBeNull()
      await user.click(screen.getAllByRole('button', { name: 'BRANA' })[0])
      expect(store.getState().build.selectedOscode).toBe('BRANA')
    },
    RENDER_TIMEOUT
  )
})
