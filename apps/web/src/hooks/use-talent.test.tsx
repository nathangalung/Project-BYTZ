// @vitest-environment jsdom
import type { QueryClient } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestQueryClient, withQueryClient } from '@/lib/testing/harness'
import { ApiError } from '../lib/api'
import {
  useApplyToProject,
  useAvailableProjects,
  useMyOffers,
  useRespondToOffer,
  useTalentActiveProjects,
  useTalentApplications,
  useTalentHoursLogged,
  useTalentProfile,
  useUpdateAvailability,
  useUploadPresignedUrl,
} from './use-talent'

const apiFetch = vi.hoisted(() => vi.fn())
vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api')
  return { ...actual, apiFetch }
})

let client: QueryClient

beforeEach(() => {
  apiFetch.mockReset()
  client = createTestQueryClient()
})

function renderWith<T>(hook: () => T) {
  return renderHook(hook, { wrapper: withQueryClient(client) })
}

describe('useAvailableProjects', () => {
  it('flattens the required skills the card renders out of preferences', async () => {
    apiFetch.mockResolvedValue({
      success: true,
      data: {
        items: [{ id: 'p1', title: 'Toko', preferences: { requiredSkills: ['React', 'Go'] } }],
        total: 1,
      },
    })

    const { result } = renderWith(() => useAvailableProjects())

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.items[0].skills).toEqual(['React', 'Go'])
  })

  /** A project with no stated preference must still render, with no chips. */
  it('gives a project with no preferences an empty skill list', async () => {
    apiFetch.mockResolvedValue({
      success: true,
      data: { items: [{ id: 'p1', title: 'Toko', preferences: null }], total: 1 },
    })

    const { result } = renderWith(() => useAvailableProjects())

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.items[0].skills).toEqual([])
  })

  it('sends the category and page filters as query parameters', async () => {
    apiFetch.mockResolvedValue({ success: true, data: { items: [], total: 0 } })

    const { result } = renderWith(() => useAvailableProjects({ category: 'web_app', page: 2 }))

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const [url] = apiFetch.mock.calls[0]
    expect(url).toContain('page=2')
    expect(url).toContain('category=web_app')
  })

  it('omits the query string entirely when no filter is set', async () => {
    apiFetch.mockResolvedValue({ success: true, data: { items: [], total: 0 } })

    const { result } = renderWith(() => useAvailableProjects())

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(apiFetch.mock.calls[0][0]).toBe('/api/v1/projects/available')
  })
})

/**
 * Two services answer these paths and only one wraps its body in an envelope,
 * so the unwrap has to cope with both or half the talent dashboard renders
 * `undefined`.
 */
