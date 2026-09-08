import { Suspense, lazy } from 'react'
import type { ComponentType, LazyExoticComponent } from 'react'
import { Panel } from '@/@panther.core/components'
import { reportElementId } from '@/features/build/model'
import type { ReportRegistryEntry } from '@/features/build/model'

/**
 * Every crossing point between the pipeline spine and a report view.
 *
 * Two jobs, deliberately in one file. It maps a report section id to the view that renders it, so
 * a report hangs from the phase it describes rather than from a navigation tab. And it is the ONLY
 * place the shell names another feature's module path, so when a view moves there is exactly one
 * import to change instead of a search across the spine.
 *
 * Three rules the mapping has to keep:
 *
 *   A view may serve several sections. The release comparison is assembled from `prev_lib` AND
 *   `other_reports`, so both ids resolve to the same renderer and the caller de-duplicates by
 *   `key` - the spine must not mount one view twice on one phase.
 *
 *   An unmapped section still renders. Anything without a specialised view falls through to the
 *   generic renderer, which is what makes an unfamiliar future section visible instead of lost.
 *
 *   Every view is lazy. A report is only fetched when the phase that owns it is opened, and the
 *   shell renders without waiting on any of them.
 */

export interface SpecialisedRenderer {
  /** Renderer identity. Two section ids sharing a view share this key. */
  key: string
  /** Shown at the mount point before the chunk resolves, so the slot is never blank. */
  title: string
  sectionIds: readonly string[]
  Component: LazyExoticComponent<ComponentType>
}

const MappingReport = lazy(() => import('@/features/mapping/components/MappingReport'))
const NodeTrackingReport = lazy(() => import('@/features/nodes/components/NodeTrackingReport'))
const ComparisonReport = lazy(() => import('@/features/comparison/components/ComparisonReport'))
const ProteomesReport = lazy(() => import('@/features/proteomes/components/ProteomesReport'))

const GenericReport = lazy(() =>
  import('@/features/reports/components/GenericReport').then(module => ({
    default: module.GenericReport,
  }))
)

const ChecksPanel = lazy(() => import('@/features/checks/components/ChecksPanel'))

const SpeciesDetail = lazy(() =>
  import('@/features/species/components/SpeciesDetail').then(module => ({
    default: module.SpeciesDetail,
  }))
)

export const SPECIALISED_RENDERERS: readonly SpecialisedRenderer[] = [
  {
    key: 'mapping',
    title: 'Sequence mapping statistics',
    sectionIds: ['mapping'],
    Component: MappingReport,
  },
  {
    key: 'node-tracking',
    title: 'Node forward tracking',
    sectionIds: ['node_tracking'],
    Component: NodeTrackingReport,
  },
  {
    key: 'proteomes',
    title: 'Reference proteomes',
    sectionIds: ['proteomes'],
    Component: ProteomesReport,
  },
  {
    key: 'comparison',
    title: 'Previous-library comparison',
    sectionIds: ['prev_lib', 'other_reports'],
    Component: ComparisonReport,
  },
]

const BY_SECTION = new Map<string, SpecialisedRenderer>()
for (const renderer of SPECIALISED_RENDERERS) {
  for (const sectionId of renderer.sectionIds) BY_SECTION.set(sectionId, renderer)
}

/** `null` when no specialised view claims the section, which means the generic one renders it. */
export function getReportRenderer(sectionId: string): SpecialisedRenderer | null {
  return BY_SECTION.get(sectionId) ?? null
}

/** The renderer key a section resolves to, used to de-duplicate mounts on one phase. */
export function rendererKeyFor(sectionId: string): string {
  return getReportRenderer(sectionId)?.key ?? `generic:${sectionId}`
}

const Pending = ({ title, subtitle }: { title: string; subtitle?: string }) => (
  <Panel title={title} subtitle={subtitle} density="tight">
    <p className="text-ink-faint text-2xs">Loading this report…</p>
  </Panel>
)

export interface ReportMountProps {
  report: ReportRegistryEntry
}

/**
 * Mounts one report section under the phase it describes.
 *
 * The anchor lives on this wrapper rather than inside the view, so a deep link to a section
 * resolves to the same element whether a specialised view or the generic fallback rendered it.
 */
export const ReportMount = ({ report }: ReportMountProps) => {
  const renderer = getReportRenderer(report.sectionId)
  const title = renderer?.title ?? report.title ?? report.sectionId

  return (
    <div
      id={reportElementId(report.sectionId)}
      data-pb-anchor=""
      data-pb-break="avoid"
      data-report-section={report.sectionId}
    >
      <Suspense fallback={<Pending title={title} subtitle={report.sectionId} />}>
        {renderer ? <renderer.Component /> : <GenericReport report={report} />}
      </Suspense>
    </div>
  )
}

/** The build-wide checks and warnings view. Not section-bound; the shell mounts exactly one. */
export const ChecksMount = () => (
  <Suspense fallback={<Pending title="Checks and warnings" />}>
    <ChecksPanel />
  </Suspense>
)

export interface SpeciesDetailMountProps {
  oscode: string
  onClose?: () => void
}

/**
 * The species cross-section. The shell owns this mount and drives `oscode` from the store, so a
 * report opens a species by dispatching a selection rather than rendering a second copy.
 */
export const SpeciesDetailMount = ({ oscode, onClose }: SpeciesDetailMountProps) => (
  <Suspense fallback={<Pending title="Species detail" subtitle={oscode} />}>
    <SpeciesDetail oscode={oscode} onClose={onClose} />
  </Suspense>
)
