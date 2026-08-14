// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/lib/i18n'
import { useAuthStore } from '@/stores/auth'

/**
 * The shell every admin screen renders inside: navigation, the signed-in
 * identity, and sign-out.
 *
 * Sign-out is the one action here that matters. It ends the server session,
 * clears the local one and leaves for the login page, and it has to do the
 * last two even when the first fails -- a console that stays signed in locally
 * after the operator pressed Logout is the wrong failure direction.
 *
 * Link and useMatchRoute need a router, so navigation is stubbed and the
 * layout's own logic still runs.
 */

const navigate = vi.fn()
const matchRoute = vi.fn((opts: { to: string }) => opts.to === '/users')

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => navigate,
  useMatchRoute: () => matchRoute,
  Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
  Outlet: () => <div>isi halaman</div>,
}))

const { Route } = await import('./_authenticated')

const ADMIN = { id: 'u-1', email: 'admin@bytz.id', name: 'Rina Admin', role: 'admin', locale: 'id' }

async function renderLayout() {
  const lazy = Route.options.component as unknown as { preload: () => Promise<unknown> }
  await lazy.preload()
  const Component = Route.options.component as () => React.ReactNode
  return render(<Component />)
}

beforeAll(async () => {
  await i18n.changeLanguage('id')
})

beforeEach(() => {
  navigate.mockClear()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({}) })),
  )
  useAuthStore.setState({
    isAuthenticated: true,
    isLoading: false,
    user: { ...ADMIN, role: 'admin', locale: 'id' },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('navigation', () => {
  it('links to every admin section', async () => {
    await renderLayout()

    for (const [name, href] of [
      ['Dashboard', '/dashboard'],
      ['Users', '/users'],
      ['Projects', '/projects'],
      ['Finance', '/finance'],
      ['Disputes', '/disputes'],
      ['Audit Log', '/audit-log'],
      ['Dead Letter Queue', '/dlq'],
      ['Settings', '/settings'],
    ] as const) {
      expect(screen.getByRole('link', { name }).getAttribute('href'), name).toBe(href)
    }
  })

  it('marks the section the operator is in', async () => {
    await renderLayout()

    // matchRoute is stubbed to claim /users.
    expect(screen.getByRole('link', { name: 'Users' }).className).toContain('text-success-500')
    expect(screen.getByRole('link', { name: 'Projects' }).className).not.toContain(
      'text-success-500',
    )
  })

  it('renders the routed page inside the shell', async () => {
    await renderLayout()

    expect(screen.getByText('isi halaman')).toBeDefined()
    expect(document.getElementById('main-content')).not.toBeNull()
  })
})

describe('identity', () => {
  it('shows the signed-in name and email', async () => {
    await renderLayout()

    expect(screen.getAllByText('Rina Admin').length).toBeGreaterThan(0)
    expect(screen.getByText('admin@bytz.id')).toBeDefined()
  })

  it('falls back to a placeholder identity when the store is empty', async () => {
    useAuthStore.setState({ user: null, isAuthenticated: true, isLoading: false })
    await renderLayout()

    expect(screen.getAllByText('Admin').length).toBeGreaterThan(0)
    // Avatar initial falls back rather than rendering "undefined".
    expect(screen.getByText('A')).toBeDefined()
  })

  it('uses the first letter of the name as the avatar', async () => {
    await renderLayout()

    expect(screen.getByText('R')).toBeDefined()
  })
})

describe('sign out', () => {
  it('ends the server session, clears the local one and leaves', async () => {
    const user = userEvent.setup()
    const spy = vi.fn(async () => ({ ok: true, json: async () => ({}) }))
    vi.stubGlobal('fetch', spy)
    await renderLayout()

    await user.click(screen.getByRole('button', { name: 'Keluar' }))

    await waitFor(() => expect(useAuthStore.getState().isAuthenticated).toBe(false))
    expect(spy).toHaveBeenCalledWith('/api/v1/auth/sign-out', {
      method: 'POST',
      credentials: 'include',
    })
    expect(navigate).toHaveBeenCalledWith({ to: '/' })
  })

  /** Staying signed in locally after a failed sign-out is the worse outcome. */
  it('still clears the session and leaves when the request fails', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )
    await renderLayout()

    await user.click(screen.getByRole('button', { name: 'Keluar' }))

    await waitFor(() => expect(useAuthStore.getState().isAuthenticated).toBe(false))
    expect(navigate).toHaveBeenCalledWith({ to: '/' })
  })
})

describe('mobile sidebar', () => {
  it('keeps the sidebar off-canvas until it is opened', async () => {
    const { container } = await renderLayout()

    expect(container.querySelector('aside')?.className).toContain('-translate-x-full')
    expect(screen.queryByRole('button', { name: 'Close sidebar' })).toBeDefined()
  })

  it('slides the sidebar in from the menu button', async () => {
    const user = userEvent.setup()
    const { container } = await renderLayout()

    await user.click(screen.getByRole('button', { name: 'Open menu' }))

    expect(container.querySelector('aside')?.className).toContain('translate-x-0')
  })

  it('closes again from the backdrop', async () => {
    const user = userEvent.setup()
    const { container } = await renderLayout()
    await user.click(screen.getByRole('button', { name: 'Open menu' }))

    // The backdrop is the first of the two controls sharing the label.
    await user.click(screen.getAllByRole('button', { name: 'Close sidebar' })[0])

    expect(container.querySelector('aside')?.className).toContain('-translate-x-full')
  })

  it('closes from the control inside the sidebar', async () => {
    const user = userEvent.setup()
    const { container } = await renderLayout()
    await user.click(screen.getByRole('button', { name: 'Open menu' }))

    const controls = screen.getAllByRole('button', { name: 'Close sidebar' })
    await user.click(controls[controls.length - 1])

    expect(container.querySelector('aside')?.className).toContain('-translate-x-full')
  })
})

/**
 * The mobile backdrop is a button, so a keyboard reaches it, and it answers to
 * Escape as well as to a click. The key is dispatched to a focused element
 * rather than typed, because user-event clicks before it types and a click
 * closes the sidebar on its own - which would pass whatever the handler did.
 */
describe('closing the sidebar from the keyboard', () => {
  async function openAndFocusBackdrop() {
    const user = userEvent.setup()
    const { container } = await renderLayout()
    await user.click(screen.getByRole('button', { name: 'Open menu' }))
    const backdrop = screen.getAllByRole('button', { name: 'Close sidebar' })[0]
    backdrop.focus()
    expect(container.querySelector('aside')?.className).toContain('translate-x-0')
    return { user, container }
  }

  it('closes on Escape', async () => {
    const { user, container } = await openAndFocusBackdrop()

    await user.keyboard('{Escape}')

    expect(container.querySelector('aside')?.className).toContain('-translate-x-full')
  })

  it('stays open on a key that is not Escape', async () => {
    const { user, container } = await openAndFocusBackdrop()

    await user.keyboard('{ArrowDown}')

    expect(container.querySelector('aside')?.className).not.toContain('-translate-x-full')
  })
})
