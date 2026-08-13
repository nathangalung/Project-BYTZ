import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRootRoute, Outlet } from '@tanstack/react-router'
import { Suspense, useEffect } from 'react'
import { ErrorBoundary } from '../components/ui/error-boundary'
import { useAuthStore } from '../stores/auth'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60,
      retry: 1,
    },
  },
})

function RootComponent() {
  const hydrate = useAuthStore((s) => s.hydrate)

  useEffect(() => {
    hydrate()
  }, [hydrate])

  return (
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={<div className="min-h-screen bg-primary-600" />}>
        {/* Inside the shell so the fallback keeps the full-height background.
            Suspense catches no render throw; without this a throw is a blank page. */}
        <div className="min-h-screen bg-primary-600 text-neutral-100">
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </div>
      </Suspense>
    </QueryClientProvider>
  )
}

export const Route = createRootRoute({
  component: RootComponent,
})
