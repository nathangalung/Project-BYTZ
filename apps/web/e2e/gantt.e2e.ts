import { expect, type Page, test } from '@playwright/test'
import {
  MILESTONES,
  mockMilestoneBoard,
  mockShell,
  OWNER,
  PROJECT_ID,
  seedBrowser,
  TASKS,
} from './support/app'

/**
 * The SVAR store contract, against the real store.
 *
 * gantt-view.test.tsx stubs the chart, so it can assert the props we pass and
 * nothing about what the store does with them. Three defects lived in that
 * gap: summaries without `open` swallowed every task, a `format` written as a
 * pattern string printed verbatim in the header, and a task whose parent was
 * missing was dropped without a word.
 */

const GANTT = '.wx-gantt'
const CHART_SCALE = '.wx-chart .wx-scale'

async function openGantt(page: Page, language: 'id' | 'en' = 'id') {
  await seedBrowser(page, { user: OWNER, language })
  await mockShell(page)
  await mockMilestoneBoard(page)
  await page.goto(`/projects/${PROJECT_ID}/milestones`)
  await page.getByRole('tab', { name: language === 'id' ? 'Tampilan Gantt' : 'Gantt View' }).click()
  await expect(page.locator(GANTT)).toBeVisible()
}

test.describe('gantt chart', () => {
  test('draws the work under each milestone', async ({ page }) => {
    await openGantt(page)

    // Summaries collapse without open
    for (const title of ['Wireframe', 'Design system', 'Skema database']) {
      await expect(page.getByText(title).first()).toBeVisible()
    }
  })

  test('keeps a milestone that has no tasks', async ({ page }) => {
    await openGantt(page)

    // Open empty summary throws inside
    await expect(page.getByText('Integrasi pembayaran').first()).toBeVisible()
    await expect(page.getByText('Something went wrong')).toHaveCount(0)
  })

  test('shows a task whose parent is not in the list', async ({ page }) => {
    await openGantt(page)
    await expect(page.getByText('Pekerjaan yatim').first()).toBeVisible()
  })

  test('renders every milestone as a row', async ({ page }) => {
    await openGantt(page)

    for (const title of ['Rancang antarmuka', 'Bangun API', 'Integrasi pembayaran']) {
      await expect(page.getByText(title).first()).toBeVisible()
    }
  })

  test('formats the timeline header instead of printing the pattern', async ({ page }) => {
    await openGantt(page)

    const scale = await page.locator(CHART_SCALE).innerText()
    expect(scale).toMatch(/20\d\d/)
    expect(scale).not.toContain('MMM')
    expect(scale).not.toContain('yyyy')
  })

  test('names the month in the reader language', async ({ page }) => {
    const august = MILESTONES.map((m) => ({ ...m, dueDate: '2026-08-20T00:00:00.000Z' }))
    const tasks = TASKS.map((t) => ({
      ...t,
      startDate: '2026-08-10T00:00:00.000Z',
      endDate: '2026-08-14T00:00:00.000Z',
    }))

    await seedBrowser(page, { user: OWNER, language: 'id' })
    await mockShell(page)
    await mockMilestoneBoard(page, { milestones: august, tasks })
    await page.goto(`/projects/${PROJECT_ID}/milestones`)
    await page.getByRole('tab', { name: 'Tampilan Gantt' }).click()
    await expect(page.locator(GANTT)).toBeVisible()

    // Agu in id, Aug in en
    await expect(page.locator(CHART_SCALE)).toContainText('Agu')
  })

  test('labels the grid columns in the reader language', async ({ page }) => {
    await openGantt(page)

    const grid = await page.locator(`${GANTT} .wx-header`).first().innerText()
    expect(grid).toContain('Nama Tugas')
    expect(grid).toContain('Mulai')
    expect(grid).toContain('Durasi')
  })

  test('reports a failed task request instead of an empty plan', async ({ page }) => {
    await seedBrowser(page, { user: OWNER })
    await mockShell(page)
    await mockMilestoneBoard(page)
    await page.route(`**/api/v1/projects/${PROJECT_ID}/tasks`, (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }),
    )
    await page.goto(`/projects/${PROJECT_ID}/milestones`)
    await page.getByRole('tab', { name: 'Tampilan Gantt' }).click()

    await expect(
      page.getByText('Gagal memuat data Gantt. Periksa koneksi lalu coba lagi.'),
    ).toBeVisible()
  })
})
