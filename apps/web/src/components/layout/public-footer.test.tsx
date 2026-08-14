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
import { PublicFooter } from './public-footer'

beforeAll(async () => {
  await i18n.changeLanguage('id')
})

const PATHS = ['/', '/about', '/login', '/register', '/request-project', '/browse-projects']

/**
 * A real memory router rather than a mocked Link, so a `to` that no longer
 * resolves fails here instead of rendering a dead anchor the test still finds.
 */
function renderFooter() {
  const rootRoute = createRootRoute({ component: () => <PublicFooter /> })
  const router = createRouter({
    routeTree: rootRoute.addChildren(
      PATHS.map((path) =>
        createRoute({ getParentRoute: () => rootRoute, path, component: () => null }),
      ),
    ),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  return render(<RouterProvider router={router} />)
}

describe('PublicFooter', () => {
  it('is a footer landmark', async () => {
    const { container } = renderFooter()

    await screen.findByRole('navigation')
    expect(container.querySelector('footer')).not.toBeNull()
  })

  it('groups its links in a navigation landmark', async () => {
    renderFooter()

    expect(await screen.findByRole('navigation')).toBeDefined()
  })

  it.each([
    ['Beranda', '/'],
    ['Ajukan Proyek', '/request-project'],
    ['Jelajahi Proyek', '/browse-projects'],
    ['Tentang Kami', '/about'],
    ['Masuk', '/login'],
    ['Daftar', '/register'],
  ])('links %s to %s', async (name, href) => {
    renderFooter()

    const link = await screen.findByRole('link', { name })
    expect(link.getAttribute('href')).toBe(href)
  })

  it('describes the platform', async () => {
    renderFooter()

    await screen.findByRole('navigation')
    expect(screen.getByText(/managed marketplace/i)).toBeDefined()
  })

  /**
   * The year is computed rather than written into the copy, so it cannot go
   * stale in January. Pinning it against the clock is what proves that.
   */
  it('dates the copyright from the current year', async () => {
    renderFooter()

    await screen.findByRole('navigation')
    expect(screen.getByText(`© ${String(new Date().getFullYear())} KerjaCUS!`)).toBeDefined()
  })

  /**
   * Terms and privacy are rendered as plain text, not links. They read as
   * navigation and are not reachable by keyboard or screen reader as such,
   * which is a gap worth failing on the day someone wires them up wrongly.
   */
  it('renders terms and privacy as text rather than links', async () => {
    renderFooter()

    await screen.findByRole('navigation')
    expect(screen.getByText('Syarat dan Ketentuan').tagName).toBe('SPAN')
    expect(screen.queryByRole('link', { name: 'Kebijakan Privasi' })).toBeNull()
  })
})
