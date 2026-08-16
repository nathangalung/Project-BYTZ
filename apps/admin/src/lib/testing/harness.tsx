/**
 * One place to mount an admin route component under test.
 *
 * Placement mirrors apps/web/src/lib/testing/harness.tsx. A helper under
 * `src/routes/` would be picked up by the TanStack Router generator on the next
 * `dev` or `build` and written into routeTree.gen.ts as a route, and naming it
 * `*.test.tsx` to dodge that makes vitest collect it as a suite with no tests.
 *
 * The preload call is the reason this is shared rather than repeated. Admin
 * keeps autoCodeSplitting on under vitest, so `Route.options.component` is a
 * lazy wrapper carrying `preload()`, and calling it swaps the property for the
 * resolved component. The wrapper is gone from the second call onward, which is
 * why it is optional here: ten test files spelled `preload()` unconditionally
 * and every one of them passed its first test and failed the rest the moment
 * @tanstack/router-plugin started doing that swap. Optional also means these
 * tests survive autoCodeSplitting being turned off, where there is no wrapper
 * at all.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'

/** What a route module shows a test. */
export type RouteModule = {
  Route: { options: { component?: unknown } }
}

/** Resolve the split chunk, then hand back the real component. */
async function resolve(mod: RouteModule): Promise<() => ReactNode> {
  const lazy = mod.Route.options.component as { preload?: () => Promise<unknown> } | undefined
  if (!lazy) throw new Error('route module has no component')
  await lazy.preload?.()
  return mod.Route.options.component as () => ReactNode
}

/** Mount a route that reads no server state. */
export async function renderRoute(mod: RouteModule) {
  const Component = await resolve(mod)
  return render(<Component />)
}

/**
 * Mount a route that fetches. Retries would turn one stubbed 500 into three, so
 * the client is per-render and never retries.
 */
export async function renderRouteWithQuery(mod: RouteModule) {
  const Component = await resolve(mod)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Component />
    </QueryClientProvider>,
  )
}
