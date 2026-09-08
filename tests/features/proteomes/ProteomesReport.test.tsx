import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import { renderWithProviders } from '@tests/test-utils'
import { getFixtureReport } from '@/features/build/fixtures'
import { ProteomesReportView } from '@/features/proteomes/components/ProteomesReport'
import { getReportRenderer } from '@/features/reports/registry'

/**
 * The view that replaces a single "QfO release declared" line.
 *
 * The header claim it supersedes was one release for a library built from three, and on the
 * captured report it renders as "not declared" because issue #65 retired the variable it read. So
 * the bar this view has to clear is not "shows a table": it has to say what the library was built
 * from, mark the proteomes sitting off their source's majority release, and refuse to let a reader
 * take `version_changed: 0` for stability when the previous roster could not support the comparison.
 */

const report = getFixtureReport('real')

const renderReport = () => renderWithProviders(<ProteomesReportView report={report} />)

describe('release composition', () => {
  it('names every source and release the library was built from', () => {
    renderReport()
    const composition = screen.getByRole('list', { name: /release composition/i })

    expect(within(composition).getByText(/QfO 2026_02/)).toBeInTheDocument()
    expect(within(composition).getByText(/RefProt 2026_02/)).toBeInTheDocument()
    expect(within(composition).getByText(/RefProt 2026_01/)).toBeInTheDocument()
  })

  it('marks the bucket that is off its majority release', () => {
    renderReport()
    const composition = screen.getByRole('list', { name: /release composition/i })
    const offMajority = within(composition).getByRole('listitem', { name: /RefProt 2026_01/i })

    expect(within(offMajority).getByText(/off majority/i)).toBeInTheDocument()
  })

  it('does not mark the majority buckets', () => {
    renderReport()
    const composition = screen.getByRole('list', { name: /release composition/i })
    const majority = within(composition).getByRole('listitem', { name: /QfO 2026_02/i })

    expect(within(majority).queryByText(/off majority/i)).not.toBeInTheDocument()
  })
})

describe('the roster', () => {
  it('lists a proteome with its source, release and change', () => {
    renderReport()
    const roster = screen.getByRole('table', { name: /reference proteomes/i })
    const row = within(roster).getByRole('row', { name: /daphnia_magna/i })

    expect(within(row).getByText('UP000076858')).toBeInTheDocument()
    expect(within(row).getByText('DAPMA')).toBeInTheDocument()
    expect(within(row).getByText('QfO')).toBeInTheDocument()
    expect(within(row).getByText('2026_02')).toBeInTheDocument()
  })

  it('lists the proteomes dropped since the previous library', () => {
    renderReport()
    const dropped = screen.getByRole('table', { name: /dropped since the previous library/i })

    expect(within(dropped).getByRole('row', { name: /amborella_trichopoda/i })).toBeInTheDocument()
  })
})

describe('what the report cannot support', () => {
  it('says release changes were not measurable rather than showing a bare zero', () => {
    renderReport()

    // `version_changed: 0` against an unstamped previous roster is "could not be measured".
    // Presenting it as a count would tell a reader no proteome changed release.
    expect(screen.getByText(/previous roster predates/i)).toBeInTheDocument()
  })

  it('surfaces every warning the generator raised', () => {
    renderReport()
    const warnings = screen.getByRole('list', { name: /generator warnings/i })

    expect(within(warnings).getAllByRole('listitem')).toHaveLength(3)
  })
})

describe('the spine mounts it', () => {
  it('claims the proteomes section, so it stops falling through to the generic renderer', () => {
    const renderer = getReportRenderer('proteomes')

    expect(renderer).not.toBeNull()
    expect(renderer?.sectionIds).toContain('proteomes')
  })
})
