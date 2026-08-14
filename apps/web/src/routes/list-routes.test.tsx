// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderRoute } from '@/lib/testing/harness'
import { useAuthStore } from '@/stores/auth'
import { ApiError } from '../lib/api'
import * as browseRoute from './_authenticated/browse'
import * as messagesRoute from './_authenticated/messages/index'
import * as notificationsRoute from './_authenticated/notifications'
import * as paymentsRoute from './_authenticated/payments/index'

/**
 * The four-state pattern in CLAUDE.md says every fetching view owes the user a
 * loading, empty, error and populated state. These pin all four per route,
 * because the failure mode they prevent - a blank page that looks like a bug
 * and gives no way forward - is the one users actually hit.
 */

/*
 * Mounting a route pulls its whole import graph through vite's transform on
 * first render, and the router plugin splits some route components into their
 * own chunk, so that cost lands inside the test rather than at import time.
 * Measured at over five seconds for the heaviest route under a full parallel
 * run, against a default timeout of five - which fails only when the whole
 * workspace runs, the worst way to find out.
 */
vi.setConfig({ testTimeout: 30_000 })

const apiFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, apiFetch }
})
vi.mock('@/lib/centrifugo', () => ({
  connectCentrifugo: vi.fn(),
  disconnectCentrifugo: vi.fn(),
  subscribeTo: vi.fn(() => vi.fn()),
}))

/** A promise that never settles, so the view stays in its loading state. */
const NEVER = () => new Promise(() => {})

beforeEach(() => {
  apiFetch.mockReset()
  useAuthStore.setState({
    user: { id: 'u1', email: 'o@kerjacus.id', name: 'O', role: 'owner', locale: 'id' },
    isAuthenticated: true,
    isLoading: false,
  })
})

describe('the notifications page', () => {
  it('shows the empty state when there is nothing to read', async () => {
    apiFetch.mockResolvedValue({ success: true, data: { items: [], total: 0 } })

    await renderRoute(notificationsRoute, { path: '/notifications' })

    expect(await screen.findByText('No Notifications Yet')).toBeDefined()
  })

  it('lists what arrived and marks the unread ones', async () => {
    apiFetch.mockResolvedValue({
      success: true,
      data: {
        items: [
          {
            id: 'n1',
            type: 'payment',
            title: 'Escrow released',
            message: 'Milestone 1 paid',
            link: '/payments',
            isRead: false,
            createdAt: new Date().toISOString(),
          },
        ],
        total: 1,
      },
    })

    await renderRoute(notificationsRoute, { path: '/notifications' })

    expect(await screen.findByText('Escrow released')).toBeDefined()
    // The unread count badge and the bulk action both key off isRead.
    expect(screen.getByRole('button', { name: /mark all as read/i })).toBeDefined()
  })

  it('offers no bulk action when everything is already read', async () => {
    apiFetch.mockResolvedValue({
      success: true,
      data: {
        items: [
          {
            id: 'n1',
            type: 'system',
            title: 'Welcome',
            message: 'hi',
            link: null,
            isRead: true,
            createdAt: new Date().toISOString(),
          },
        ],
        total: 1,
      },
    })

    await renderRoute(notificationsRoute, { path: '/notifications' })

    await screen.findByText('Welcome')
    expect(screen.queryByRole('button', { name: /mark all as read/i })).toBeNull()
  })

  it('narrows the request when a filter tab is chosen', async () => {
    const user = userEvent.setup()
    apiFetch.mockResolvedValue({ success: true, data: { items: [], total: 0 } })
    await renderRoute(notificationsRoute, { path: '/notifications' })
    await screen.findByText('No Notifications Yet')

    await user.click(screen.getByRole('button', { name: 'Payments' }))

    await waitFor(() => {
      const urls = apiFetch.mock.calls.map((c) => String(c[0]))
      expect(urls.some((u) => u.includes('type=payment'))).toBe(true)
    })
  })

  it('marks one read when it is opened', async () => {
    const user = userEvent.setup()
    apiFetch.mockResolvedValue({
      success: true,
      data: {
        items: [
          {
            id: 'n1',
            type: 'system',
            title: 'Welcome',
            message: 'hi',
            link: null,
            isRead: false,
            createdAt: new Date().toISOString(),
          },
        ],
        total: 1,
      },
    })
    await renderRoute(notificationsRoute, { path: '/notifications' })
    await screen.findByText('Welcome')

    await user.click(screen.getByText('Welcome'))

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith('/api/v1/notifications/n1/read', { method: 'PATCH' }),
    )
  })
})

