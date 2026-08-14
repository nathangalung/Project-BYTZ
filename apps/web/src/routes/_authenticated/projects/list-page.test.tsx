// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderRoute } from '@/lib/testing/harness'
import { useAuthStore } from '@/stores/auth'
import { ApiError } from '../../../lib/api'
import * as projectListRoute from './index'

/**
 * The owner's project list.
 *
 * It splits one fetch into an active tab and a completed tab, and both counts
 * are in the tab labels, so a status landing in the wrong bucket is visible
 * before the list is even opened. The four states matter here more than most:
 * an owner whose projects failed to load must not be told they have none.
 */

vi.setConfig({ testTimeout: 30_000 })

const apiFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, apiFetch }
})

/** A promise that never settles, so the view stays in its loading state. */
const NEVER = () => new Promise(() => {})

function project(over: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    title: 'Toko Online Batik',
    status: 'in_progress',
    category: 'web_app',
    budgetMin: 10_000_000,
    budgetMax: 20_000_000,
    createdAt: '2026-06-01T00:00:00.000Z',
    ...over,
  }
}

function stubList(items: unknown[]) {
  apiFetch.mockResolvedValue({ success: true, data: { items, total: items.length } })
}

function render() {
  return renderRoute(projectListRoute, {
    path: '/projects',
    destinations: ['/projects/new', '/projects/$projectId'],
  })
}

beforeEach(() => {
  apiFetch.mockReset()
  useAuthStore.setState({
    user: { id: 'u1', email: 'o@kerjacus.id', name: 'Rina', role: 'owner', locale: 'id' },
    isAuthenticated: true,
    isLoading: false,
  })
})

describe('the four states of the project list', () => {
  it('withholds the empty state while the request is in flight', async () => {
    apiFetch.mockImplementation(NEVER)

    await render()

    expect(screen.getByRole('heading', { name: 'My Projects' })).toBeDefined()
    expect(screen.queryByText(/no projects/i)).toBeNull()
  })

  it('offers a way forward once the account is confirmed empty', async () => {
    stubList([])

    await render()

    expect(await screen.findByText(/no projects/i)).toBeDefined()
  })

  /** A failed load must not read as "you have never created a project". */
  it('reports a failed load instead of an empty account', async () => {
    apiFetch.mockRejectedValue(new ApiError('boom', 500, 'INTERNAL_ERROR'))

    await render()

    expect(await screen.findByText('Failed to load projects')).toBeDefined()
    expect(screen.queryByText(/no projects yet/i)).toBeNull()
  })

  it('lists what it was given', async () => {
    stubList([project()])

    await render()

    expect(await screen.findByText('Toko Online Batik')).toBeDefined()
  })
})

/**
 * The split between the two tabs.
 *
 * The counts come from two status sets, and a status in neither appears in no
 * tab at all - which reads to the owner as a project the platform lost.
 */
describe('sorting projects into active and completed', () => {
  const MIXED = [
    project({ id: 'p1', title: 'Sedang Jalan', status: 'in_progress' }),
    project({ id: 'p2', title: 'Sedang Dicocokkan', status: 'matching' }),
    project({ id: 'p3', title: 'Sudah Selesai', status: 'completed' }),
    project({ id: 'p4', title: 'Dibatalkan', status: 'cancelled' }),
  ]

  it('counts each bucket in its own tab label', async () => {
    stubList(MIXED)

    await render()

    expect(await screen.findByRole('tab', { name: 'Active (2)' })).toBeDefined()
    expect(screen.getByRole('tab', { name: 'Completed (2)' })).toBeDefined()
  })

  it('shows the active projects first and the finished ones on demand', async () => {
    const user = userEvent.setup()
    stubList(MIXED)

    await render()
    await screen.findByText('Sedang Jalan')
    expect(screen.queryByText('Sudah Selesai')).toBeNull()

    await user.click(screen.getByRole('tab', { name: 'Completed (2)' }))

    expect(await screen.findByText('Sudah Selesai')).toBeDefined()
    expect(screen.getByText('Dibatalkan')).toBeDefined()
    expect(screen.queryByText('Sedang Jalan')).toBeNull()
  })

  /**
   * Both sets together cover all eighteen database statuses today, so this is
   * about the nineteenth. A status added server-side before the console ships
   * lands in neither bucket and the project disappears from the owner's list
   * entirely - no tab, no count, no row. Recorded as a gap, not endorsed.
   */
  it('drops a status it does not recognise out of both tabs', async () => {
    stubList([project({ id: 'p9', title: 'Status Baru', status: 'archived' })])

    await render()

    expect(await screen.findByRole('tab', { name: 'Active (0)' })).toBeDefined()
    expect(screen.getByRole('tab', { name: 'Completed (0)' })).toBeDefined()
    expect(screen.queryByText('Status Baru')).toBeNull()
  })

  it('keeps a draft in the active tab', async () => {
    stubList([project({ id: 'p8', title: 'Masih Draf', status: 'draft' })])

    await render()

    expect(await screen.findByRole('tab', { name: 'Active (1)' })).toBeDefined()
    expect(screen.getByText('Masih Draf')).toBeDefined()
  })
})

