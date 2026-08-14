// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderRoute } from '@/lib/testing/harness'
import { useAuthStore } from '@/stores/auth'
import * as dashboardRoute from './dashboard'

/*
 * Mounting a route pulls its whole import graph through vite's transform on
 * first render, and the router plugin splits some route components into their
 * own chunk, so that cost lands inside the test rather than at import time.
 */
vi.setConfig({ testTimeout: 30_000 })

const apiFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, apiFetch }
})

/** A promise that never settles, so the view stays in its loading state. */
const NEVER = () => new Promise(() => {})

type Reply = { projects?: unknown; activities?: unknown; summary?: unknown }

/** Route by endpoint, because the page fans out to three of them at once. */
function stub({ projects, activities, summary }: Reply) {
  apiFetch.mockImplementation((url: string) => {
    if (url.startsWith('/api/v1/projects'))
      return Promise.resolve({ success: true, data: projects })
    if (url.startsWith('/api/v1/activities'))
      return Promise.resolve({ success: true, data: activities })
    return Promise.resolve({ success: true, data: summary })
  })
}

const EMPTY_PAGE = { items: [], total: 0 }

beforeEach(() => {
  apiFetch.mockReset()
  useAuthStore.setState({
    user: { id: 'u1', email: 'o@kerjacus.id', name: 'Rina', role: 'owner', locale: 'id' },
    isAuthenticated: true,
    isLoading: false,
  })
})

function render() {
  return renderRoute(dashboardRoute, {
    path: '/dashboard',
    destinations: ['/projects', '/projects/new', '/projects/$projectId'],
  })
}

/**
 * Read a stat card as the pair a user sees.
 *
 * Queried by structure rather than by label text because three of the four
 * labels also appear elsewhere on the page - "Active Projects" is a section
 * heading, "Completed" is a status badge - so a text lookup is ambiguous.
 * The card is the only place a value sits directly above its label.
 */
function statValues(container: HTMLElement): Record<string, string> {
  const pairs: Record<string, string> = {}
  for (const value of container.querySelectorAll('p.text-3xl')) {
    const label = value.nextElementSibling?.textContent
    if (label) pairs[label] = value.textContent ?? ''
  }
  return pairs
}

describe('the owner dashboard header', () => {
  it('greets the signed-in owner by name', async () => {
    stub({ projects: EMPTY_PAGE, activities: EMPTY_PAGE, summary: { totalSpent: 0 } })

    await render()

    expect(screen.getByRole('heading', { name: /welcome, rina/i })).toBeDefined()
  })
})

/**
 * The four states of the project list. Loading and empty are the pair worth
 * pinning: both render no rows, and a page that shows "No projects yet" while
 * the request is still in flight tells an owner their work is gone.
 */
describe('the project list', () => {
  it('withholds the empty state while the request is in flight', async () => {
    apiFetch.mockImplementation(NEVER)

    await render()

    expect(screen.queryByText('No projects yet')).toBeNull()
    expect(screen.queryByRole('link', { name: /create your first project/i })).toBeNull()
  })

  it('offers a way forward once the account is confirmed empty', async () => {
    stub({ projects: EMPTY_PAGE, activities: EMPTY_PAGE, summary: { totalSpent: 0 } })

    await render()

    expect(await screen.findByText('No projects yet')).toBeDefined()
    expect(
      screen.getByRole('link', { name: /create your first project/i }).getAttribute('href'),
    ).toBe('/projects/new')
  })

  it('links each project to its own page and shows its status', async () => {
    stub({
      projects: {
        items: [
          { id: 'p1', title: 'Toko Online Batik', status: 'in_progress', finalPrice: 12_000_000 },
        ],
        total: 1,
      },
      activities: EMPTY_PAGE,
      summary: { totalSpent: 0 },
    })

    await render()

    const link = await screen.findByRole('link', { name: /toko online batik/i })
    expect(link.getAttribute('href')).toBe('/projects/p1')
    expect(within(link).getByText('Active')).toBeDefined()
    expect(within(link).getByText(/12(\.|,)000(\.|,)000|12 jt/)).toBeDefined()
  })

  /** Progress and team size are conditional; zero must not render a bar. */
  it('shows progress and team size only once they are non-zero', async () => {
    stub({
      projects: {
        items: [
          { id: 'p1', title: 'With Team', status: 'matching', teamSize: 3, progress: 40 },
          { id: 'p2', title: 'Bare', status: 'draft', teamSize: 0, progress: 0 },
        ],
        total: 2,
      },
      activities: EMPTY_PAGE,
      summary: { totalSpent: 0 },
    })

    await render()

    const withTeam = await screen.findByRole('link', { name: /with team/i })
    expect(within(withTeam).getByText('40%')).toBeDefined()
    expect(within(withTeam).getByText(/3\s*Talent/)).toBeDefined()

    const bare = screen.getByRole('link', { name: /^bare/i })
    expect(within(bare).queryByText('Progress')).toBeNull()
    expect(within(bare).queryByText(/Talent/)).toBeNull()
  })

  /** An unknown status must not blank the badge. */
  it('falls back to the draft badge for a status it does not know', async () => {
    stub({
      projects: { items: [{ id: 'p1', title: 'Odd', status: 'partially_active' }], total: 1 },
      activities: EMPTY_PAGE,
      summary: { totalSpent: 0 },
    })

    await render()

    expect(await screen.findByText('Draft')).toBeDefined()
  })
})