/**
 * This route does not go through apiFetch. It calls fetch directly and its
 * loader returns an empty page on any failure, so the stubs here are at the
 * fetch boundary rather than the client.
 */
describe('the talent browse page', () => {
  function stubPublicProjects(impl: () => Promise<Response>) {
    globalThis.fetch = vi.fn(impl) as unknown as typeof fetch
  }

  function projectsBody(items: unknown[]) {
    return new Response(JSON.stringify({ data: { items, total: items.length } }), { status: 200 })
  }

  it('shows the empty state when nothing matches', async () => {
    stubPublicProjects(async () => projectsBody([]))

    await renderRoute(browseRoute, { path: '/browse' })

    expect(await screen.findByText('No projects available yet')).toBeDefined()
  })

  it('renders a project that is open for applications', async () => {
    stubPublicProjects(async () =>
      projectsBody([
        {
          id: 'p1',
          title: 'Toko Online',
          category: 'web_app',
          budgetMin: 5_000_000,
          budgetMax: 10_000_000,
          estimatedTimelineDays: 30,
          status: 'matching',
          createdAt: new Date().toISOString(),
        },
      ]),
    )

    await renderRoute(browseRoute, { path: '/browse' })

    expect(await screen.findByText('Toko Online')).toBeDefined()
  })

  it('names its category filter for assistive technology', async () => {
    stubPublicProjects(async () => projectsBody([]))

    await renderRoute(browseRoute, { path: '/browse' })

    expect(await screen.findByRole('navigation', { name: /filter by category/i })).toBeDefined()
  })

  /**
   * Records a defect rather than endorsing it. fetchPublicProjects catches
   * every failure and returns an empty page, so the query never enters an
   * error state and the branch that renders one is unreachable. A talent
   * looking for work during an outage is told there is none.
   *
   * When that is fixed these two will fail, which is the point: change them
   * to assert the error state rather than deleting them.
   */
  describe('known defect: a failed load is indistinguishable from an empty one', () => {
    it('renders the empty state on a 500', async () => {
      stubPublicProjects(async () => new Response('{}', { status: 500 }))

      await renderRoute(browseRoute, { path: '/browse' })

      expect(await screen.findByText('No projects available yet')).toBeDefined()
    })

    it('renders the empty state when the connection drops', async () => {
      stubPublicProjects(async () => {
        throw new TypeError('Failed to fetch')
      })

      const { container } = await renderRoute(browseRoute, { path: '/browse' })

      expect(await screen.findByText('No projects available yet')).toBeDefined()
      expect(container.textContent).not.toMatch(/try again/i)
    })
  })
})

/**
 * The filters, and the card body they reveal.
 *
 * Category is a server-side filter and status is a client-side one, so a bug
 * in either shows the talent a shorter list of work than exists. The card
 * itself carries the figures a talent decides on: budget range, timeline,
 * team size and whether the project is still taking people.
 */
