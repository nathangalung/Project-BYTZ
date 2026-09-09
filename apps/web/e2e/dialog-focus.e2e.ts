import { expect, type Locator, type Page, test } from '@playwright/test'
import { mockMilestoneBoard, mockShell, OWNER, PROJECT_ID, seedBrowser } from './support/app'

/**
 * Focus behaviour the browser is the only witness to.
 *
 * Two hand-rolled dialogs on this page had no focus management at all: the
 * milestone slide-over and the revision prompt. Component tests render class
 * names, so a trap that is not there looks the same as one that is. These
 * assert the contract aria-modal already promises.
 */

async function openBoard(page: Page) {
  await seedBrowser(page, { user: OWNER })
  await mockShell(page)
  await mockMilestoneBoard(page)
  await page.goto(`/projects/${PROJECT_ID}/milestones`)
  await expect(page.getByRole('heading', { name: 'Milestone Board' })).toBeVisible()
}

function submittedCard(page: Page): Locator {
  return page.getByRole('button').filter({ hasText: 'Bangun API' }).first()
}

async function activeElementIsInside(dialog: Locator): Promise<boolean> {
  return dialog.evaluate((node) => node.contains(document.activeElement))
}

test.describe('milestone slide-over', () => {
  test('announces itself as a dialog', async ({ page }) => {
    await openBoard(page)
    await submittedCard(page).click()
    await expect(page.getByRole('dialog', { name: 'Bangun API' })).toBeVisible()
  })

  test('moves focus into the panel when it opens', async ({ page }) => {
    await openBoard(page)
    await submittedCard(page).click()

    const dialog = page.getByRole('dialog', { name: 'Bangun API' })
    await expect(dialog).toBeVisible()
    expect(await activeElementIsInside(dialog)).toBe(true)
  })

  test('keeps Tab inside the panel', async ({ page }) => {
    await openBoard(page)
    await submittedCard(page).click()

    const dialog = page.getByRole('dialog', { name: 'Bangun API' })
    await expect(dialog).toBeVisible()

    for (let press = 0; press < 25; press++) {
      await page.keyboard.press('Tab')
      expect(await activeElementIsInside(dialog)).toBe(true)
    }
  })

  test('closes on Escape and gives focus back', async ({ page }) => {
    await openBoard(page)
    const trigger = submittedCard(page)
    await trigger.click()

    const dialog = page.getByRole('dialog', { name: 'Bangun API' })
    await expect(dialog).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(trigger).toBeFocused()
  })
})

test.describe('revision prompt', () => {
  async function openRevisionPrompt(page: Page) {
    await openBoard(page)
    await submittedCard(page).click()
    await page.getByRole('button', { name: 'Minta Revisi' }).click()
  }

  test('announces itself as a dialog', async ({ page }) => {
    await openRevisionPrompt(page)
    await expect(page.getByRole('dialog', { name: 'Minta Revisi' })).toBeVisible()
  })

  test('focuses the field the owner has to fill', async ({ page }) => {
    await openRevisionPrompt(page)
    // Confirm stays disabled without text
    await expect(page.getByRole('textbox')).toBeFocused()
  })

  test('keeps Tab inside the prompt', async ({ page }) => {
    await openRevisionPrompt(page)
    const dialog = page.getByRole('dialog', { name: 'Minta Revisi' })
    await expect(dialog).toBeVisible()

    for (let press = 0; press < 15; press++) {
      await page.keyboard.press('Tab')
      expect(await activeElementIsInside(dialog)).toBe(true)
    }
  })

  test('closes on Escape', async ({ page }) => {
    await openRevisionPrompt(page)
    const dialog = page.getByRole('dialog', { name: 'Minta Revisi' })
    await expect(dialog).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  })

  test('refuses an empty revision request', async ({ page }) => {
    await openRevisionPrompt(page)
    const confirm = page.getByRole('button', { name: 'Kirim permintaan revisi' })
    await expect(confirm).toBeDisabled()

    await page.getByRole('textbox').fill('Tombol checkout belum menampilkan total.')
    await expect(confirm).toBeEnabled()
  })
})
