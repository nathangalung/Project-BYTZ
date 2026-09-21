// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/lib/i18n'
import { useAuthStore } from '@/stores/auth'
import * as detailLayout from './route'

/**
 * The chrome above the project tabs.
 *
 * Every tab used to print its own back link, project title and tab strip, so
 * a switch unmounted the header and built an identical one back up - the title
 * blanked while the next page's `useProject` resolved and the strip jumped.
 * The layout is the parent of all four tabs now, and the test that matters is
 * the one below that keeps a reference to the heading element and finds the
 * same DOM node after navigating: same node means React never unmounted it.
 */

vi.setConfig({ testTimeout: 30_000 })

const apiFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, apiFetch }
})

const PROJECT = { id: 'p-1', title: 'Toko Online Batik', status: 'in_progress' }

function signIn(role: 'owner' | 'talent') {
  useAuthStore.setState({
    user: { id: 'u1', email: 'u@kerjacus.id', name: 'U', role, locale: 'id' } as never,
    isAuthenticated: true,
    isLoading: false,
  })
}

/**
 * The layout with two real children under it, which is the only shape that can
 * answer "does the header survive a tab switch". Extra addresses are registered
 * flat so the strip's other links resolve.
 */
async function renderLayout(entry: string) {
  i18n.changeLanguage('en')
  const Component = detailLayout.Route.options.component
  if (!Component) throw new Error('layout has no component')

  const rootRoute = createRootRoute()
  const layoutRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/projects/$projectId',
    component: Component,
  })
  const overview = createRoute({
    getParentRoute: () => layoutRoute,
    path: '/',
    component: () => <p>overview body</p>,
  })
  const milestones = createRoute({
    getParentRoute: () => layoutRoute,
    path: 'milestones',
    component: () => <p>milestones body</p>,
  })
  const brd = createRoute({
    getParentRoute: () => layoutRoute,
    path: 'brd',
    component: () => <p>brd body</p>,
  })
  const stubs = ['/projects', '/talent', '/projects/$projectId/documents'].map((path) =>
    createRoute({ getParentRoute: () => rootRoute, path, component: () => null }),
  )
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      layoutRoute.addChildren([overview, milestones, brd]),
      ...stubs,
    ]),
    history: createMemoryHistory({ initialEntries: [entry] }),
    defaultErrorComponent: ({ error }) => <pre>ROUTE ERROR: {String(error)}</pre>,
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  })

  const result = render(
    <QueryClientProvider client={client}>
      {/* biome-ignore lint/suspicious/noExplicitAny: standalone route tree */}
      <RouterProvider router={router as any} />
    </QueryClientProvider>,
  )
  await waitFor(() => {
    if (!result.container.firstChild) throw new Error('the router rendered nothing')
  })
  return result
}

beforeEach(() => {
  apiFetch.mockReset()
  apiFetch.mockImplementation(async () => ({ success: true, data: PROJECT }))
  signIn('owner')
})

describe('the shared project header', () => {
  it('prints the title, the tab strip and one back link above the tab body', async () => {
    await renderLayout('/projects/p-1')

    expect(await screen.findByRole('heading', { name: 'Toko Online Batik' })).toBeDefined()
    expect(screen.getByRole('navigation', { name: 'Tabs' })).toBeDefined()
    expect(screen.getByText('overview body')).toBeDefined()
    expect(screen.getByRole('link', { name: 'Back' }).getAttribute('href')).toBe('/projects')
  })

  it('marks the tab the address is on as the current page', async () => {
    await renderLayout('/projects/p-1/milestones')

    const current = await screen.findByText('Milestones')
    expect(current.getAttribute('aria-current')).toBe('page')
    // The tab showing is a label, not a link back to itself.
    expect(screen.queryByRole('link', { name: 'Milestones' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Overview' })).toBeDefined()
  })

  it('keeps the same header element mounted while the tab body swaps', async () => {
    const user = userEvent.setup()
    await renderLayout('/projects/p-1')
    const heading = await screen.findByRole('heading', { name: 'Toko Online Batik' })

    await user.click(screen.getByRole('link', { name: 'Milestones' }))

    expect(await screen.findByText('milestones body')).toBeDefined()
    expect(screen.queryByText('overview body')).toBeNull()
    // Same node, so React never tore the header down and rebuilt it.
    expect(screen.getByRole('heading', { name: 'Toko Online Batik' })).toBe(heading)
  })

  /** A talent has no owner project list to return to, only their own home. */
  it('sends a talent back to their own home', async () => {
    signIn('talent')

    await renderLayout('/projects/p-1')

    await screen.findByRole('heading', { name: 'Toko Online Batik' })
    expect(screen.getByRole('link', { name: 'Back' }).getAttribute('href')).toBe('/talent')
  })

  it('draws no header before the project has loaded', async () => {
    apiFetch.mockImplementation(() => new Promise(() => {}))

    await renderLayout('/projects/p-1')

    expect(screen.getByText('overview body')).toBeDefined()
    expect(screen.queryByRole('navigation', { name: 'Tabs' })).toBeNull()
  })

  /** BRD, PRD, scoping, checkout and matching are drill-ins, not tabs. */
  it('leaves a drill-in page to its own header', async () => {
    await renderLayout('/projects/p-1/brd')

    expect(await screen.findByText('brd body')).toBeDefined()
    expect(screen.queryByRole('navigation', { name: 'Tabs' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Toko Online Batik' })).toBeNull()
  })
})
