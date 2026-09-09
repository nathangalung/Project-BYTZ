import { expect, test } from '@playwright/test'
import {
  mockMilestoneBoard,
  mockShell,
  OWNER,
  PROJECT_ID,
  seedBrowser,
  type Theme,
} from './support/app'
import { collectContrastFailures, formatFindings } from './support/contrast'

/**
 * WCAG 1.4.3 against the painted page.
 *
 * styles.contrast.test.ts does this arithmetic over the token files, which
 * only reaches pairs written as tokens. A class and the background behind it
 * usually live on different elements, so grep cannot pair them; the browser
 * can. Both themes, because a token that flips direction can pass in one and
 * fail in the other.
 */

const PUBLIC_ROUTES = ['/', '/login', '/register', '/about', '/browse-projects', '/forgot-password']
const OWNER_ROUTES = ['/dashboard', '/notifications', '/settings']
const THEMES: Theme[] = ['light', 'dark']

for (const theme of THEMES) {
  test.describe(`contrast in ${theme} mode`, () => {
    for (const route of PUBLIC_ROUTES) {
      test(`public ${route}`, async ({ page }) => {
        await seedBrowser(page, { theme })
        await mockShell(page, null)
        await page.goto(route)
        await page.waitForLoadState('networkidle')

        const report = await collectContrastFailures(page)
        expect(report.checked, 'nothing measured means the page never rendered').toBeGreaterThan(5)
        expect(report.failures, formatFindings(report.failures)).toEqual([])
      })
    }

    for (const route of OWNER_ROUTES) {
      test(`owner ${route}`, async ({ page }) => {
        await seedBrowser(page, { user: OWNER, theme })
        await mockShell(page)
        await page.goto(route)
        await page.waitForLoadState('networkidle')

        const report = await collectContrastFailures(page)
        expect(report.checked).toBeGreaterThan(5)
        expect(report.failures, formatFindings(report.failures)).toEqual([])
      })
    }

    test(`owner milestone board`, async ({ page }) => {
      await seedBrowser(page, { user: OWNER, theme })
      await mockShell(page)
      await mockMilestoneBoard(page)
      await page.goto(`/projects/${PROJECT_ID}/milestones`)
      await page.waitForLoadState('networkidle')

      const report = await collectContrastFailures(page)
      expect(report.checked).toBeGreaterThan(5)
      expect(report.failures, formatFindings(report.failures)).toEqual([])
    })
  })
}

test('the probe can see a failure', async ({ page }) => {
  await seedBrowser(page, { theme: 'light' })
  await mockShell(page, null)
  await page.goto('/login')
  await page.waitForLoadState('networkidle')

  const clean = await collectContrastFailures(page)
  expect(clean.checked).toBeGreaterThan(20)
  expect(clean.failures).toEqual([])

  await page.evaluate(() => {
    const el = document.createElement('p')
    el.id = 'contrast-probe-bait'
    el.textContent = 'Teks yang tidak terbaca'
    el.style.color = '#c9c9c9'
    el.style.backgroundColor = '#ffffff'
    document.body.appendChild(el)
  })

  const dirty = await collectContrastFailures(page)
  expect(dirty.failures.map((f) => f.selector).join(' ')).toContain('contrast-probe-bait')
})
