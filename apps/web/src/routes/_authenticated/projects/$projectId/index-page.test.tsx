// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { subscribeTo } from '@/lib/centrifugo'
import { renderRoute } from '@/lib/testing/harness'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'
import * as detailRoute from './index'

/**
 * The project's home, and the only place an owner can cancel it or open a
 * dispute - the two actions that freeze or refund escrow.
 *
 * Which of them a viewer is offered is decided by `role`, and this file had
 * never been executed by a test: it reported zero statements, so it sat
 * outside the coverage denominator rather than counted as uncovered.
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

const PROJECT = {
  id: 'p-1',
  title: 'Toko Online Batik',
  description: 'Marketplace batik untuk UMKM',
  category: 'web_app',
  status: 'in_progress',
  budgetMin: 5_000_000,
  budgetMax: 15_000_000,
  estimatedTimelineDays: 60,
  teamSize: 2,
  finalPrice: 12_000_000,
  visibility: 'public_summary',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-03-01T00:00:00.000Z',
  assignments: [{ workPackageId: 'wp-1', talentUserId: 'u-talent', roleLabel: 'Backend' }],
}

function stubApi(project: unknown = PROJECT) {
  apiFetch.mockImplementation(async (url: string) => {
    const path = String(url)
    if (path.includes('/milestones')) return { success: true, data: [] }
    if (path.includes('/status-logs')) return { success: true, data: [] }
    if (path.includes('/reviews')) return { success: true, data: [] }
    if (path.includes('/disputes')) return { success: true, data: [] }
    return { success: true, data: project }
  })
}

const OWNER = { id: 'u1', email: 'rina@kerjacus.id', name: 'Rina', role: 'owner', locale: 'id' }
const TALENT = { ...OWNER, id: 'u-talent', name: 'Ari', role: 'talent' }

function signIn(role: string | undefined) {
  useAuthStore.setState({
    user: (role === undefined
      ? { ...OWNER, role: undefined }
      : role === 'talent'
        ? TALENT
        : OWNER) as never,
    isAuthenticated: true,
    isLoading: false,
  })
}

function render() {
  return renderRoute(detailRoute, {
    path: '/projects/$projectId/',
    entry: '/projects/p-1',
    destinations: [
      '/projects',
      '/talent',
      '/projects/$projectId/scoping',
      '/projects/$projectId/brd',
      '/projects/$projectId/prd',
      '/projects/$projectId/matching',
      '/projects/$projectId/milestones',
      '/projects/$projectId/documents',
      '/projects/$projectId/time-tracking',
    ],
  })
}

function toastMessages() {
  return useToastStore.getState().toasts.map((toast) => toast.message)
}

beforeEach(() => {
  apiFetch.mockReset()
  stubApi()
  useToastStore.setState({ toasts: [] })
  signIn('owner')
})

describe('loading the project', () => {
  it('shows a spinner rather than an empty page while it loads', async () => {
    apiFetch.mockImplementation(() => new Promise(() => {}))

    const { container } = await render()

    expect(container.querySelector('.animate-spin')).not.toBeNull()
    expect(screen.queryByRole('heading', { name: 'Toko Online Batik' })).toBeNull()
  })

  it('says the project was not found and offers the owner the way back', async () => {
    stubApi(null)

    await render()

    expect(await screen.findByRole('heading', { name: 'Project not found' })).toBeDefined()
    expect(screen.getByRole('link', { name: 'Back' }).getAttribute('href')).toBe('/projects')
  })

  /** A talent has no owner project list to go back to. */
  it('sends a talent who hits a missing project to their own home', async () => {
    stubApi(null)
    signIn('talent')

    await render()

    expect(await screen.findByRole('heading', { name: 'Project not found' })).toBeDefined()
    expect(screen.getByRole('link', { name: 'Back' }).getAttribute('href')).toBe('/talent')
  })

  it('shows the title, category and status once it arrives', async () => {
    await render()

    expect(await screen.findByRole('heading', { name: 'Toko Online Batik' })).toBeDefined()
    expect(screen.getByText('Web App')).toBeDefined()
    expect(screen.getByText('In Progress')).toBeDefined()
  })
})

