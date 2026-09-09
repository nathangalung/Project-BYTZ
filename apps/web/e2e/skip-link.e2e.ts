import { expect, type Locator, test } from '@playwright/test'
import { mockMilestoneBoard, mockShell, OWNER, PROJECT_ID, seedBrowser } from './support/app'

/** Fails loudly on an unrendered node. */
async function boxOf(locator: Locator) {
  const box = await locator.boundingBox()
  if (!box) throw new Error('element has no box')
  return box
}

/**
 * The link only works if it can be seen.
 *
 * It used to reveal itself from inline onfocus/onblur handlers, which CSP
 * rejects, so it sat at translateY(-200px) as the first thing Tab reached:
 * present in the DOM, invisible on screen. The :focus rule that replaced them
 * lives in index.html and nothing guarded it.
 */
test.describe('skip to content', () => {
  test('is the first stop and becomes visible there', async ({ page }) => {
    await seedBrowser(page)
    await page.goto('/')

    await page.keyboard.press('Tab')

    const link = page.locator('a.skip-to-content')
    await expect(link).toBeFocused()

    const box = await boxOf(link)
    // Off-screen is the bug it had
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.height).toBeGreaterThan(0)
  })

  test('parks itself off-screen until focused', async ({ page }) => {
    await seedBrowser(page)
    await page.goto('/')

    const box = await boxOf(page.locator('a.skip-to-content'))
    expect(box.y + box.height).toBeLessThan(0)
  })

  test('lands on the main landmark', async ({ page }) => {
    await seedBrowser(page)
    await page.goto('/')

    await page.keyboard.press('Tab')
    await page.keyboard.press('Enter')

    await expect(page).toHaveURL(/#main-content$/)
    await expect(page.locator('main#main-content')).toBeVisible()
  })

  test('is present on the authenticated shell too', async ({ page }) => {
    await seedBrowser(page, { user: OWNER })
    await mockShell(page)
    await mockMilestoneBoard(page)
    await page.goto(`/projects/${PROJECT_ID}/milestones`)

    await expect(page.locator('main#main-content')).toBeVisible()
    await page.keyboard.press('Tab')
    await expect(page.locator('a.skip-to-content')).toBeFocused()
  })
})
