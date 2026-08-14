// @vitest-environment jsdom
import type { QueryClient } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestQueryClient, withQueryClient } from '@/lib/testing/harness'
import { useToastStore } from '@/stores/toast'
import { ApiError } from '../lib/api'
import {
  useActivities,
  useConfirmMatching,
  useCreateDispute,
  useCreateProject,
  useGenerateBrd,
  useGeneratePrd,
  useProject,
  useProjectContracts,
  useProjectDisputes,
  useProjectInvoices,
  useProjectMilestones,
  useProjectReviews,
  useProjectStatusLogs,
  useProjects,
  useProjectTasks,
  useProjectTransactions,
  useSignContract,
  useSubmitReview,
  useTransitionProject,
  useUpdateMilestoneStatus,
  useUpdateProject,
} from './use-projects'

const apiFetch = vi.hoisted(() => vi.fn())
vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api')
  return { ...actual, apiFetch }
})

let client: QueryClient

beforeEach(() => {
  apiFetch.mockReset()
  apiFetch.mockResolvedValue({ success: true, data: null })
  client = createTestQueryClient()
  useToastStore.setState({ toasts: [] })
})

function renderWith<T>(hook: () => T) {
  return renderHook(hook, { wrapper: withQueryClient(client) })
}

/** Collect the keys a mutation asked to refresh. */
function trackInvalidations() {
  const keys: unknown[] = []
  vi.spyOn(client, 'invalidateQueries').mockImplementation((filters) => {
    keys.push(filters?.queryKey)
    return Promise.resolve()
  })
  return keys
}