/**
 * Cancelling refunds unreleased escrow and opening a dispute freezes it. Both
 * belong to the owner alone.
 */
describe('the danger actions and who is offered them', () => {
  it('offers an owner both cancel and dispute on a running project', async () => {
    await render()

    expect(await screen.findByRole('button', { name: 'Cancel Project' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Open Dispute' })).toBeDefined()
  })

  it('withholds both from a talent', async () => {
    signIn('talent')

    await render()

    expect(await screen.findByRole('heading', { name: 'Toko Online Batik' })).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Cancel Project' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Open Dispute' })).toBeNull()
  })

  /**
   * The gate is `role !== 'talent'`, so it fails open. Before the auth store
   * hydrates, `role` is undefined and the viewer is handed the full owner
   * toolbar. This records what the page does today; it is a finding, not the
   * behaviour anyone asked for. milestones.tsx gates the same kind of control
   * with `role === 'owner'` and fails closed instead.
   */
  it('hands the owner toolbar to a viewer whose role has not loaded yet', async () => {
    signIn(undefined)

    await render()

    expect(await screen.findByRole('button', { name: 'Cancel Project' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Open Dispute' })).toBeDefined()
    expect(screen.getByRole('combobox')).toBeDefined()
  })

  it('offers no dispute before the work has started', async () => {
    stubApi({ ...PROJECT, status: 'brd_approved' })

    await render()

    expect(await screen.findByRole('button', { name: 'Cancel Project' })).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Open Dispute' })).toBeNull()
  })

  it('offers neither once the project is finished', async () => {
    stubApi({ ...PROJECT, status: 'completed' })

    await render()

    expect(await screen.findByRole('heading', { name: 'Toko Online Batik' })).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Cancel Project' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Open Dispute' })).toBeNull()
  })
})

describe('cancelling the project', () => {
  async function openCancel() {
    const user = userEvent.setup()
    await render()
    await user.click(await screen.findByRole('button', { name: 'Cancel Project' }))
    const heading = await screen.findByRole('heading', { level: 3, name: 'Cancel Project' })
    return { user, dialog: within(heading.parentElement as HTMLElement) }
  }

  it('warns what cancelling costs before doing it', async () => {
    const { dialog } = await openCancel()

    expect(dialog.getByText(/Escrow that has not been released is refunded/)).toBeDefined()
    expect(apiFetch).not.toHaveBeenCalledWith('/api/v1/projects/p-1/transition', expect.anything())
  })

  it('cancels the project when confirmed', async () => {
    const { user, dialog } = await openCancel()

    await user.click(dialog.getByRole('button', { name: 'Cancel Project' }))

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        '/api/v1/projects/p-1/transition',
        expect.objectContaining({ body: JSON.stringify({ status: 'cancelled' }) }),
      ),
    )
    expect(toastMessages()).toContain('Cancelled')
  })

  it('cancels nothing when the owner backs out', async () => {
    const { user, dialog } = await openCancel()

    await user.click(dialog.getByRole('button', { name: 'Cancel' }))

    await waitFor(() =>
      expect(screen.queryByRole('heading', { level: 3, name: 'Cancel Project' })).toBeNull(),
    )
    expect(apiFetch).not.toHaveBeenCalledWith('/api/v1/projects/p-1/transition', expect.anything())
  })

  it('reports a refused cancellation', async () => {
    apiFetch.mockImplementation(async (url: string) => {
      const path = String(url)
      if (path.includes('/transition')) throw new Error('milestone already released')
      if (path.includes('/milestones')) return { success: true, data: [] }
      if (path.includes('/status-logs')) return { success: true, data: [] }
      return { success: true, data: PROJECT }
    })
    const { user, dialog } = await openCancel()

    await user.click(dialog.getByRole('button', { name: 'Cancel Project' }))

    await waitFor(() => expect(toastMessages()).toContain('milestone already released'))
  })

  /**
   * Cancelling moves escrow. A rejection with no `.message` — an aborted
   * request, a proxy answering a bare string — must still say something, or
   * the owner is left unable to tell whether the project was cancelled.
   */
  it('names a refused cancellation that carries no message', async () => {
    apiFetch.mockImplementation(async (url: string) => {
      const path = String(url)
      if (path.includes('/transition')) throw 'socket hang up'
      if (path.includes('/milestones')) return { success: true, data: [] }
      if (path.includes('/status-logs')) return { success: true, data: [] }
      return { success: true, data: PROJECT }
    })
    const { user, dialog } = await openCancel()

    await user.click(dialog.getByRole('button', { name: 'Cancel Project' }))

    await waitFor(() => expect(toastMessages()).toContain('Something went wrong'))
  })
})

