import { useMemo } from 'react'
import { MantineProvider } from '@mantine/core'
import { Notifications } from '@mantine/notifications'
import { RouterProvider } from 'react-router-dom'
import { MetricDefinitionsProvider } from '@/@panther.core/components'
import { mantineTheme } from '@/@panther.core/theme/mantineTheme'
import { useAppSelector } from '@/app/hooks'
import { buildMetricRegistry } from '@/app/metricRegistry'
import { selectColorScheme } from '@/app/slices/uiSlice'
import { router } from '@/app/routes'
import { useBuildReport } from '@/features/build/hooks'

const App = () => {
  // The scheme is driven from the store, so MantineProvider is a controlled
  // consumer of it rather than holding a second copy of the same state.
  const colorScheme = useAppSelector(selectColorScheme)

  // `useBuildReport` reads only `useAppSelector` under the hood (the fixture key, not
  // anything router-derived), so it is safe to call here, above `RouterProvider`, and the
  // merged registry can be provided once for the whole tree rather than per-route.
  const report = useBuildReport()
  const registry = useMemo(() => buildMetricRegistry(report), [report])

  return (
    <MantineProvider theme={mantineTheme} forceColorScheme={colorScheme}>
      <MetricDefinitionsProvider registry={registry}>
        <Notifications />
        <RouterProvider router={router} />
      </MetricDefinitionsProvider>
    </MantineProvider>
  )
}

export default App
