// @vitest-environment jsdom
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/lib/i18n'
import { renderRoute } from '@/lib/testing/harness'
import { useThemeStore } from '@/stores/theme'
import * as publicLayout from './_public'

/**
 * The chrome wrapped around every page a signed-out visitor can reach.
 *
 * It was never mounted, so the header, the footer and the skip-target landmark
 * they share went unexecuted. What this file decides is whether a visitor can
 * navigate at all, and whether assistive technology can skip past the nav to
 * the content.
 *
 * The harness registers the routes a test names as siblings rather than
 * children, so `<Outlet />` has nothing to render here. The layout's own job is
 * the chrome, and that is what is asserted.
 */

vi.setConfig({ testTimeout: 30_000 })

const DESTINATIONS = ['/request-project', '/browse-projects', '/about', '/login', '/register']

const render = () => renderRoute(publicLayout, { path: '/', destinations: DESTINATIONS })

beforeEach(async () => {
  useThemeStore.setState({ theme: 'light' })
  await i18n.changeLanguage('en')
})

describe('the shell', () => {
  it('puts a navigation, a main landmark and a footer around the page', async () => {
    const { container } = await render()

    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeDefined()
    expect(container.querySelector('main#main-content')).not.toBeNull()
    expect(container.querySelector('footer')).not.toBeNull()
  })

  it('leaves the main region empty for the page to fill', async () => {
    const { container } = await render()

    expect(container.querySelector('main#main-content')?.textContent).toBe('')
  })
})

describe('the header navigation', () => {
  it('offers every public destination', async () => {
    await render()

    const nav = screen.getByRole('navigation', { name: 'Main navigation' })
    const hrefs = within(nav)
      .getAllByRole('link')
      .map((a) => a.getAttribute('href'))
    for (const to of ['/', ...DESTINATIONS]) {
      expect(hrefs).toContain(to)
    }
  })

  it('underlines the section the visitor is on', async () => {
    await render()

    const home = screen
      .getAllByRole('link', { name: 'Home' })
      .find((a) => a.className.includes('rounded-lg')) as HTMLElement
    expect(home.className).toContain('text-brand-text')
  })

  it('switches the theme and offers the way back', async () => {
    const user = userEvent.setup()
    await render()

    await user.click(screen.getByRole('button', { name: 'Dark Mode' }))

    expect(useThemeStore.getState().theme).toBe('dark')
    expect(await screen.findByRole('button', { name: 'Light Mode' })).toBeDefined()
  })

  it('switches the language and offers the way back', async () => {
    const user = userEvent.setup()
    await render()

    await user.click(screen.getByRole('button', { name: 'Change language: Indonesia' }))
    expect(i18n.resolvedLanguage).toBe('id')

    await user.click(await screen.findByRole('button', { name: 'Ganti bahasa: English' }))
    expect(i18n.resolvedLanguage).toBe('en')
  })

  it('opens the mobile menu and closes it again', async () => {
    const user = userEvent.setup()
    await render()

    await user.click(screen.getByRole('button', { name: 'Open menu' }))
    expect(screen.getAllByRole('link', { name: 'Home' }).length).toBeGreaterThan(2)

    await user.click(screen.getByRole('button', { name: 'Close menu' }))
    expect(screen.getByRole('button', { name: 'Open menu' })).toBeDefined()
  })

  /** Sign In is hidden below the sm breakpoint, so the drawer has to carry it. */
  it('carries every destination plus sign-in inside the mobile menu', async () => {
    const user = userEvent.setup()
    await render()

    await user.click(screen.getByRole('button', { name: 'Open menu' }))

    const drawer = screen.getByRole('navigation', { name: 'Main navigation' })
      .lastElementChild as HTMLElement
    expect(
      within(drawer)
        .getAllByRole('link')
        .map((a) => a.getAttribute('href')),
    ).toEqual(['/', '/request-project', '/browse-projects', '/about', '/login'])
  })
})

describe('the footer', () => {
  it('repeats the public destinations and the current year', async () => {
    const { container } = await render()

    const footer = container.querySelector('footer') as HTMLElement
    const hrefs = within(footer)
      .getAllByRole('link')
      .map((a) => a.getAttribute('href'))
    expect(hrefs).toEqual(['/', ...DESTINATIONS])
    expect(footer.textContent).toContain(String(new Date().getFullYear()))
  })
})