/**
 * Project status changes arrive over Centrifugo too: an admin resolving a
 * dispute, or a talent accepting an assignment, has to move this page without
 * a reload. What the subscription owes is the refetch.
 */
describe('the real-time subscription', () => {
  it('refetches the project when a status event arrives', async () => {
    await render()
    await screen.findByText('Toko Online Batik')
    const [channel, handler] = vi.mocked(subscribeTo).mock.calls.at(-1) as [string, () => void]
    expect(channel).toBe('project:p-1')
    apiFetch.mockClear()

    handler()

    await waitFor(() => expect(apiFetch).toHaveBeenCalled())
  })
})

describe('opening a dispute', () => {
  async function openDispute(project: unknown = PROJECT) {
    stubApi(project)
    const user = userEvent.setup()
    await render()
    await user.click(await screen.findByRole('button', { name: 'Open Dispute' }))
    const heading = await screen.findByRole('heading', { level: 3, name: 'Open Dispute' })
    return { user, dialog: within(heading.parentElement as HTMLElement) }
  }

  it('refuses to open one with no reason given', async () => {
    const { user, dialog } = await openDispute()

    await user.click(dialog.getByRole('button', { name: 'Open Dispute' }))

    await waitFor(() => expect(toastMessages()).toContain('Please describe the dispute'))
    expect(apiFetch).not.toHaveBeenCalledWith('/api/v1/disputes', expect.anything())
  })

  it('files the dispute against the assigned talent', async () => {
    const { user, dialog } = await openDispute()

    await user.type(
      dialog.getByPlaceholderText('Describe the issue with the deliverable or the talent'),
      'Deliverable tidak sesuai PRD',
    )
    await user.click(dialog.getByRole('button', { name: 'Open Dispute' }))

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        '/api/v1/disputes',
        expect.objectContaining({
          body: JSON.stringify({
            projectId: 'p-1',
            againstUserId: 'u-talent',
            reason: 'Deliverable tidak sesuai PRD',
          }),
        }),
      ),
    )
    expect(toastMessages()).toContain('Dispute opened')
  })

  /** With nobody assigned there is no respondent, so nothing may be filed. */
  it('files nothing when no talent is assigned to dispute', async () => {
    const { user, dialog } = await openDispute({ ...PROJECT, assignments: [] })

    await user.type(
      dialog.getByPlaceholderText('Describe the issue with the deliverable or the talent'),
      'Tidak ada progres',
    )
    await user.click(dialog.getByRole('button', { name: 'Open Dispute' }))

    await waitFor(() => expect(toastMessages()).toContain('No assigned talent to dispute'))
    expect(apiFetch).not.toHaveBeenCalledWith('/api/v1/disputes', expect.anything())
  })
})

