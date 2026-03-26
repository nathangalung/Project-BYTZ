import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRootRoute, Outlet } from '@tanstack/react-router'
import { Suspense, useEffect } from 'react'
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
        <div className="min-h-screen bg-primary-600 text-neutral-100">
          <Outlet />
        </div>
      </Suspense>
    </QueryClientProvider>
  )
}

export const Route = createRootRoute({
  component: RootComponent,
})