describe('browsing with filters applied', () => {
  function stubPublicProjects(impl: (url: string) => Promise<Response>) {
    const spy = vi.fn((url: string) => impl(String(url)))
    globalThis.fetch = spy as unknown as typeof fetch
    return spy
  }

  function projectsBody(items: unknown[]) {
    return new Response(JSON.stringify({ data: { items, total: items.length } }), { status: 200 })
  }

  const OPEN = {
    id: 'p1',
    title: 'Toko Online',
    description: 'Marketplace kopi',
    category: 'web_app',
    budgetMin: 5_000_000,
    budgetMax: 10_000_000,
    estimatedTimelineDays: 30,
    teamSize: 3,
    status: 'matching',
    preferences: { requiredSkills: ['React', 'Go', 'Postgres', 'Figma'] },
    createdAt: new Date().toISOString(),
  }
  const RUNNING = { ...OPEN, id: 'p2', title: 'Aplikasi Kasir', status: 'in_progress' }

  it('asks the server for the chosen category and marks the button pressed', async () => {
    const user = userEvent.setup()
    const spy = stubPublicProjects(async () => projectsBody([OPEN]))

    await renderRoute(browseRoute, {
      path: '/browse',
      destinations: ['/project-detail/$projectId'],
    })
    await screen.findByText('Toko Online')

    await user.click(screen.getByRole('button', { name: 'Mobile App' }))

    await waitFor(() =>
      expect(spy.mock.calls.some(([u]) => String(u).includes('category=mobile_app'))).toBe(true),
    )
    expect(screen.getByRole('button', { name: 'Mobile App' }).getAttribute('aria-pressed')).toBe(
      'true',
    )
  })

  it('sends no category parameter for All', async () => {
    const spy = stubPublicProjects(async () => projectsBody([OPEN]))

    await renderRoute(browseRoute, {
      path: '/browse',
      destinations: ['/project-detail/$projectId'],
    })
    await screen.findByText('Toko Online')

    expect(spy.mock.calls.every(([u]) => !String(u).includes('category='))).toBe(true)
  })

  /** Status is filtered in the browser, so no request goes out for it. */
  it('narrows the rendered list by status without refetching', async () => {
    const user = userEvent.setup()
    const spy = stubPublicProjects(async () => projectsBody([OPEN, RUNNING]))

    await renderRoute(browseRoute, {
      path: '/browse',
      destinations: ['/project-detail/$projectId'],
    })
    await screen.findByText('Toko Online')
    const before = spy.mock.calls.length

    // The status select carries no accessible name; see the report.
    await user.selectOptions(screen.getByRole('combobox'), 'in_progress')

    expect(screen.getByText('Aplikasi Kasir')).toBeDefined()
    expect(screen.queryByText('Toko Online')).toBeNull()
    expect(spy.mock.calls.length).toBe(before)
  })

  it('says nothing matches when the status filter empties the list', async () => {
    const user = userEvent.setup()
    stubPublicProjects(async () => projectsBody([OPEN]))

    await renderRoute(browseRoute, {
      path: '/browse',
      destinations: ['/project-detail/$projectId'],
    })
    await screen.findByText('Toko Online')

    await user.selectOptions(screen.getByRole('combobox'), 'completed')

    expect(await screen.findByText('No projects available yet')).toBeDefined()
  })

  it('treats a reply with no data envelope as an empty page', async () => {
    stubPublicProjects(async () => new Response(JSON.stringify({ success: true }), { status: 200 }))

    await renderRoute(browseRoute, { path: '/browse' })

    expect(await screen.findByText('No projects available yet')).toBeDefined()
  })

  it('shows the first three skills and counts the rest', async () => {
    stubPublicProjects(async () => projectsBody([OPEN]))

    await renderRoute(browseRoute, {
      path: '/browse',
      destinations: ['/project-detail/$projectId'],
    })

    const card = await screen.findByRole('link', { name: /Toko Online/ })
    expect(within(card).getByText('React')).toBeDefined()
    expect(within(card).getByText('Postgres')).toBeDefined()
    expect(within(card).queryByText('Figma')).toBeNull()
    expect(within(card).getByText('+1')).toBeDefined()
  })

  it('omits the overflow count when three skills or fewer are asked for', async () => {
    stubPublicProjects(async () =>
      projectsBody([{ ...OPEN, preferences: { requiredSkills: ['React'] } }]),
    )

    await renderRoute(browseRoute, {
      path: '/browse',
      destinations: ['/project-detail/$projectId'],
    })

    const card = await screen.findByRole('link', { name: /Toko Online/ })
    expect(within(card).queryByText(/^\+/)).toBeNull()
  })

  it('flags only the projects still taking people', async () => {
    stubPublicProjects(async () =>
      projectsBody([OPEN, { ...RUNNING, status: 'team_forming' }, { ...RUNNING, id: 'p3' }]),
    )

    await renderRoute(browseRoute, {
      path: '/browse',
      destinations: ['/project-detail/$projectId'],
    })
    await screen.findByText('Toko Online')

    // matching and team_forming carry the badge; in_progress does not.
    expect(screen.getAllByText('Looking for Talent')).toHaveLength(2)
  })

  /** A row missing the optional half must still render its figures. */
  it('renders a project with no category, skills, team size or known status', async () => {
    stubPublicProjects(async () =>
      projectsBody([
        {
          id: 'p9',
          title: 'Proyek Tanpa Kategori',
          description: 'Belum lengkap',
          budgetMin: 1_000_000,
          budgetMax: 2_000_000,
          estimatedTimelineDays: 14,
          status: 'archived',
          createdAt: new Date().toISOString(),
        },
      ]),
    )

    await renderRoute(browseRoute, {
      path: '/browse',
      destinations: ['/project-detail/$projectId'],
    })

    const card = await screen.findByRole('link', { name: /Proyek Tanpa Kategori/ })
    // An untranslated status falls back to the raw value rather than the key.
    expect(within(card).getByText('archived')).toBeDefined()
    expect(card.textContent).not.toContain('status_archived')
    expect(within(card).getByText('1')).toBeDefined()
  })

  /** The admin API can answer without a status at all on a draft row. */
  it('renders a project whose status field is absent', async () => {
    stubPublicProjects(async () =>
      projectsBody([
        {
          id: 'p10',
          title: 'Tanpa Status',
          description: 'Belum ada status',
          budgetMin: 1_000_000,
          budgetMax: 2_000_000,
          estimatedTimelineDays: 7,
          createdAt: new Date().toISOString(),
        },
      ]),
    )

    await renderRoute(browseRoute, {
      path: '/browse',
      destinations: ['/project-detail/$projectId'],
    })

    const card = await screen.findByRole('link', { name: /Tanpa Status/ })
    expect(card.textContent).not.toContain('undefined')
    expect(within(card).queryByText('Looking for Talent')).toBeNull()
  })
})

