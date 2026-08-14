// @vitest-environment jsdom
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/lib/i18n'
import { useThemeStore } from '@/stores/theme'
import { PublicHeader } from './public-header'

/**
 * The theme store reads the OS colour-scheme preference at import time, and
 * this jsdom build ships no matchMedia. Hoisted so it is in place before the
 * store module is evaluated rather than after.
 */
vi.hoisted(() => {
  if (typeof window !== 'undefined' && !window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia
  }
})

beforeAll(async () => {
  await i18n.changeLanguage('id')
})

beforeEach(() => {
  useThemeStore.getState().setTheme('light')
})

afterEach(async () => {
  await i18n.changeLanguage('id')
})

const PATHS = ['/', '/about', '/login', '/register', '/request-project', '/browse-projects']

function renderHeaderAt(path: string) {
  const rootRoute = createRootRoute({ component: () => <PublicHeader /> })
  const router = createRouter({
    routeTree: rootRoute.addChildren(
      PATHS.map((p) =>
        createRoute({ getParentRoute: () => rootRoute, path: p, component: () => null }),
      ),
    ),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  return render(<RouterProvider router={router} />)
}

/** Waits for the router's first render before querying. */
async function renderReadyHeaderAt(path: string) {
  const result = renderHeaderAt(path)
  await screen.findByRole('navigation', { name: 'Main navigation' })
  return result
}

describe('PublicHeader', () => {
  it('is a named navigation landmark', async () => {
    await renderReadyHeaderAt('/')

    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeDefined()
  })

  it.each([
    ['Beranda', '/'],
    ['Ajukan Proyek', '/request-project'],
    ['Jelajahi Proyek', '/browse-projects'],
    ['Tentang Kami', '/about'],
  ])('links %s to %s', async (name, href) => {
    await renderReadyHeaderAt('/')

    expect(screen.getByRole('link', { name }).getAttribute('href')).toBe(href)
  })

  describe('the active route marker', () => {
    /**
     * The underline is the only signal of where the user is, and it is driven
     * by a real route match. A mocked matchRoute would only prove the mock.
     */
    it('marks the page being viewed', async () => {
      await renderReadyHeaderAt('/about')

      expect(screen.getByRole('link', { name: 'Tentang Kami' }).className).toContain(
        'text-primary-600',
      )
    })

    it('leaves the other entries unmarked', async () => {
      await renderReadyHeaderAt('/about')

      expect(screen.getByRole('link', { name: 'Jelajahi Proyek' }).className).toContain(
        'text-on-surface-muted',
      )
    })

    /**
     * Home is matched exactly. Every path starts with "/", so a fuzzy match
     * there would light up Home on every page in the site.
     */
    it('does not light up home from another page', async () => {
      await renderReadyHeaderAt('/about')

      expect(screen.getByRole('link', { name: 'Beranda' }).className).toContain(
        'text-on-surface-muted',
      )
    })

    it('lights up home on home', async () => {
      await renderReadyHeaderAt('/')

      expect(screen.getByRole('link', { name: 'Beranda' }).className).toContain('text-primary-600')
    })
  })

  describe('the theme toggle', () => {
    /**
     * The control is icon-only, so its accessible name is the only thing that
     * says what it does - and it has to name the destination rather than the
     * current state, or the user is told the opposite of what pressing it does.
     */
    it('names the theme it switches to', async () => {
      await renderReadyHeaderAt('/')

      expect(screen.getByRole('button', { name: 'Mode Gelap' })).toBeDefined()
    })

    it('switches the theme and renames itself', async () => {
      const user = userEvent.setup()
      await renderReadyHeaderAt('/')

      await user.click(screen.getByRole('button', { name: 'Mode Gelap' }))

      expect(useThemeStore.getState().theme).toBe('dark')
      expect(screen.getByRole('button', { name: 'Mode Terang' })).toBeDefined()
    })

    it('puts the dark class on the document root', async () => {
      const user = userEvent.setup()
      await renderReadyHeaderAt('/')

      await user.click(screen.getByRole('button', { name: 'Mode Gelap' }))

      expect(document.documentElement.classList.contains('dark')).toBe(true)
    })
  })

  describe('the language toggle', () => {
    it('names both the action and the language it switches to', async () => {
      await renderReadyHeaderAt('/')

      expect(screen.getByRole('button', { name: 'Ganti bahasa: English' })).toBeDefined()
    })

    it('switches the interface language', async () => {
      const user = userEvent.setup()
      await renderReadyHeaderAt('/')

      await user.click(screen.getByRole('button', { name: 'Ganti bahasa: English' }))

      expect(i18n.resolvedLanguage).toBe('en')
      expect(await screen.findByRole('link', { name: 'About Us' })).toBeDefined()
    })
  })

  describe('the mobile menu', () => {
    it('starts closed', async () => {
      await renderReadyHeaderAt('/')

      expect(screen.getByRole('button', { name: 'Buka menu' })).toBeDefined()
      // Desktop and mobile each render their own copy once open.
      expect(screen.getAllByRole('link', { name: 'Tentang Kami' })).toHaveLength(1)
    })

    it('opens on press and renames the control', async () => {
      const user = userEvent.setup()
      await renderReadyHeaderAt('/')

      await user.click(screen.getByRole('button', { name: 'Buka menu' }))

      expect(screen.getByRole('button', { name: 'Tutup menu' })).toBeDefined()
      expect(screen.getAllByRole('link', { name: 'Tentang Kami' })).toHaveLength(2)
    })

    it('closes again on a second press', async () => {
      const user = userEvent.setup()
      await renderReadyHeaderAt('/')

      await user.click(screen.getByRole('button', { name: 'Buka menu' }))
      await user.click(screen.getByRole('button', { name: 'Tutup menu' }))

      expect(screen.getAllByRole('link', { name: 'Tentang Kami' })).toHaveLength(1)
    })

    /**
     * Navigating from the mobile menu has to close it, or the overlay stays
     * over the page the user just asked for.
     */
    it('closes when one of its links is followed', async () => {
      const user = userEvent.setup()
      await renderReadyHeaderAt('/')
      await user.click(screen.getByRole('button', { name: 'Buka menu' }))

      const mobileLink = screen.getAllByRole('link', { name: 'Tentang Kami' })[1]
      await user.click(mobileLink)

      expect(screen.getByRole('button', { name: 'Buka menu' })).toBeDefined()
      expect(screen.getAllByRole('link', { name: 'Tentang Kami' })).toHaveLength(1)
    })
  })

  it('offers sign in and sign up', async () => {
    await renderReadyHeaderAt('/')

    expect(screen.getByRole('link', { name: 'Masuk' }).getAttribute('href')).toBe('/login')
    expect(screen.getByRole('link', { name: 'Daftar' }).getAttribute('href')).toBe('/register')
  })
})
