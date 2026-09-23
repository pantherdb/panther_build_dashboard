import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@tests/test-utils'
import { getFixtureReport } from '@/features/build/fixtures'
import { loadSidecar } from '@/features/build/fixtures/sidecars'
import { UnplacedFragmentsReportView } from '@/features/trees/components/UnplacedFragmentsReport'

/**
 * The view's honest copy for every non-ready sidecar status. Kept in a file of its own because
 * these mock `loadSidecar` module-wide - `UnplacedFragmentsReport.test.tsx` deliberately does not,
 * so its "ready" case still exercises the real test-alias + frozen fixture wiring end to end.
 */
vi.mock('@/features/build/fixtures/sidecars', () => ({ loadSidecar: vi.fn() }))

const mockedLoadSidecar = vi.mocked(loadSidecar)
const sidecarReport = getFixtureReport('gigaUsfSidecar')

describe('UnplacedFragmentsReport, sidecar failure states', () => {
  it('says the file was not shipped when loadSidecar finds none', async () => {
    mockedLoadSidecar.mockReturnValue(null)
    renderWithProviders(<UnplacedFragmentsReportView report={sidecarReport} />)
    await waitFor(() =>
      expect(screen.getByText(/was not shipped with this report/i)).toBeInTheDocument()
    )
    expect(
      screen.getByText(/build_state\.giga_usf\.json alongside build_state\.json/i)
    ).toBeInTheDocument()
    expect(screen.queryByRole('table', { name: /families with unplaced fragments/i })).toBeNull()
  })

  it('says the file belongs to a different report when the envelope does not match', async () => {
    const raw = sidecarReport.raw as { generated_at: string }
    mockedLoadSidecar.mockResolvedValue({
      schema_version: 1,
      target: 'a_completely_different_target',
      generated_at: raw.generated_at,
      section_id: 'giga_usf',
      data: { families: [] },
    })
    renderWithProviders(<UnplacedFragmentsReportView report={sidecarReport} />)
    await waitFor(() =>
      expect(screen.getByText(/belongs to a different report/i)).toBeInTheDocument()
    )
    expect(screen.queryByRole('table', { name: /families with unplaced fragments/i })).toBeNull()
  })

  it('says the file could not be read when it fails to parse', async () => {
    mockedLoadSidecar.mockResolvedValue('this is not the sidecar envelope')
    renderWithProviders(<UnplacedFragmentsReportView report={sidecarReport} />)
    await waitFor(() => expect(screen.getByText(/could not be read/i)).toBeInTheDocument())
    expect(screen.queryByRole('table', { name: /families with unplaced fragments/i })).toBeNull()
  })

  it('still shows the headline and mapping line while a failure state is showing', async () => {
    mockedLoadSidecar.mockReturnValue(null)
    renderWithProviders(<UnplacedFragmentsReportView report={sidecarReport} />)
    expect(screen.getByText(/5 unassigned in the post-GIGA mapping/i)).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByText(/was not shipped with this report/i)).toBeInTheDocument()
    )
    expect(screen.getByText(/5 unassigned in the post-GIGA mapping/i)).toBeInTheDocument()
  })
})