describe('the payments page', () => {
  it('holds the loading state until both the summary and the history land', async () => {
    apiFetch.mockImplementation(NEVER)

    const { container } = await renderRoute(paymentsRoute, { path: '/payments' })

    expect(container.textContent).toContain('Payment History')
    expect(container.textContent).not.toContain('No transactions yet.')
  })

  it('shows the empty state for an account with no transactions', async () => {
    apiFetch.mockResolvedValue({
      success: true,
      data: { items: [], total: 0, totalSpent: 0, totalEarned: 0, pending: 0, thisMonth: 0 },
    })

    await renderRoute(paymentsRoute, { path: '/payments' })

    expect(await screen.findByText('No transactions yet.')).toBeDefined()
  })

  /** A failed history must not read as "you have never paid for anything". */
  it('reports a failed history load with a way to retry', async () => {
    apiFetch.mockRejectedValue(new ApiError('boom', 500, 'INTERNAL_ERROR'))

    await renderRoute(paymentsRoute, { path: '/payments' })

    expect(await screen.findByText('Failed to load payment history')).toBeDefined()
    expect(screen.getByRole('button', { name: /try again/i })).toBeDefined()
  })

  it('lists the transactions it was given', async () => {
    apiFetch.mockResolvedValue({
      success: true,
      data: {
        items: [
          {
            id: 'tx1',
            projectId: 'p1',
            projectTitle: 'Toko Online',
            type: 'escrow_in',
            amount: 10_000_000,
            status: 'completed',
            createdAt: new Date().toISOString(),
          },
        ],
        total: 1,
        totalSpent: 10_000_000,
        totalEarned: 0,
        pending: 0,
        thisMonth: 10_000_000,
      },
    })

    await renderRoute(paymentsRoute, { path: '/payments' })

    expect(await screen.findByText('Toko Online')).toBeDefined()
  })

  /**
   * An owner spends and a talent earns. Showing both totals to both sides
   * puts a permanent zero on the page and invites the reading that the
   * platform lost the money.
   */
  it('shows the owner what they spent, not what they earned', async () => {
    apiFetch.mockResolvedValue({
      success: true,
      data: {
        items: [],
        total: 0,
        totalSpent: 5_000_000,
        totalEarned: 0,
        pending: 0,
        thisMonth: 0,
      },
    })

    const { container } = await renderRoute(paymentsRoute, { path: '/payments' })

    await screen.findByText('No transactions yet.')
    expect(container.textContent).toContain('Total Spent')
    expect(container.textContent).not.toContain('Total Earned')
  })

  it('shows the talent what they earned, not what they spent', async () => {
    useAuthStore.setState({
      user: { id: 't1', email: 't@kerjacus.id', name: 'T', role: 'talent', locale: 'id' },
      isAuthenticated: true,
      isLoading: false,
    })
    apiFetch.mockResolvedValue({
      success: true,
      data: {
        items: [],
        total: 0,
        totalSpent: 0,
        totalEarned: 5_000_000,
        pending: 0,
        thisMonth: 0,
      },
    })

    const { container } = await renderRoute(paymentsRoute, { path: '/payments' })

    await screen.findByText('No transactions yet.')
    expect(container.textContent).toContain('Total Earned')
    expect(container.textContent).not.toContain('Total Spent')
  })
})

