import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRootRoute, Outlet } from '@tanstack/react-router'
import { Suspense } from 'react'
import { ToastContainer } from '@/components/layout/toast-container'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60,
      retry: 1,
    },
  },
})

function RootComponent() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastContainer />
      <Suspense
        fallback={
          <div className="flex min-h-screen items-center justify-center bg-surface">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-200 border-t-primary-500" />
          </div>
        }
      >
        <div className="min-h-screen bg-surface text-on-surface antialiased">
          <Outlet />
        </div>
      </Suspense>
    </QueryClientProvider>
  )
}

export const Route = createRootRoute({
  component: RootComponent,
})
