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
import { ProjectCard, ProjectListSkeleton } from './project-card'

beforeAll(async () => {
  await i18n.changeLanguage('id')
})

type Project = Parameters<typeof ProjectCard>[0]['project']

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: '0199-aaaa',
    title: 'Marketplace UMKM',
    category: 'web_app',
    status: 'in_progress',
    budgetMin: 10_000_000,
    budgetMax: 20_000_000,
    createdAt: '2026-08-13T09:00:00.000Z',
    ...overrides,
  }
}

async function renderCard(node: React.ReactNode) {
  const rootRoute = createRootRoute({ component: () => node })
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      createRoute({ getParentRoute: () => rootRoute, path: '/', component: () => null }),
      createRoute({
        getParentRoute: () => rootRoute,
        path: '/projects/$projectId',
        component: () => null,
      }),
    ]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  const result = render(<RouterProvider router={router} />)
  await screen.findByRole('link')
  return result
}

describe('ProjectCard', () => {
  it.each(['grid', 'list'] as const)('links the whole %s card to the project', async (viewMode) => {
    await renderCard(<ProjectCard project={project()} viewMode={viewMode} />)

    const link = screen.getByRole('link')
    expect(link.getAttribute('href')).toBe('/projects/0199-aaaa')
    expect(link.textContent).toContain('Marketplace UMKM')
  })

  it.each(['grid', 'list'] as const)('shows the budget range in the %s card', async (viewMode) => {
    await renderCard(<ProjectCard project={project()} viewMode={viewMode} />)

    expect(screen.getByRole('link').textContent).toContain('Rp 10.000.000')
    expect(screen.getByRole('link').textContent).toContain('Rp 20.000.000')
  })

  it('translates the status and the category rather than showing the enum', async () => {
    await renderCard(<ProjectCard project={project()} viewMode="grid" />)

    expect(screen.getByText('Dalam Proses')).toBeDefined()
    expect(screen.getByText('Web App')).toBeDefined()
    expect(screen.queryByText('in_progress')).toBeNull()
  })

  /**
   * The status set is a database enum that grows, and a card is rendered for
   * whatever the API returns. Falling back rather than indexing undefined is
   * what keeps an unrecognised status from blanking the card's class list.
   */
  it('falls back to the draft styling for a status it does not know', async () => {
    await renderCard(
      <ProjectCard project={project({ status: 'partially_active' })} viewMode="grid" />,
    )

    expect(screen.getByRole('link')).toBeDefined()
  })

  it('falls back to the other category for one it does not know', async () => {
    await renderCard(<ProjectCard project={project({ category: 'civil' })} viewMode="grid" />)

    expect(screen.getByText('Lainnya')).toBeDefined()
  })

  describe('the optional fields', () => {
    it('hides the team size when the project is a single-talent one', async () => {
      await renderCard(<ProjectCard project={project({ teamSize: 1 })} viewMode="grid" />)

      expect(screen.getByRole('link').textContent).toContain('1 talenta')
    })

    it('hides the team size entirely when there is none', async () => {
      await renderCard(<ProjectCard project={project()} viewMode="grid" />)

      expect(screen.getByRole('link').textContent).not.toContain('talenta')
    })

    it('hides the progress bar before any progress is made', async () => {
      const { container } = await renderCard(
        <ProjectCard project={project({ progress: 0 })} viewMode="grid" />,
      )

      expect(screen.queryByText('Progres')).toBeNull()
      expect(container.querySelector('.bg-success-500')).toBeNull()
    })

    it('shows the progress bar once there is progress', async () => {
      const { container } = await renderCard(
        <ProjectCard project={project({ progress: 40 })} viewMode="grid" />,
      )

      expect(screen.getByText('Progres')).toBeDefined()
      expect(screen.getByText('40%')).toBeDefined()
      expect((container.querySelector('.bg-success-500') as HTMLElement).style.width).toBe('40%')
    })

    it('leaves the progress bar out of the list view even when there is progress', async () => {
      await renderCard(<ProjectCard project={project({ progress: 40 })} viewMode="list" />)

      expect(screen.queryByText('Progres')).toBeNull()
    })
  })

  it('dates the card from when the project was created', async () => {
    await renderCard(<ProjectCard project={project()} viewMode="grid" />)

    expect(screen.getByText('13 Agustus 2026')).toBeDefined()
  })
})

describe('ProjectListSkeleton', () => {
  /**
   * The loading state is one of the four every fetching section owes the user,
   * and it has to be a skeleton rather than a spinner over an empty panel so
   * the layout does not jump when the rows arrive.
   */
  it.each(['grid', 'list'] as const)('renders six pulsing placeholders in %s', (viewMode) => {
    const { container } = render(<ProjectListSkeleton viewMode={viewMode} />)

    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(6)
  })

  it('lays the grid placeholders out taller than the list ones', () => {
    const { container: grid } = render(<ProjectListSkeleton viewMode="grid" />)
    const { container: list } = render(<ProjectListSkeleton viewMode="list" />)

    expect((grid.querySelector('.animate-pulse') as HTMLElement).className).toContain('h-48')
    expect((list.querySelector('.animate-pulse') as HTMLElement).className).toContain('h-16')
  })

  it('shows no text, so nothing reads as content while loading', () => {
    const { container } = render(<ProjectListSkeleton viewMode="grid" />)

    expect(container.textContent).toBe('')
  })
})