describe('useProjects list filters', () => {
  it('requests the unfiltered list when given nothing', async () => {
    apiFetch.mockResolvedValue({ success: true, data: { items: [], total: 0 } })

    const { result } = renderWith(() => useProjects())

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(apiFetch).toHaveBeenCalledWith('/api/v1/projects')
  })

  it('carries every supplied filter into the query string', async () => {
    apiFetch.mockResolvedValue({ success: true, data: { items: [], total: 0 } })

    const { result } = renderWith(() =>
      useProjects({ status: 'in_progress', page: 2, pageSize: 10, ownerId: 'u1' }),
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const url = apiFetch.mock.calls[0][0] as string
    expect(url).toContain('status=in_progress')
    expect(url).toContain('page=2')
    expect(url).toContain('pageSize=10')
    expect(url).toContain('ownerId=u1')
  })
})

/**
 * These lists render as collections. A service that answers `{ data: null }` -
 * which the Go services do for an empty result - must arrive as an empty array
 * or the page crashes on `.map` instead of showing its empty state.
 */
describe('collection endpoints degrade to an empty list', () => {
  /** Widened because each entry returns a differently typed query result. */
  const collections: [string, () => { isSuccess: boolean; data: unknown }][] = [
    ['milestones', () => useProjectMilestones('p1')],
    ['status logs', () => useProjectStatusLogs('p1')],
    ['reviews', () => useProjectReviews('p1')],
    ['contracts', () => useProjectContracts('p1')],
    ['transactions', () => useProjectTransactions('p1')],
    ['invoices', () => useProjectInvoices('p1')],
    ['disputes', () => useProjectDisputes('p1')],
  ]

  it.each(collections)('%s', async (_label, hook) => {
    apiFetch.mockResolvedValue({ success: true, data: null })

    const { result } = renderWith(hook)

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([])
  })

  it('the gantt endpoint degrades to an empty chart, not undefined', async () => {
    apiFetch.mockResolvedValue({ success: true, data: null })

    const { result } = renderWith(() => useProjectTasks('p1'))

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual({ tasks: [], dependencies: [] })
  })
})

describe('queries gated on an id', () => {
  const gated: [string, () => unknown][] = [
    ['project', () => useProject('')],
    ['tasks', () => useProjectTasks('')],
    ['milestones', () => useProjectMilestones('')],
    ['reviews', () => useProjectReviews('')],
    ['contracts', () => useProjectContracts('')],
    ['transactions', () => useProjectTransactions('')],
    ['invoices', () => useProjectInvoices('')],
    ['disputes', () => useProjectDisputes('')],
  ]

  it.each(gated)('%s does not fire without one', (_label, hook) => {
    renderWith(hook)

    expect(apiFetch).not.toHaveBeenCalled()
  })

  /** Only the matching countdown reads the log, so callers can opt out. */
  it('status logs can be switched off by the caller even with an id', () => {
    renderWith(() => useProjectStatusLogs('p1', false))

    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('status logs fire when the caller opts in', async () => {
    const { result } = renderWith(() => useProjectStatusLogs('p1', true))

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(apiFetch).toHaveBeenCalledWith('/api/v1/projects/p1/status-logs')
  })
})

/**
 * Every mutation here changes something a currently mounted view is reading.
 * The key it invalidates is the contract between the two; getting it wrong
 * shows the user a stale page that only a manual reload fixes.
 */
describe('mutations refresh what they changed', () => {
  it('creating a project refreshes the project list', async () => {
    const keys = trackInvalidations()

    const { result } = renderWith(() => useCreateProject())
    result.current.mutate({ title: 'Toko' } as never)

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(keys).toContainEqual(['projects'])
  })

  it('a status transition refreshes both the detail and the list', async () => {
    const keys = trackInvalidations()

    const { result } = renderWith(() => useTransitionProject())
    result.current.mutate({ projectId: 'p1', status: 'brd_approved' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(keys).toContainEqual(['project', 'p1'])
    expect(keys).toContainEqual(['projects'])
  })

  /** Opening a dispute also flips the project to `disputed` server-side. */
  it('opening a dispute refreshes the project as well as its dispute list', async () => {
    const keys = trackInvalidations()

    const { result } = renderWith(() => useCreateDispute())
    result.current.mutate({ projectId: 'p1', againstUserId: 'u2', reason: 'late' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(keys).toContainEqual(['project', 'p1'])
    expect(keys).toContainEqual(['project-disputes', 'p1'])
  })

  it('a milestone status change refreshes the board and the project', async () => {
    const keys = trackInvalidations()

    const { result } = renderWith(() => useUpdateMilestoneStatus())
    result.current.mutate({ milestoneId: 'm1', status: 'approved', projectId: 'p1' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(keys).toContainEqual(['project-milestones', 'p1'])
    expect(keys).toContainEqual(['project', 'p1'])
    expect(apiFetch).toHaveBeenCalledWith('/api/v1/milestones/m1/status', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'approved', reason: undefined }),
    })
  })

  it('submitting a review refreshes the review list and the project', async () => {
    const keys = trackInvalidations()

    const { result } = renderWith(() => useSubmitReview())
    result.current.mutate({ projectId: 'p1', revieweeId: 'u2', rating: 5, type: 'owner_to_talent' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(keys).toContainEqual(['project-reviews', 'p1'])
  })

  it('signing a contract refreshes only that project contracts', async () => {
    const keys = trackInvalidations()

    const { result } = renderWith(() => useSignContract())
    result.current.mutate({ contractId: 'c1', projectId: 'p1' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(keys).toEqual([['project-contracts', 'p1']])
  })

  it('confirming the match refreshes the project detail', async () => {
    const keys = trackInvalidations()

    const { result } = renderWith(() => useConfirmMatching())
    result.current.mutate({
      projectId: 'p1',
      assignments: [{ workPackageId: 'wp1', talentId: 't1' }],
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(keys).toContainEqual(['project', 'p1'])
  })
})

describe('document generation', () => {
  it('defaults to Indonesian and refreshes the BRD view', async () => {
    const keys = trackInvalidations()

    const { result } = renderWith(() => useGenerateBrd())
    result.current.mutate({ projectId: 'p1' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(apiFetch).toHaveBeenCalledWith('/api/v1/projects/p1/generate-brd', {
      method: 'POST',
      body: JSON.stringify({ language: 'id' }),
    })
    expect(keys).toContainEqual(['project-brd', 'p1'])
  })

  it('passes an explicit language through', async () => {
    const { result } = renderWith(() => useGeneratePrd())
    result.current.mutate({ projectId: 'p1', language: 'en' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(apiFetch).toHaveBeenCalledWith('/api/v1/projects/p1/generate-prd', {
      method: 'POST',
      body: JSON.stringify({ language: 'en' }),
    })
  })

  it('refreshes the PRD view after generating', async () => {
    const keys = trackInvalidations()

    const { result } = renderWith(() => useGeneratePrd())
    result.current.mutate({ projectId: 'p1' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(keys).toContainEqual(['project-prd', 'p1'])
  })
})

/**
 * Visibility is edited inline with an optimistic-looking control. A rejected
 * PATCH used to revert the switch with nothing said, so the owner believed a
 * private project was public.
 */
describe('useUpdateProject failure', () => {
  it('raises a toast when the server rejects the edit', async () => {
    apiFetch.mockRejectedValue(new ApiError('Forbidden', 403, 'AUTH_FORBIDDEN'))

    const { result } = renderWith(() => useUpdateProject())
    result.current.mutate({ projectId: 'p1', visibility: 'private' })

    await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1))
    const [toast] = useToastStore.getState().toasts
    expect(toast.type).toBe('error')
    expect(toast.message).toBe('Forbidden')
  })

  it('raises a toast even when what was thrown is not an Error', async () => {
    apiFetch.mockRejectedValue('gateway said no')

    const { result } = renderWith(() => useUpdateProject())
    result.current.mutate({ projectId: 'p1', title: 'x' })

    await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1))
    expect(useToastStore.getState().toasts[0].message).toBe('Update failed')
  })

  it('says nothing and refreshes both views when the edit succeeds', async () => {
    const keys = trackInvalidations()

    const { result } = renderWith(() => useUpdateProject())
    result.current.mutate({ projectId: 'p1', visibility: 'public_detail' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(useToastStore.getState().toasts).toHaveLength(0)
    expect(keys).toContainEqual(['project', 'p1'])
    expect(keys).toContainEqual(['projects'])
  })
})

describe('useActivities', () => {
  it('asks for the default page size', async () => {
    apiFetch.mockResolvedValue({ success: true, data: { items: [], total: 0 } })

    const { result } = renderWith(() => useActivities())

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(apiFetch).toHaveBeenCalledWith('/api/v1/activities?limit=5')
  })

  it('honours an explicit limit', async () => {
    apiFetch.mockResolvedValue({ success: true, data: { items: [], total: 0 } })

    const { result } = renderWith(() => useActivities(25))

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(apiFetch).toHaveBeenCalledWith('/api/v1/activities?limit=25')
  })
})
