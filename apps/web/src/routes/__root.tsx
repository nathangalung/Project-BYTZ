import { QueryClientProvider } from '@tanstack/react-query'
import { createRootRoute, Outlet } from '@tanstack/react-router'
import { Suspense, useEffect } from 'react'
import { ToastContainer } from '@/components/layout/toast-container'
import { queryClient } from '@/lib/query-client'
import { useAuthStore } from '@/stores/auth'

function RootComponent() {
  const hydrate = useAuthStore((s) => s.hydrate)

  useEffect(() => {
    const controller = new AbortController()
    hydrate(controller.signal)
    return () => controller.abort()
  }, [hydrate])

  return (
    <QueryClientProvider client={queryClient}>
      <ToastContainer />
      <Suspense
        fallback={
          <div className="flex min-h-dvh items-center justify-center bg-surface">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-200 border-t-primary-500" />
          </div>
        }
      >
        {/*
          dvh, not vh. The authenticated shell below is exactly h-dvh and owns
          its own scrolling, so a 100vh floor here made the document taller
          than the shell by the height of the mobile browser chrome. That strip
          held nothing and painted --color-surface, which is what read as blank
          white space under a page that had already stopped scrolling.
        */}
        <div className="min-h-dvh bg-surface text-on-surface antialiased">
          <Outlet />
        </div>
      </Suspense>
    </QueryClientProvider>
  )
}

export const Route = createRootRoute({
  component: RootComponent,
})