describe('the stat cards', () => {
  it('counts active and completed projects separately from the total', async () => {
    stub({
      projects: {
        items: [
          { id: 'p1', title: 'A', status: 'in_progress' },
          { id: 'p2', title: 'B', status: 'matched' },
          { id: 'p3', title: 'C', status: 'completed' },
          { id: 'p4', title: 'D', status: 'draft' },
        ],
        total: 4,
      },
      activities: EMPTY_PAGE,
      summary: { totalSpent: 5_000_000 },
    })

    const { container } = await render()
    await waitFor(() => {
      expect(statValues(container)['Total Projects']).toBe('4')
    })

    expect(statValues(container)).toMatchObject({
      'Total Projects': '4',
      'Active Projects': '2',
      Completed: '1',
    })
  })

  it('shows a placeholder for spending until the summary arrives', async () => {
    apiFetch.mockImplementation(NEVER)

    const { container } = await render()

    expect(statValues(container)['Total Spending']).toBe('--')
  })

  it('formats the spend once the summary arrives', async () => {
    stub({ projects: EMPTY_PAGE, activities: EMPTY_PAGE, summary: { totalSpent: 5_000_000 } })

    const { container } = await render()
    await screen.findByText('No projects yet')

    expect(statValues(container)['Total Spending']).toContain('5.000.000')
  })
})

describe('the activity feed', () => {
  it('withholds the empty state while activities are loading', async () => {
    apiFetch.mockImplementation((url: string) =>
      url.startsWith('/api/v1/activities')
        ? NEVER()
        : Promise.resolve({ success: true, data: EMPTY_PAGE }),
    )

    await render()

    expect(await screen.findByText('No projects yet')).toBeDefined()
    expect(screen.queryByText('No activities yet')).toBeNull()
  })

  it('says so when nothing has happened yet', async () => {
    stub({ projects: EMPTY_PAGE, activities: EMPTY_PAGE, summary: { totalSpent: 0 } })

    await render()

    expect(await screen.findByText('No activities yet')).toBeDefined()
  })

  it('renders each entry with its project and a relative time', async () => {
    stub({
      projects: EMPTY_PAGE,
      activities: {
        items: [
          {
            id: 'a1',
            type: 'milestone_approved',
            title: 'Milestone 1 approved',
            projectTitle: 'Toko Online Batik',
            createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
          },
        ],
        total: 1,
      },
      summary: { totalSpent: 0 },
    })

    await render()

    expect(await screen.findByText('Milestone 1 approved')).toBeDefined()
    expect(screen.getByText('Toko Online Batik')).toBeDefined()
    expect(screen.getByText(/3 jam/)).toBeDefined()
  })

  /** An activity type with no icon entry must still render its row. */
  it('falls back to a default icon for an unmapped activity type', async () => {
    stub({
      projects: EMPTY_PAGE,
      activities: {
        items: [
          {
            id: 'a1',
            type: 'something_new',
            title: 'Unknown thing happened',
            createdAt: new Date().toISOString(),
          },
        ],
        total: 1,
      },
      summary: { totalSpent: 0 },
    })

    await render()

    expect(await screen.findByText('Unknown thing happened')).toBeDefined()
  })
})

/** Talent has its own home; the guard is the only thing keeping them off this one. */
describe('the talent guard', () => {
  function guard() {
    const beforeLoad = dashboardRoute.Route.options.beforeLoad as () => void
    try {
      beforeLoad()
      return null
    } catch (thrown) {
      return (thrown as { options?: { to?: string } }).options?.to ?? null
    }
  }

  it('sends a talent to their own dashboard', () => {
    useAuthStore.setState({
      user: { id: 't1', email: 't@kerjacus.id', name: 'T', role: 'talent', locale: 'id' },
      isAuthenticated: true,
      isLoading: false,
    })

    expect(guard()).toBe('/talent')
  })

  it('lets an owner through', () => {
    expect(guard()).toBeNull()
  })
})