/**
 * The rest of the notification centre.
 *
 * The bulk action, the deep link, the icon fallback and the relative clock.
 * Each is the difference between a notification the user can act on and a row
 * that only looks like one.
 */
/**
 * The ledger row itself.
 *
 * Sign and colour are computed from the viewer's role: the same
 * escrow_release is money in for a talent and money out for an owner. Getting
 * that backwards tells someone they were paid when they paid.
 */
describe('the payment history rows', () => {
  function txn(over: Record<string, unknown> = {}) {
    return {
      id: 'tx1',
      projectId: 'p1',
      projectTitle: 'Toko Online',
      type: 'escrow_in',
      amount: 10_000_000,
      status: 'completed',
      createdAt: new Date().toISOString(),
      ...over,
    }
  }

  function stubHistory(items: unknown[]) {
    apiFetch.mockResolvedValue({
      success: true,
      data: {
        items,
        total: items.length,
        totalSpent: 0,
        totalEarned: 0,
        pending: 0,
        thisMonth: 0,
      },
    })
  }

  function signOf(title: string) {
    const row = screen.getByText(title).closest('tr') as HTMLElement
    return within(row).getByText(/^[+-]/).textContent?.[0]
  }

  it('reads an escrow release as money in for a talent', async () => {
    useAuthStore.setState({
      user: { id: 'u1', email: 't@kerjacus.id', name: 'T', role: 'talent', locale: 'id' },
      isAuthenticated: true,
      isLoading: false,
    })
    stubHistory([txn({ type: 'escrow_release' })])

    await renderRoute(paymentsRoute, { path: '/payments' })
    await screen.findByText('Toko Online')

    expect(signOf('Toko Online')).toBe('+')
  })

  it('reads the same release as money out for the owner', async () => {
    stubHistory([txn({ type: 'escrow_release' })])

    await renderRoute(paymentsRoute, { path: '/payments' })
    await screen.findByText('Toko Online')

    expect(signOf('Toko Online')).toBe('-')
  })

  it('reads a refund as money in for the owner', async () => {
    stubHistory([txn({ type: 'refund' })])

    await renderRoute(paymentsRoute, { path: '/payments' })
    await screen.findByText('Toko Online')

    expect(signOf('Toko Online')).toBe('+')
  })

  /** Transaction types and statuses are database enums the client can lag. */
  it('still labels and styles a type and status it does not recognise', async () => {
    stubHistory([txn({ type: 'chargeback_fee', status: 'reversed' })])

    await renderRoute(paymentsRoute, { path: '/payments' })

    const row = (await screen.findByText('Toko Online')).closest('tr') as HTMLElement
    // No translation for either, so both fall back to the humanised raw value.
    expect(within(row).getByText('chargeback fee')).toBeDefined()
    expect(within(row).getByText('reversed')).toBeDefined()
  })

  it('narrows the request to the chosen transaction type', async () => {
    const user = userEvent.setup()
    stubHistory([txn()])
    await renderRoute(paymentsRoute, { path: '/payments' })
    await screen.findByText('Toko Online')

    await user.click(screen.getByRole('button', { name: /escrow in/i }))

    await waitFor(() =>
      expect(apiFetch.mock.calls.some((c) => String(c[0]).includes('type=escrow_in'))).toBe(true),
    )
  })

  it('drops the type parameter again on All', async () => {
    const user = userEvent.setup()
    stubHistory([txn()])
    await renderRoute(paymentsRoute, { path: '/payments' })
    await screen.findByText('Toko Online')
    await user.click(screen.getByRole('button', { name: /escrow in/i }))
    await waitFor(() =>
      expect(apiFetch.mock.calls.some((c) => String(c[0]).includes('type='))).toBe(true),
    )
    apiFetch.mockClear()

    await user.click(screen.getByRole('button', { name: 'All Types' }))

    await waitFor(() => expect(apiFetch.mock.calls.length).toBeGreaterThan(0))
    expect(
      apiFetch.mock.calls
        .filter((c) => String(c[0]).includes('/payments/list'))
        .every((c) => !String(c[0]).includes('type=')),
    ).toBe(true)
  })

  it('refetches the history from the retry control', async () => {
    const user = userEvent.setup()
    apiFetch.mockRejectedValue(new ApiError('boom', 500, 'INTERNAL_ERROR'))
    await renderRoute(paymentsRoute, { path: '/payments' })
    await screen.findByRole('button', { name: /try again/i })

    stubHistory([txn()])
    await user.click(screen.getByRole('button', { name: /try again/i }))

    expect(await screen.findByText('Toko Online')).toBeDefined()
  })
})

