/**
 * One place to mount a route component or a data hook under test.
 *
 * Placement is deliberate. A helper under `src/routes/` would be picked up by
 * the TanStack Router generator on the next `dev` or `build` and written into
 * routeTree.gen.ts as a route, and naming it `*.test.tsx` to dodge that makes
 * vitest collect it as a suite with no tests. So it lives here, importing
 * nothing from `src/routes/` or `src/components/` - the edge
 * .dependency-cruiser.cjs forbids out of `lib/`.
 *
 * Route modules export only `Route`; the component is reachable at
 * `Route.options.component`. Mounting it needs a router because the route
 * files call `Link`, `useNavigate` and `Route.useParams()`, and a params read
 * resolves against the matched path shape - so a `$projectId` route has to be
 * mounted at a path carrying that segment, not at '/'.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, waitFor } from '@testing-library/react'
import { type ReactNode, Suspense } from 'react'
import i18n from '@/lib/i18n'

/**
 * The shape a route module presents to a test.
 *
 * `component` borrows createRoute's own parameter type rather than restating
 * it. RouteComponent carries a props parameter and a `preload` property, so a
 * hand-written `() => ReactNode` reads a real route but cannot be handed back
 * to createRoute, and the reverse for a ComponentType.
 */
type RouteComponent = Parameters<typeof createRoute>[0]['component']
type RouteValidateSearch = Parameters<typeof createRoute>[0]['validateSearch']

export type RouteModule = {
  Route: {
    options: {
      component?: RouteComponent
      beforeLoad?: (ctx: never) => unknown
      /**
       * Carried through to the mounted route so a page that reads search state
       * gets the same values it would in the app. Without it the router falls
       * back to its raw parser, which reads a token as a string either way and
       * quietly skips whatever normalising the route declared.
       */
      validateSearch?: RouteValidateSearch
    }
  }
}

/**
 * Retries turn one stubbed 500 into three, and the app singleton in
 * lib/query-client.ts would carry one test's cache into the next.
 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  })
}

/**
 * Wrapper for renderHook. i18next's detector reads navigator and caches to
 * localStorage, so the language is pinned rather than inherited.
 */
export function withQueryClient(client: QueryClient) {
  i18n.changeLanguage('en')
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

export type RenderRouteOptions = {
  /** Path shape to mount at, e.g. '/projects/$projectId'. */
  path?: string
  /** Address to start at, e.g. '/projects/p-1'. */
  entry?: string
  client?: QueryClient
  /**
   * Destinations the component navigates or links to. Registered as empty
   * siblings so a navigate() resolves and the test can read the new pathname
   * instead of landing on a not-found.
   */
  destinations?: string[]
  /**
   * Layout route to mount as the target's parent, for a page whose header now
   * lives above it. `path` is the segment the layout owns - the part of `path`
   * it is a prefix of - so `/projects/$projectId` plus a target at
   * `/projects/$projectId/milestones` nests exactly the way the generated tree
   * does, and the layout reads the same params it would in the app.
   */
  layout?: { module: RouteModule; path: string }
}

/**
 * Mount a route component and return the pieces a test asserts against.
 *
 * Async because RouterProvider resolves its first match after a tick and
 * renders nothing until then - a synchronous helper hands every caller an
 * empty body and a misleading "element not found".
 *
 * Router errors render as `ROUTE ERROR: ...` rather than an empty body, so a
 * test that breaks reports why instead of failing on a missing element.
 */
export async function renderRoute(mod: RouteModule, options: RenderRouteOptions = {}) {
  const {
    path = '/',
    entry = path,
    client = createTestQueryClient(),
    destinations = [],
    layout,
  } = options
  const Component = mod.Route.options.component
  if (!Component) throw new Error('route module has no component')

  i18n.changeLanguage('en')

  const rootRoute = createRootRoute()
  const layoutRoute = layout
    ? createRoute({
        getParentRoute: () => rootRoute,
        path: layout.path,
        component: layout.module.Route.options.component,
      })
    : undefined
  // A child route's path is relative to its parent, so the shared prefix is
  // the layout's and only the remainder belongs to the page.
  const childPath = layoutRoute ? path.slice(layout?.path.length) || '/' : path
  const target = createRoute({
    getParentRoute: () => layoutRoute ?? rootRoute,
    path: childPath,
    component: Component,
    validateSearch: mod.Route.options.validateSearch,
  })
  /**
   * The layout owns its own address, so a link to it - the header's own
   * "overview" tab - resolves to an index child rather than to a sibling. A
   * destination naming that address again would collide with the layout.
   */
  const layoutIndex =
    layoutRoute && childPath !== '/'
      ? [createRoute({ getParentRoute: () => layoutRoute, path: '/', component: () => null })]
      : []
  const stubs = destinations.map((to) =>
    createRoute({ getParentRoute: () => rootRoute, path: to, component: () => null }),
  )
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      layoutRoute ? layoutRoute.addChildren([target, ...layoutIndex]) : target,
      ...stubs,
    ]),
    history: createMemoryHistory({ initialEntries: [entry] }),
    defaultErrorComponent: ({ error }) => <pre>ROUTE ERROR: {String(error)}</pre>,
  })

  const result = render(
    <QueryClientProvider client={client}>
      {/*
        Mirrors the Suspense boundary in __root.tsx. The router plugin splits
        some route components into their own chunk, so mounting one without a
        boundary suspends forever and renders an empty body. Fallback is null
        so the wait below cannot mistake a placeholder for the page.
      */}
      <Suspense fallback={null}>
        {/* The generated tree types every route id; a harness tree has none. */}
        {/* biome-ignore lint/suspicious/noExplicitAny: standalone route tree */}
        <RouterProvider router={router as any} />
      </Suspense>
    </QueryClientProvider>,
  )

  // Generous, because the first render of a route pulls its whole import graph
  // through vite's transform. A route importing the date-fns locale barrel
  // needs over a second on its own, and the default of one second turns that
  // into "the router rendered nothing".
  await waitFor(
    () => {
      if (!result.container.firstChild) throw new Error('the router rendered nothing')
    },
    { timeout: 15_000 },
  )

  return { ...result, router, queryClient: client }
}
