import type { Page, Route } from '@playwright/test'

export type SeedUser = {
  id: string
  email: string
  name: string
  role: 'owner' | 'talent'
  locale: 'id' | 'en'
}

export const OWNER: SeedUser = {
  id: 'owner-1',
  email: 'owner@kerjacus.test',
  name: 'Owner Satu',
  role: 'owner',
  locale: 'id',
}

export const PROJECT_ID = 'project-1'

export type Theme = 'light' | 'dark'

/** Writes the keys the app reads. */
export async function seedBrowser(
  page: Page,
  options: { user?: SeedUser | null; theme?: Theme; language?: 'id' | 'en' } = {},
): Promise<void> {
  const { user = null, theme = 'light', language = 'id' } = options
  await page.addInitScript(
    ([serialisedUser, chosenTheme, chosenLanguage]) => {
      localStorage.setItem('kerjacus-theme', chosenTheme as string)
      localStorage.setItem('i18nextLng', chosenLanguage as string)
      if (serialisedUser) {
        localStorage.setItem(
          'kerjacus-auth',
          JSON.stringify({ state: { user: serialisedUser, isAuthenticated: true }, version: 0 }),
        )
      } else {
        localStorage.removeItem('kerjacus-auth')
      }
    },
    [user, theme, language] as const,
  )
}

function json(route: Route, data: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify({ success: status < 400, data }),
  })
}

/**
 * Catch-all so nothing hangs.
 *
 * apiFetch waits 30 seconds and a pending query has no error state, so an
 * unmatched request reads as a page that never finishes loading. Later
 * page.route calls still win, so a test can override any single path.
 */
export async function mockShell(page: Page, user: SeedUser | null = OWNER): Promise<void> {
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/api/v1/me')) {
      return user ? json(route, user) : json(route, null, 401)
    }
    if (path.endsWith('/unread-count')) return json(route, { count: 0 })
    if (path.endsWith('/api/v1/notifications')) return json(route, { items: [], total: 0 })
    if (path.endsWith('/reviews/public')) return json(route, [])
    if (path.endsWith('/projects/stats')) {
      return json(route, { totalProjects: 0, completedProjects: 0, totalTalents: 0 })
    }
    if (path.endsWith('/projects/public') || path.endsWith('/api/v1/projects')) {
      return json(route, { items: [], total: 0, page: 1, pageSize: 20 })
    }
    return json(route, null)
  })
}

export type MilestoneSeed = {
  id: string
  title: string
  status: string
  amount: number
  dueDate: string | null
  workPackageId?: string | null
  revisionCount?: number
  milestoneType?: 'individual' | 'integration'
  orderIndex?: number
}

export type TaskSeed = {
  id: string
  milestoneId: string
  title: string
  status: string
  startDate: string
  endDate: string
}

export const MILESTONES: MilestoneSeed[] = [
  {
    id: 'ms-1',
    title: 'Rancang antarmuka',
    status: 'approved',
    amount: 4_000_000,
    dueDate: '2026-03-10T00:00:00.000Z',
    workPackageId: 'wp-1',
    orderIndex: 0,
  },
  {
    id: 'ms-2',
    title: 'Bangun API',
    status: 'submitted',
    amount: 7_000_000,
    dueDate: '2026-03-24T00:00:00.000Z',
    workPackageId: 'wp-1',
    revisionCount: 1,
    orderIndex: 1,
  },
  {
    id: 'ms-3',
    title: 'Integrasi pembayaran',
    status: 'in_progress',
    amount: 7_000_000,
    dueDate: '2026-04-07T00:00:00.000Z',
    workPackageId: 'wp-2',
    orderIndex: 2,
  },
]

export const TASKS: TaskSeed[] = [
  {
    id: 'task-1',
    milestoneId: 'ms-1',
    title: 'Wireframe',
    status: 'completed',
    startDate: '2026-03-03T00:00:00.000Z',
    endDate: '2026-03-07T00:00:00.000Z',
  },
  {
    id: 'task-2',
    milestoneId: 'ms-1',
    title: 'Design system',
    status: 'completed',
    startDate: '2026-03-06T00:00:00.000Z',
    endDate: '2026-03-10T00:00:00.000Z',
  },
  {
    id: 'task-3',
    milestoneId: 'ms-2',
    title: 'Skema database',
    status: 'in_progress',
    startDate: '2026-03-11T00:00:00.000Z',
    endDate: '2026-03-18T00:00:00.000Z',
  },
  // Parent absent from the milestones
  {
    id: 'task-orphan',
    milestoneId: 'ms-does-not-exist',
    title: 'Pekerjaan yatim',
    status: 'pending',
    startDate: '2026-03-12T00:00:00.000Z',
    endDate: '2026-03-16T00:00:00.000Z',
  },
]

const PROJECT_DETAIL = {
  id: PROJECT_ID,
  title: 'Marketplace UMKM',
  description: 'Platform pemesanan untuk pedagang lokal.',
  status: 'in_progress',
  category: 'web_app',
  teamSize: 2,
  progress: 40,
  estimatedTimelineDays: 90,
  createdAt: '2026-02-01T00:00:00.000Z',
  updatedAt: '2026-03-01T00:00:00.000Z',
  assignments: [
    { id: 'as-1', workPackageId: 'wp-1', roleLabel: 'Backend Developer', status: 'active' },
    { id: 'as-2', workPackageId: 'wp-2', roleLabel: 'Frontend Developer', status: 'active' },
  ],
  milestones: [],
  workPackages: [],
}

/** Board plus its Gantt tab. */
export async function mockMilestoneBoard(
  page: Page,
  overrides: { milestones?: MilestoneSeed[]; tasks?: TaskSeed[] } = {},
): Promise<void> {
  const milestones = overrides.milestones ?? MILESTONES
  const tasks = overrides.tasks ?? TASKS
  await page.route(`**/api/v1/projects/${PROJECT_ID}/milestones`, (route) =>
    json(route, milestones),
  )
  await page.route(`**/api/v1/projects/${PROJECT_ID}/tasks`, (route) =>
    json(route, { tasks, dependencies: [] }),
  )
  await page.route(`**/api/v1/projects/${PROJECT_ID}`, (route) => json(route, PROJECT_DETAIL))
}
