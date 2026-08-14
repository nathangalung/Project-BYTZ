// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAdminList } from './use-admin-list'

/**
 * Shared list state for users, projects and disputes: search debounce, server
 * filters and paging in one place.
 *
 * The page reset is the part worth pinning. Narrowing a result set invalidates
 * the page number, so a search typed while on page 3 has to go back to page 1
 * or the admin lands on an empty page of a smaller result set and reads it as
 * no matches.
 */

type Row = { id: string }

function stubFetch() {
  const spy = vi.fn(async (_url: string) => ({
    ok: true,
    status: 200,
    json: async () => ({
      success: true,
      data: { items: [{ id: 'u-1' }], total: 42, page: 1, pageSize: 100 },
    }),
  }))
  vi.stubGlobal('fetch', spy)
  return spy
}

function setup(options?: Partial<Parameters<typeof useAdminList>[0]>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderHook(
    () =>
      useAdminList<Row>({
        queryKey: 'admin-users',
        path: '/api/v1/admin/users',
        initialFilters: { role: '' },
        ...options,
      }),
    {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    },
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useAdminList initial state', () => {
  it('starts on page one with no search and the caller filters', () => {
    stubFetch()
    const { result } = setup()

    expect(result.current.page).toBe(1)
    expect(result.current.search).toBe('')
    expect(result.current.debouncedSearch).toBe('')
    expect(result.current.filters).toEqual({ role: '' })
    expect(result.current.pageSize).toBe(100)
  })

  it('reports an empty list rather than undefined before the query settles', () => {
    stubFetch()
    const { result } = setup()

    expect(result.current.items).toEqual([])
    expect(result.current.total).toBe(0)
  })

  it('unwraps items and the server total once loaded', async () => {
    stubFetch()
    const { result } = setup()

    await waitFor(() => expect(result.current.items).toHaveLength(1))
    expect(result.current.total).toBe(42)
  })

  it('honours a caller page size', () => {
    stubFetch()
    const { result } = setup({ pageSize: 50 })

    expect(result.current.pageSize).toBe(50)
  })

  it('omits empty filters from the query string', async () => {
    const spy = stubFetch()
    setup()

    await waitFor(() => expect(spy).toHaveBeenCalled())
    expect(spy.mock.calls[0][0]).toBe('/api/v1/admin/users?page=1&pageSize=100')
  })
})

describe('useAdminList search', () => {
  it('reflects the typed value immediately but holds the settled one back', () => {
    stubFetch()
    const { result } = setup()

    act(() => result.current.setSearch('budi'))

    expect(result.current.search).toBe('budi')
    expect(result.current.debouncedSearch).toBe('')
  })

  it('settles the search after the debounce and refetches with it', async () => {
    const spy = stubFetch()
    const { result } = setup()

    act(() => result.current.setSearch('budi'))

    await waitFor(() => expect(result.current.debouncedSearch).toBe('budi'))
    await waitFor(() =>
      expect(spy.mock.calls.some(([url]) => String(url).includes('search=budi'))).toBe(true),
    )
  })

  it('trims the settled value so a stray space is not sent as a filter', async () => {
    stubFetch()
    const { result } = setup()

    act(() => result.current.setSearch('  budi  '))

    await waitFor(() => expect(result.current.debouncedSearch).toBe('budi'))
  })

  /** Only the last keystroke of a burst should reach the server. */
  it('does not fire a request per keystroke', async () => {
    const spy = stubFetch()
    const { result } = setup()
    const before = spy.mock.calls.length

    act(() => result.current.setSearch('b'))
    act(() => result.current.setSearch('bu'))
    act(() => result.current.setSearch('bud'))

    await waitFor(() => expect(result.current.debouncedSearch).toBe('bud'))
    const searchCalls = spy.mock.calls.slice(before).filter(([u]) => String(u).includes('search='))
    expect(searchCalls).toHaveLength(1)
  })

  it('returns to page one when the search narrows the result set', () => {
    stubFetch()
    const { result } = setup()

    act(() => result.current.setPage(3))
    expect(result.current.page).toBe(3)

    act(() => result.current.setSearch('budi'))
    expect(result.current.page).toBe(1)
  })
})

describe('useAdminList filters', () => {
  it('merges a filter change into the existing filters', () => {
    stubFetch()
    const { result } = setup({ initialFilters: { role: '', status: 'open' } })

    act(() => result.current.setFilter('role', 'talent'))

    expect(result.current.filters).toEqual({ role: 'talent', status: 'open' })
  })

  it('returns to page one when a filter narrows the result set', () => {
    stubFetch()
    const { result } = setup()

    act(() => result.current.setPage(3))
    act(() => result.current.setFilter('role', 'owner'))

    expect(result.current.page).toBe(1)
  })

  it('sends the chosen filter to the server', async () => {
    const spy = stubFetch()
    const { result } = setup()

    act(() => result.current.setFilter('role', 'talent'))

    await waitFor(() =>
      expect(spy.mock.calls.some(([url]) => String(url).includes('role=talent'))).toBe(true),
    )
  })
})
