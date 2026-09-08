// @vitest-environment jsdom
import type { QueryClient } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { Component, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestQueryClient, withQueryClient } from '@/lib/testing/harness'
import { ApiError } from '../lib/api'
import {
  useMarkAllRead,
  useMarkRead,
  useNotificationRealtime,
  useNotifications,
  useUnreadCount,
} from './use-notifications'

const apiFetch = vi.hoisted(() => vi.fn())
vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api')
  return { ...actual, apiFetch }
})

const connectCentrifugo = vi.hoisted(() => vi.fn())
const unsubscribe = vi.hoisted(() => vi.fn())
const subscribeTo = vi.hoisted(() => vi.fn())
vi.mock('../lib/centrifugo', () => ({ connectCentrifugo, subscribeTo }))

let client: QueryClient

beforeEach(() => {
  vi.clearAllMocks()
  subscribeTo.mockReturnValue(unsubscribe)
  client = createTestQueryClient()
})

function renderWith<T>(hook: () => T) {
  return renderHook(hook, { wrapper: withQueryClient(client) })
}

/** Stands in for the route boundary so a rethrown query is observable. */
class Boundary extends Component<
  { children: ReactNode; onCatch: (error: unknown) => void },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: unknown) {
    this.props.onCatch(error)
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

describe('useNotifications', () => {
  it('returns the page the service answered with', async () => {
    apiFetch.mockResolvedValue({
      success: true,
      data: { items: [{ id: 'n1', title: 'BRD ready' }], total: 1, page: 1, pageSize: 20 },
    })

    const { result } = renderWith(() => useNotifications())

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.items).toHaveLength(1)
  })

  it('asks for the requested page at the fixed page size', async () => {
    apiFetch.mockResolvedValue({ success: true, data: { items: [], total: 0 } })

    const { result } = renderWith(() => useNotifications(3))

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(apiFetch.mock.calls[0][0]).toBe('/api/v1/notifications?page=3&pageSize=20')
  })

  it('sends a type filter when one is chosen', async () => {
    apiFetch.mockResolvedValue({ success: true, data: { items: [], total: 0 } })

    const { result } = renderWith(() => useNotifications(1, 'payment'))

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(apiFetch.mock.calls[0][0]).toContain('type=payment')
  })

  /** "All" is the absence of a filter, not a type the API knows. */
  it('sends no type filter for the all tab', async () => {
    apiFetch.mockResolvedValue({ success: true, data: { items: [], total: 0 } })

    const { result } = renderWith(() => useNotifications(1, 'all'))

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(apiFetch.mock.calls[0][0]).not.toContain('type=')
  })
})

/**
 * The bell polls every two minutes on every authenticated page, and
 * `useUnreadCount` is mounted in the _authenticated layout - so anything it
 * throws replaces the page the user was working on, whatever that page was.
 *
 * These used to raise a 500 and a 502 to the route boundary on purpose,
 * reasoning that a server error is a real defect worth surfacing. Measured in a
 * browser against a stack with notification-service down: the owner's dashboard
 * rendered "Something went wrong", their four projects nowhere on it, because
 * the bell asked for a count and did not get one. The count is peripheral. No
 * badge is absent; a blank dashboard is wrong.
 */