describe('the status filter', () => {
  it('narrows the request and drops the parameter again on All', async () => {
    const user = userEvent.setup()
    stubList([project()])
    await render()
    await screen.findByText('Toko Online Batik')

    const filter = screen.getByRole('combobox')
    await user.selectOptions(filter, 'completed')
    await waitFor(() =>
      expect(apiFetch.mock.calls.some((c) => String(c[0]).includes('status=completed'))).toBe(true),
    )

    apiFetch.mockClear()
    await user.selectOptions(filter, '')

    await waitFor(() => expect(apiFetch.mock.calls.length).toBeGreaterThan(0))
    expect(apiFetch.mock.calls.every((c) => !String(c[0]).includes('status='))).toBe(true)
  })

  it('always scopes the request to the signed-in owner', async () => {
    stubList([project()])

    await render()

    await waitFor(() => expect(apiFetch).toHaveBeenCalled())
    expect(String(apiFetch.mock.calls[0][0])).toContain('ownerId=u1')
  })
})

/** Grid and list are the same data; only the layout changes. */
describe('switching between grid and list', () => {
  it('keeps the projects on screen across the switch', async () => {
    const user = userEvent.setup()
    stubList([project()])
    await render()
    await screen.findByText('Toko Online Batik')

    await user.click(screen.getByRole('button', { name: 'List View' }))
    expect(screen.getByText('Toko Online Batik')).toBeDefined()

    await user.click(screen.getByRole('button', { name: 'Grid View' }))
    expect(screen.getByText('Toko Online Batik')).toBeDefined()
  })

  it('marks the chosen view and unmarks the other', async () => {
    const user = userEvent.setup()
    stubList([project()])
    await render()
    await screen.findByText('Toko Online Batik')
    const grid = screen.getByRole('button', { name: 'Grid View' })
    const list = screen.getByRole('button', { name: 'List View' })
    expect(grid.className).toContain('bg-primary-500/10')

    await user.click(list)

    expect(list.className).toContain('bg-primary-500/10')
    expect(grid.className).not.toContain('bg-primary-500/10')
  })

  /** The skeleton has to match the layout it is standing in for. */
  it('shows the skeleton in the chosen layout while loading', async () => {
    const user = userEvent.setup()
    stubList([project()])
    const { container } = await render()
    await screen.findByText('Toko Online Batik')

    await user.click(screen.getByRole('button', { name: 'List View' }))
    apiFetch.mockImplementation(NEVER)
    await user.selectOptions(screen.getByRole('combobox'), 'completed')

    await waitFor(() => expect(container.querySelector('.animate-pulse')).not.toBeNull())
  })
})

describe('creating the next project', () => {
  it('offers the create link whether or not any project exists', async () => {
    stubList([project()])

    await render()

    const create = screen.getByRole('link', { name: /create project/i })
    expect(create.getAttribute('href')).toBe('/projects/new')
  })

  it('links each project to its own page', async () => {
    stubList([project()])

    await render()

    const card = await screen.findByRole('link', { name: /Toko Online Batik/ })
    expect(card.getAttribute('href')).toBe('/projects/p1')
    expect(within(card).getByText('In Progress')).toBeDefined()
  })
})
