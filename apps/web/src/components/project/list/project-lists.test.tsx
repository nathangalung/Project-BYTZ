// @vitest-environment jsdom
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it } from 'vitest'
import i18n from '@/lib/i18n'
import { ActiveProjectList, CompletedProjectList, EmptyState } from './project-lists'
import type { ProjectItem } from './shared'

beforeAll(async () => {
  await i18n.changeLanguage('id')
})

const t = i18n.getFixedT('id', 'project')

function project(overrides: Partial<ProjectItem> = {}): ProjectItem {
  return {
    id: 'p-1',
    title: 'Marketplace UMKM',
    category: 'web_app',
    status: 'in_progress',
    budgetMin: 10_000_000,
    budgetMax: 20_000_000,
    createdAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  }
}

async function renderInRouter(node: React.ReactNode, { expectLinks = true } = {}) {
  const rootRoute = createRootRoute({ component: () => node })
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      createRoute({ getParentRoute: () => rootRoute, path: '/', component: () => null }),
      createRoute({
        getParentRoute: () => rootRoute,
        path: '/projects/new',
        component: () => null,
      }),
      createRoute({
        getParentRoute: () => rootRoute,
        path: '/projects/$projectId',
        component: () => null,
      }),
    ]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  const result = render(<RouterProvider router={router} />)
  if (expectLinks) await screen.findAllByRole('link')
  else await screen.findByText(/Belum ada/)
  return result
}

describe('ActiveProjectList', () => {
  /**
   * The empty state has to say which list is empty, not just that something
   * is. "No projects" on the active tab reads as having none at all, when the
   * owner may have a shelf of completed ones.
   */
  it('says the active list specifically is empty', async () => {
    await renderInRouter(<ActiveProjectList projects={[]} viewMode="grid" t={t} />, {
      expectLinks: false,
    })

    expect(screen.getByText('Belum ada proyek berjalan')).toBeDefined()
  })

  it('renders one card per project', async () => {
    await renderInRouter(
      <ActiveProjectList
        projects={[project(), project({ id: 'p-2', title: 'Aplikasi kasir' })]}
        viewMode="grid"
        t={t}
      />,
    )

    expect(screen.getAllByRole('link')).toHaveLength(2)
    expect(screen.getByText('Aplikasi kasir')).toBeDefined()
  })

  it('lays out as a grid or a column depending on the view mode', async () => {
    const { container: grid } = await renderInRouter(
      <ActiveProjectList projects={[project()]} viewMode="grid" t={t} />,
    )
    expect((grid.querySelector('div > div') as HTMLElement).className).toContain('grid')

    const { container: list } = await renderInRouter(
      <ActiveProjectList projects={[project()]} viewMode="list" t={t} />,
    )
    expect((list.querySelector('div > div') as HTMLElement).className).toContain('flex-col')
  })
})

describe('CompletedProjectList', () => {
  it('says the completed list specifically is empty', async () => {
    await renderInRouter(<CompletedProjectList projects={[]} viewMode="grid" t={t} />, {
      expectLinks: false,
    })

    expect(screen.getByText('Belum ada proyek selesai')).toBeDefined()
  })

  it.each(['grid', 'list'] as const)('links each completed project in %s', async (viewMode) => {
    await renderInRouter(
      <CompletedProjectList
        projects={[project({ status: 'completed' })]}
        viewMode={viewMode}
        t={t}
      />,
    )

    expect(screen.getByRole('link').getAttribute('href')).toBe('/projects/p-1')
    expect(screen.getByText('Selesai')).toBeDefined()
  })

  /**
   * A finished project is dated by when it finished, not when it started, so
   * updatedAt wins where it exists. Falling back to createdAt is what keeps a
   * row that predates the column from rendering "Invalid Date".
   */
  it('dates a completed project from when it was last updated', async () => {
    await renderInRouter(
      <CompletedProjectList
        projects={[project({ status: 'completed', updatedAt: '2026-08-13T00:00:00.000Z' })]}
        viewMode="list"
        t={t}
      />,
    )

    expect(screen.getByText('13 Agustus 2026')).toBeDefined()
    expect(screen.queryByText('2 Januari 2026')).toBeNull()
  })

  it('falls back to the creation date when there is no update', async () => {
    await renderInRouter(
      <CompletedProjectList projects={[project({ status: 'completed' })]} viewMode="list" t={t} />,
    )

    expect(screen.getByText('2 Januari 2026')).toBeDefined()
  })

  it('falls back to the completed styling for a status it does not know', async () => {
    await renderInRouter(
      <CompletedProjectList projects={[project({ status: 'archived' })]} viewMode="grid" t={t} />,
    )

    expect(screen.getByText('Selesai')).toBeDefined()
  })

  it('shows the budget range in the grid view', async () => {
    await renderInRouter(
      <CompletedProjectList projects={[project({ status: 'completed' })]} viewMode="grid" t={t} />,
    )

    expect(screen.getByText('Rp 10.000.000 - Rp 20.000.000')).toBeDefined()
  })
})

describe('EmptyState', () => {
  /**
   * The first-run state is the one that has to say what to do next rather than
   * leave a blank panel, so it carries the create action itself.
   */
  it('explains the blank dashboard and offers the way out of it', async () => {
    await renderInRouter(<EmptyState />)

    expect(screen.getByRole('heading', { name: /Belum ada proyek/ })).toBeDefined()
    expect(screen.getByText(/AI kami akan membantu/)).toBeDefined()
    expect(screen.getByRole('link', { name: /Buat Proyek/ }).getAttribute('href')).toBe(
      '/projects/new',
    )
  })
})
