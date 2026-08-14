// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react'
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