describe('polling failures that must not take the page down', () => {
  it.each([
    ['a dropped connection', new TypeError('Failed to fetch')],
    ['a 404 from the notification service', new ApiError('gone', 404, 'NOT_FOUND')],
    ['an expired session', new ApiError('expired', 401, 'AUTH_SESSION_EXPIRED')],
    ['a server error', new ApiError('boom', 500, 'INTERNAL_ERROR')],
    ['a dead upstream', new ApiError('bad gateway', 502, 'SERVICE_UNAVAILABLE')],
  ])('reports %s to the caller rather than throwing', async (_label, error) => {
    apiFetch.mockRejectedValue(error)

    const { result } = renderWith(() => useNotifications())

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toBe(error)
  })

  /**
   * The assertion that would have caught it: nothing reaches the boundary.
   *
   * This replaces a grep in error-messages.test.ts that asserted the source
   * contained `error.status === 404`. That guarded a selective swallow which no
   * longer exists, and a text match could never have said what this says.
   */
  it('never reaches the route error boundary', async () => {
    apiFetch.mockRejectedValue(new ApiError('bad gateway', 502, 'SERVICE_UNAVAILABLE'))
    const caught: unknown[] = []

    const { result } = renderHook(() => useUnreadCount(), {
      wrapper: ({ children }) => (
        <Boundary onCatch={(e) => caught.push(e)}>{withQueryClient(client)({ children })}</Boundary>
      ),
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(caught).toEqual([])
  })

  /**
   * A count that could not be read is absent, not a fabricated zero: the
   * placeholder only stands in while the first request is still running.
   * TopBar defaults it to 0 at the call site, so the badge does not render.
   */
  it('applies the same rule to the unread count', async () => {
    apiFetch.mockRejectedValue(new ApiError('bad gateway', 502, 'SERVICE_UNAVAILABLE'))

    const { result } = renderWith(() => useUnreadCount())

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.data).toBeUndefined()
  })
})

describe('useUnreadCount', () => {
  it('shows zero before the first response so the badge never renders NaN', () => {
    apiFetch.mockReturnValue(new Promise(() => {}))

    const { result } = renderWith(() => useUnreadCount())

    expect(result.current.data).toBe(0)
  })

  it('reports the count the service returned', async () => {
    apiFetch.mockResolvedValue({ success: true, data: { count: 7 } })

    const { result } = renderWith(() => useUnreadCount())

    await waitFor(() => expect(result.current.data).toBe(7))
  })

  it('reads a malformed body as zero', async () => {
    apiFetch.mockResolvedValue({ success: true, data: null })

    const { result } = renderWith(() => useUnreadCount())

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toBe(0)
  })
})

describe('marking notifications read', () => {
  it('refreshes the list and the badge after marking one read', async () => {
    apiFetch.mockResolvedValue({ success: true })
    const spy = vi.spyOn(client, 'invalidateQueries')

    const { result } = renderWith(() => useMarkRead())
    result.current.mutate('n1')

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(apiFetch).toHaveBeenCalledWith('/api/v1/notifications/n1/read', { method: 'PATCH' })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['notifications'] })
  })

  it('refreshes after marking all read', async () => {
    apiFetch.mockResolvedValue({ success: true })
    const spy = vi.spyOn(client, 'invalidateQueries')

    const { result } = renderWith(() => useMarkAllRead())
    result.current.mutate()

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(apiFetch).toHaveBeenCalledWith('/api/v1/notifications/read-all', { method: 'PATCH' })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['notifications'] })
  })
})

/**
 * The realtime channel is per user. Subscribing before the session resolves
 * would open `notifications#undefined`, and failing to unsubscribe on sign-out
 * leaves the previous account's channel feeding the next one.
 */
describe('useNotificationRealtime', () => {
  it('subscribes to the signed-in user own channel', () => {
    renderWith(() => useNotificationRealtime('u1'))

    expect(connectCentrifugo).toHaveBeenCalledTimes(1)
    expect(subscribeTo).toHaveBeenCalledWith('notifications#u1', expect.any(Function))
  })

  it('does not subscribe before the user is known', () => {
    renderWith(() => useNotificationRealtime(undefined))

    expect(subscribeTo).not.toHaveBeenCalled()
    expect(connectCentrifugo).not.toHaveBeenCalled()
  })

  it('a pushed notification refreshes the list', () => {
    renderWith(() => useNotificationRealtime('u1'))
    const spy = vi.spyOn(client, 'invalidateQueries')

    const onMessage = subscribeTo.mock.calls[0][1] as (data: unknown) => void
    onMessage({ id: 'n2' })

    expect(spy).toHaveBeenCalledWith({ queryKey: ['notifications'] })
  })

  it('drops the subscription when the component goes away', () => {
    const { unmount } = renderWith(() => useNotificationRealtime('u1'))

    unmount()

    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('resubscribes on the new channel when the user changes', () => {
    const { rerender } = renderHook(({ id }: { id: string }) => useNotificationRealtime(id), {
      wrapper: withQueryClient(client),
      initialProps: { id: 'u1' },
    })

    rerender({ id: 'u2' })

    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(subscribeTo).toHaveBeenLastCalledWith('notifications#u2', expect.any(Function))
  })
})