describe('the notification centre in detail', () => {
  function notif(over: Record<string, unknown> = {}) {
    return {
      id: 'n1',
      type: 'system',
      title: 'Welcome',
      message: 'hi',
      link: null,
      isRead: false,
      createdAt: new Date().toISOString(),
      ...over,
    }
  }

  function stubList(items: unknown[]) {
    apiFetch.mockImplementation(async (url: string) => {
      if (String(url).includes('read')) return { success: true, data: null }
      return { success: true, data: { items, total: items.length } }
    })
  }

  it.each([
    ['Projects', 'project_match'],
    ['System', 'system,dispute'],
  ])('asks for the %s slice of types', async (label, expected) => {
    const user = userEvent.setup()
    stubList([])
    await renderRoute(notificationsRoute, { path: '/notifications' })
    await screen.findByText('No Notifications Yet')

    await user.click(screen.getByRole('button', { name: label }))

    await waitFor(() => {
      const urls = apiFetch.mock.calls.map((c) => String(c[0]))
      expect(
        urls.some((u) => u.includes(encodeURIComponent(expected)) || u.includes(expected)),
      ).toBe(true)
    })
  })

  it('sends no type parameter back on All', async () => {
    const user = userEvent.setup()
    stubList([])
    await renderRoute(notificationsRoute, { path: '/notifications' })
    await screen.findByText('No Notifications Yet')
    await user.click(screen.getByRole('button', { name: 'Payments' }))
    await waitFor(() =>
      expect(apiFetch.mock.calls.some((c) => String(c[0]).includes('type='))).toBe(true),
    )
    apiFetch.mockClear()

    await user.click(screen.getByRole('button', { name: 'All' }))

    await waitFor(() => expect(apiFetch.mock.calls.length).toBeGreaterThan(0))
    expect(apiFetch.mock.calls.every((c) => !String(c[0]).includes('type='))).toBe(true)
  })

  it('marks the whole list read from the bulk control', async () => {
    const user = userEvent.setup()
    stubList([notif()])
    await renderRoute(notificationsRoute, { path: '/notifications' })
    await screen.findByText('Welcome')

    await user.click(screen.getByRole('button', { name: /mark all as read/i }))

    await waitFor(() => {
      const calls = apiFetch.mock.calls.map((c) => String(c[0]))
      expect(calls.some((u) => u.includes('read-all') || u.includes('read'))).toBe(true)
    })
  })

  /** The badge is a count, and three digits would break the pill. */
  it('caps the unread badge at 99+', async () => {
    stubList(Array.from({ length: 120 }, (_, i) => notif({ id: `n${i}` })))
    await renderRoute(notificationsRoute, { path: '/notifications' })

    expect(await screen.findByText('99+')).toBeDefined()
  })

  it('shows the exact unread count below the cap', async () => {
    stubList(Array.from({ length: 3 }, (_, i) => notif({ id: `n${i}` })))
    await renderRoute(notificationsRoute, { path: '/notifications' })

    await screen.findAllByText('Welcome')
    expect(screen.getByText('3')).toBeDefined()
  })

  it('follows the deep link of a notification that carries one', async () => {
    const user = userEvent.setup()
    stubList([notif({ link: '/projects', title: 'Project updated' })])
    const { router } = await renderRoute(notificationsRoute, {
      path: '/notifications',
      destinations: ['/projects'],
    })

    await user.click(await screen.findByRole('button', { name: /Project updated/ }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects'))
    expect(screen.queryByText(/view details/i)).toBeNull()
  })

  it('offers a details affordance only when there is somewhere to go', async () => {
    stubList([notif({ link: '/projects', title: 'Linked' }), notif({ id: 'n2', title: 'Bare' })])
    await renderRoute(notificationsRoute, {
      path: '/notifications',
      destinations: ['/projects'],
    })

    const linked = await screen.findByRole('button', { name: /Linked/ })
    expect(within(linked).getByText('View Details')).toBeDefined()
    expect(
      within(screen.getByRole('button', { name: /Bare/ })).queryByText('View Details'),
    ).toBeNull()
  })

  /** A type the client does not know must still render an icon. */
  it('falls back to a bell for an unrecognised notification type', async () => {
    stubList([notif({ type: 'talent_placement', title: 'Placement offer' })])
    const { container } = await renderRoute(notificationsRoute, { path: '/notifications' })

    await screen.findByText('Placement offer')
    expect(container.querySelector('.lucide-bell')).not.toBeNull()
  })

  it.each([
    [30 * 1000, 'just now'],
    [5 * 60 * 1000, '5m'],
    [3 * 60 * 60 * 1000, '3h'],
    [2 * 24 * 60 * 60 * 1000, '2d'],
  ])('writes an age of %s ms as %s', async (ago, expected) => {
    stubList([notif({ createdAt: new Date(Date.now() - ago).toISOString() })])
    await renderRoute(notificationsRoute, { path: '/notifications' })

    expect(await screen.findByText(expected)).toBeDefined()
  })

  it('falls back to a calendar date once a week has passed', async () => {
    stubList([notif({ createdAt: '2026-01-15T00:00:00.000Z' })])
    await renderRoute(notificationsRoute, { path: '/notifications' })

    await screen.findByText('Welcome')
    expect(screen.getByText(/15 Jan/)).toBeDefined()
  })
})

describe('the messages list', () => {
  it('shows the empty state before any conversation exists', async () => {
    apiFetch.mockResolvedValue({ success: true, data: [] })

    await renderRoute(messagesRoute, { path: '/messages' })

    expect(await screen.findByText('No messages yet')).toBeDefined()
  })

  it('reports a failed load rather than an empty inbox', async () => {
    apiFetch.mockRejectedValue(new ApiError('boom', 500, 'INTERNAL_ERROR'))

    const { container } = await renderRoute(messagesRoute, { path: '/messages' })

    await waitFor(() => expect(container.textContent).not.toContain('No messages yet'))
    expect(container.textContent).toMatch(/try again|failed|error/i)
  })

  it('gives the search box an accessible name', async () => {
    apiFetch.mockResolvedValue({ success: true, data: [] })

    await renderRoute(messagesRoute, { path: '/messages' })

    await screen.findByText('No messages yet')
    expect(screen.getByPlaceholderText(/search conversations/i)).toBeDefined()
  })
})

/**
 * The populated inbox.
 *
 * Everything below the empty state was unreachable in tests: the row, the two
 * filters and the retry. A conversation the user cannot open is the whole
 * feature failing, and it looks identical to an empty inbox from outside.
 */
describe('the messages list with conversations', () => {
  const THREAD = {
    id: 'c-1',
    projectId: 'p-abcdefgh-1111',
    type: 'owner_talent',
    createdAt: '2026-08-01T00:00:00.000Z',
  }
  const MEDIATION = {
    id: 'c-2',
    projectId: 'p-zzzzzzzz-2222',
    type: 'admin_mediation',
    createdAt: '2026-08-02T00:00:00.000Z',
  }

  it('links each conversation to its own thread', async () => {
    apiFetch.mockResolvedValue({ success: true, data: [THREAD] })

    await renderRoute(messagesRoute, {
      path: '/messages',
      destinations: ['/messages/$conversationId'],
    })

    const row = await screen.findByRole('link', { name: /p-abcdef/i })
    expect(row.getAttribute('href')).toBe('/messages/c-1')
    expect(within(row).getByText('2 participants')).toBeDefined()
  })

  /** The name is derived from the project id, so a conversation without one
   *  still needs a label rather than "Project undefined". */
  it('numbers a conversation that carries no project', async () => {
    apiFetch.mockResolvedValue({
      success: true,
      data: [{ ...THREAD, projectId: '' }],
    })

    await renderRoute(messagesRoute, {
      path: '/messages',
      destinations: ['/messages/$conversationId'],
    })

    expect(await screen.findByRole('link', { name: /Conversation 1/ })).toBeDefined()
  })

  it('sorts a mediation thread under Support and the rest under Projects', async () => {
    const user = userEvent.setup()
    apiFetch.mockResolvedValue({ success: true, data: [THREAD, MEDIATION] })

    await renderRoute(messagesRoute, {
      path: '/messages',
      destinations: ['/messages/$conversationId'],
    })
    await screen.findByRole('link', { name: /p-abcdef/i })

    await user.click(screen.getByRole('button', { name: 'Support' }))
    expect(screen.getByRole('link', { name: /p-zzzzzz/i })).toBeDefined()
    expect(screen.queryByRole('link', { name: /p-abcdef/i })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Projects' }))
    expect(screen.getByRole('link', { name: /p-abcdef/i })).toBeDefined()
    expect(screen.queryByRole('link', { name: /p-zzzzzz/i })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'All' }))
    expect(screen.getAllByRole('link')).toHaveLength(2)
  })

  it('narrows the list as the user types and says so when nothing matches', async () => {
    const user = userEvent.setup()
    apiFetch.mockResolvedValue({ success: true, data: [THREAD, MEDIATION] })

    await renderRoute(messagesRoute, {
      path: '/messages',
      destinations: ['/messages/$conversationId'],
    })
    await screen.findByRole('link', { name: /p-abcdef/i })
    const search = screen.getByPlaceholderText(/search conversations/i)

    await user.type(search, 'ZZZZ')

    expect(screen.getByRole('link', { name: /p-zzzzzz/i })).toBeDefined()
    expect(screen.queryByRole('link', { name: /p-abcdef/i })).toBeNull()

    await user.clear(search)
    await user.type(search, 'nothing like this')
    expect(await screen.findByText('No messages yet')).toBeDefined()
  })

  it('refetches from the retry control after a failed load', async () => {
    const user = userEvent.setup()
    apiFetch.mockRejectedValue(new ApiError('boom', 500, 'INTERNAL_ERROR'))

    await renderRoute(messagesRoute, {
      path: '/messages',
      destinations: ['/messages/$conversationId'],
    })
    await screen.findByRole('button', { name: /try again/i })

    apiFetch.mockResolvedValue({ success: true, data: [THREAD] })
    await user.click(screen.getByRole('button', { name: /try again/i }))

    expect(await screen.findByRole('link', { name: /p-abcdef/i })).toBeDefined()
  })

  /** A timestamp the server sent malformed must not take the row down with it. */
  it('leaves the timestamp blank rather than throwing on an unparseable date', async () => {
    apiFetch.mockResolvedValue({
      success: true,
      data: [{ ...THREAD, createdAt: 'not-a-date' }],
    })

    await renderRoute(messagesRoute, {
      path: '/messages',
      destinations: ['/messages/$conversationId'],
    })

    const row = await screen.findByRole('link', { name: /p-abcdef/i })
    expect(row.textContent).not.toMatch(/invalid|nan/i)
  })

  /** Avatar colours cycle so adjacent rows stay distinguishable. */
  it('gives the sixth conversation the first colour again', async () => {
    apiFetch.mockResolvedValue({
      success: true,
      data: Array.from({ length: 6 }, (_, i) => ({
        ...THREAD,
        id: `c-${i}`,
        projectId: `p-${i}0000000-0000`,
      })),
    })

    const { container } = await renderRoute(messagesRoute, {
      path: '/messages',
      destinations: ['/messages/$conversationId'],
    })
    await screen.findByRole('link', { name: /p-00000/i })

    const avatars = container.querySelectorAll('.rounded-full.text-sm')
    expect(avatars[0].className).toContain('bg-success-500')
    expect(avatars[5].className).toContain('bg-success-500')
  })
})