describe('response envelope handling', () => {
  it('unwraps a { success, data } body', async () => {
    apiFetch.mockResolvedValue({ success: true, data: [{ id: 'a1', status: 'pending' }] })

    const { result } = renderWith(() => useTalentApplications('t1'))

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([{ id: 'a1', status: 'pending' }])
  })

  it('passes a bare array through untouched', async () => {
    apiFetch.mockResolvedValue([{ id: 'a1', status: 'pending' }])

    const { result } = renderWith(() => useTalentApplications('t1'))

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([{ id: 'a1', status: 'pending' }])
  })

  it('does not fetch applications before a talent id is known', () => {
    renderWith(() => useTalentApplications(''))

    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('does not fetch a profile before a user id is known', () => {
    renderWith(() => useTalentProfile(''))

    expect(apiFetch).not.toHaveBeenCalled()
  })
})

describe('useTalentHoursLogged', () => {
  it('totals the logged minutes into whole hours', async () => {
    apiFetch.mockResolvedValue({
      success: true,
      data: [{ durationMinutes: 90 }, { durationMinutes: 45 }, { durationMinutes: 45 }],
    })

    const { result } = renderWith(() => useTalentHoursLogged('t1'))

    await waitFor(() => expect(result.current.data).toBe(3))
  })

  /** A running timer has no end yet, so its row carries a null duration. */
  it('skips entries with no recorded duration', async () => {
    apiFetch.mockResolvedValue({
      success: true,
      data: [{ durationMinutes: 60 }, { durationMinutes: null }],
    })

    const { result } = renderWith(() => useTalentHoursLogged('t1'))

    await waitFor(() => expect(result.current.data).toBe(1))
  })

  it('reports zero rather than NaN when the endpoint answers with nothing', async () => {
    apiFetch.mockResolvedValue({ success: true, data: null })

    const { result } = renderWith(() => useTalentHoursLogged('t1'))

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toBe(0)
  })
})

describe('useMyOffers', () => {
  it('starts from an empty list so the dashboard renders before the fetch lands', () => {
    apiFetch.mockReturnValue(new Promise(() => {}))

    const { result } = renderWith(() => useMyOffers())

    expect(result.current.data).toEqual([])
  })

  it('returns the offers the matching service issued', async () => {
    apiFetch.mockResolvedValue({
      success: true,
      data: [{ assignmentId: 'a1', projectTitle: 'Toko', payout: 5_000_000 }],
    })

    const { result } = renderWith(() => useMyOffers())

    await waitFor(() => expect(result.current.data).toHaveLength(1))
    expect(result.current.data?.[0].payout).toBe(5_000_000)
  })
})

/**
 * The offer list is what put the Accept button on screen. When the server
 * says the assignment is no longer answerable, the cached row is stale: the
 * fix is to refetch and let the offer disappear, not to leave a button that
 * fails on every press. A failure for any other reason is transient and the
 * offer must survive it.
 */
describe('useRespondToOffer error handling', () => {
  function trackInvalidations() {
    const keys: unknown[] = []
    vi.spyOn(client, 'invalidateQueries').mockImplementation((filters) => {
      keys.push(filters?.queryKey)
      return Promise.resolve()
    })
    return keys
  }

  it('accepting refreshes both the offer list and the active project list', async () => {
    apiFetch.mockResolvedValue({ success: true, data: null })
    const keys = trackInvalidations()

    const { result } = renderWith(() => useRespondToOffer())
    result.current.mutate({ assignmentId: 'a1', action: 'accept' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(keys).toContainEqual(['my-offers'])
    expect(keys).toContainEqual(['talent-active-projects'])
    expect(apiFetch).toHaveBeenCalledWith('/api/v1/matching/assignments/a1/accept', {
      method: 'POST',
    })
  })

  it('declining posts to the decline endpoint', async () => {
    apiFetch.mockResolvedValue({ success: true, data: null })

    const { result } = renderWith(() => useRespondToOffer())
    result.current.mutate({ assignmentId: 'a1', action: 'decline' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(apiFetch).toHaveBeenCalledWith('/api/v1/matching/assignments/a1/decline', {
      method: 'POST',
    })
  })

  it('refetches the offers when the server loses a race and answers 409', async () => {
    apiFetch.mockRejectedValue(new ApiError('conflict', 409, 'PROJECT_CONFLICT'))
    const keys = trackInvalidations()

    const { result } = renderWith(() => useRespondToOffer())
    result.current.mutate({ assignmentId: 'a1', action: 'accept' })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(keys).toContainEqual(['my-offers'])
  })

  /** The commoner stale case: the pre-check rejects before the race happens. */
  it('refetches the offers on MATCHING_INVALID_ASSIGNMENT whatever the status', async () => {
    apiFetch.mockRejectedValue(new ApiError('gone', 400, 'MATCHING_INVALID_ASSIGNMENT'))
    const keys = trackInvalidations()

    const { result } = renderWith(() => useRespondToOffer())
    result.current.mutate({ assignmentId: 'a1', action: 'accept' })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(keys).toContainEqual(['my-offers'])
  })

  it('leaves the offer in place when the failure was transient', async () => {
    apiFetch.mockRejectedValue(new ApiError('boom', 500, 'INTERNAL_ERROR'))
    const keys = trackInvalidations()

    const { result } = renderWith(() => useRespondToOffer())
    result.current.mutate({ assignmentId: 'a1', action: 'accept' })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(keys).toEqual([])
  })

  it('leaves the offer in place when the network drops', async () => {
    apiFetch.mockRejectedValue(new TypeError('Failed to fetch'))
    const keys = trackInvalidations()

    const { result } = renderWith(() => useRespondToOffer())
    result.current.mutate({ assignmentId: 'a1', action: 'accept' })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(keys).toEqual([])
  })
})

describe('talent mutations refresh what they changed', () => {
  it('applying refreshes the application list', async () => {
    apiFetch.mockResolvedValue({ success: true, data: null })
    const spy = vi.spyOn(client, 'invalidateQueries')

    const { result } = renderWith(() => useApplyToProject())
    result.current.mutate({ projectId: 'p1', talentId: 't1', coverNote: 'hi' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(spy).toHaveBeenCalledWith({ queryKey: ['talent-applications'] })
  })

  it('changing availability refreshes the profile', async () => {
    apiFetch.mockResolvedValue({ success: true, data: null })
    const spy = vi.spyOn(client, 'invalidateQueries')

    const { result } = renderWith(() => useUpdateAvailability())
    result.current.mutate({ profileId: 't1', availability: 'busy' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(spy).toHaveBeenCalledWith({ queryKey: ['talent-profile'] })
    expect(apiFetch).toHaveBeenCalledWith('/api/v1/talent-profiles/t1/availability', {
      method: 'PATCH',
      body: JSON.stringify({ availability: 'busy' }),
    })
  })

  it('the presigned upload returns the URL the browser will PUT to', async () => {
    apiFetch.mockResolvedValue({
      success: true,
      data: { url: 'https://storage.example/put', key: 'cv/1.pdf', token: 'tok' },
    })

    const { result } = renderWith(() => useUploadPresignedUrl())
    result.current.mutate({ fileName: 'cv.pdf', fileType: 'application/pdf', folder: 'cv' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toMatchObject({ url: 'https://storage.example/put' })
  })
})

describe('useTalentActiveProjects', () => {
  it('renders from an empty list while the request is in flight', () => {
    apiFetch.mockReturnValue(new Promise(() => {}))

    const { result } = renderWith(() => useTalentActiveProjects('t1'))

    expect(result.current.data).toEqual([])
  })

  it('does not fire without a talent id', () => {
    renderWith(() => useTalentActiveProjects(''))

    expect(apiFetch).not.toHaveBeenCalled()
  })
})