describe('moving the project along', () => {
  it('lets an owner start a matched project', async () => {
    stubApi({ ...PROJECT, status: 'matched' })
    const user = userEvent.setup()
    await render()

    await user.click(await screen.findByRole('button', { name: 'Start Project' }))

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        '/api/v1/projects/p-1/transition',
        expect.objectContaining({ body: JSON.stringify({ status: 'in_progress' }) }),
      ),
    )
    expect(toastMessages()).toContain('In Progress')
  })

  it('withholds the start control from a talent', async () => {
    stubApi({ ...PROJECT, status: 'matched' })
    signIn('talent')

    await render()

    expect(await screen.findByRole('heading', { name: 'Toko Online Batik' })).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Start Project' })).toBeNull()
  })

  it('lets an owner accept the work under review', async () => {
    stubApi({ ...PROJECT, status: 'review' })
    const user = userEvent.setup()
    await render()

    await user.click(await screen.findByRole('button', { name: 'Accept & Complete' }))

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        '/api/v1/projects/p-1/transition',
        expect.objectContaining({ body: JSON.stringify({ status: 'completed' }) }),
      ),
    )
  })

  it('withholds final acceptance from a talent', async () => {
    stubApi({ ...PROJECT, status: 'review' })
    signIn('talent')

    await render()

    expect(await screen.findByRole('heading', { name: 'Toko Online Batik' })).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Accept & Complete' })).toBeNull()
  })

  it('reports a refused transition rather than looking as if it worked', async () => {
    apiFetch.mockImplementation(async (url: string) => {
      const path = String(url)
      if (path.includes('/transition')) throw new Error('contracts are unsigned')
      if (path.includes('/milestones')) return { success: true, data: [] }
      if (path.includes('/status-logs')) return { success: true, data: [] }
      return { success: true, data: { ...PROJECT, status: 'matched' } }
    })
    const user = userEvent.setup()
    await render()

    await user.click(await screen.findByRole('button', { name: 'Start Project' }))

    await waitFor(() => expect(toastMessages()).toContain('contracts are unsigned'))
  })
})

/** Each status points at the one page that can act on it next. */
describe('the shortcut to whatever comes next', () => {
  it.each([
    ['draft', 'AI Scoping', '/projects/p-1/scoping'],
    ['brd_generated', 'Business Requirement Document', '/projects/p-1/brd'],
    ['prd_generated', 'Product Requirement Document', '/projects/p-1/prd'],
    ['matching', 'View recommendations', '/projects/p-1/matching'],
  ])('sends a %s project to %s', async (status, label, href) => {
    stubApi({ ...PROJECT, status })

    await render()

    expect((await screen.findByRole('link', { name: label })).getAttribute('href')).toBe(href)
  })

  it('links every sibling tab from the overview', async () => {
    await render()

    expect((await screen.findByRole('link', { name: 'Milestones' })).getAttribute('href')).toBe(
      '/projects/p-1/milestones',
    )
    expect(screen.getByRole('link', { name: 'Documents' }).getAttribute('href')).toBe(
      '/projects/p-1/documents',
    )
  })
})

/** Visibility decides whether the project is listed publicly at all. */
describe('changing who can see the project', () => {
  it('offers an owner the visibility control set to its current value', async () => {
    await render()

    const select = (await screen.findByRole('combobox')) as HTMLSelectElement
    expect(select.value).toBe('public_summary')
  })

  it('withholds the visibility control from a talent', async () => {
    signIn('talent')

    await render()

    expect(await screen.findByRole('heading', { name: 'Toko Online Batik' })).toBeDefined()
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('saves the new visibility the owner picks', async () => {
    const user = userEvent.setup()
    await render()

    await user.selectOptions(await screen.findByRole('combobox'), 'private')

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        '/api/v1/projects/p-1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ visibility: 'private' }),
        }),
      ),
    )
  })

  it('defaults to the public summary when the project carries no visibility', async () => {
    stubApi({ ...PROJECT, visibility: undefined })

    await render()

    expect(((await screen.findByRole('combobox')) as HTMLSelectElement).value).toBe(
      'public_summary',
    )
  })
})
