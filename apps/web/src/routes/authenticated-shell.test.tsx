// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/lib/i18n'
import { renderRoute } from '@/lib/testing/harness'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import * as layoutRoute from './_authenticated'

/**
 * The shell every signed-in page renders inside.
 *
 * `authenticated-layout.test.ts` reads the source for the viewport rules and
 * `authenticated-guard.test.ts` calls beforeLoad as a function; neither ever
 * mounts the component, so the sidebar, the top bar and the role-dependent
 * navigation were all unexecuted. What they decide is which pages a user can
 * reach at all, and an owner shown a talent's menu is a broken product.
 */

vi.setConfig({ testTimeout: 30_000 })

const apiFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, apiFetch }
})
vi.mock('@/lib/centrifugo', () => ({
  connectCentrifugo: vi.fn(),
  disconnectCentrifugo: vi.fn(),
  subscribeTo: vi.fn(() => vi.fn()),
}))

const OWNER = {
  id: 'u1',
  email: 'owner@kerjacus.id',
  name: 'Rina',
  role: 'owner' as const,
  locale: 'id' as const,
}
const TALENT = { ...OWNER, id: 'u2', name: 'Ari', role: 'talent' as const }

function signIn(user: typeof OWNER | typeof TALENT = OWNER, avatarUrl?: string | null) {
  useAuthStore.setState({
    user: { ...user, ...(avatarUrl === undefined ? {} : { avatarUrl }) },
    isAuthenticated: true,
    isLoading: false,
  })
}

/** Only the unread badge reads the network from inside the shell. */
function stubUnread(count: number) {
  apiFetch.mockResolvedValue({ success: true, data: { count } })
}

const DESTINATIONS = [
  '/dashboard',
  '/talent',
  '/browse',
  '/projects',
  '/payments',
  '/messages',
  '/notifications',
  '/settings',
  '/talent/profile',
  '/login',
]

function render(entry = '/dashboard') {
  return renderRoute(layoutRoute, {
    path: '/dashboard',
    entry,
    destinations: DESTINATIONS.filter((d) => d !== '/dashboard'),
  })
}

beforeEach(async () => {
  apiFetch.mockReset()
  stubUnread(0)
  useThemeStore.setState({ theme: 'light' })
  await i18n.changeLanguage('en')
  signIn()
})

describe('the sidebar navigation', () => {
  it('sends an owner to the owner dashboard', async () => {
    await render()

    expect(screen.getByRole('link', { name: 'Overview' }).getAttribute('href')).toBe('/dashboard')
  })

  it('sends a talent to their own home instead', async () => {
    signIn(TALENT)

    await render()

    expect(screen.getByRole('link', { name: 'Overview' }).getAttribute('href')).toBe('/talent')
  })

  it('offers My Projects to an owner only', async () => {
    await render()

    expect(screen.getByRole('link', { name: /my projects/i })).toBeDefined()
  })

  it('withholds My Projects from a talent', async () => {
    signIn(TALENT)

    await render()

    expect(screen.queryByRole('link', { name: /my projects/i })).toBeNull()
  })

  it('names the panel after the owner role', async () => {
    await render()

    expect(screen.getByText('Project Owner Panel')).toBeDefined()
  })

  it('names the panel after the talent role', async () => {
    signIn(TALENT)

    await render()

    expect(screen.getByText('Talent Panel')).toBeDefined()
  })

  it('marks the current section as the active one', async () => {
    await render()

    const active = screen.getByRole('link', { name: 'Overview' })
    expect(active.className).toContain('bg-white/15')
    expect(screen.getByRole('link', { name: 'Messages' }).className).toContain('text-white/60')
  })

  it('signs the user out and returns them to the login page', async () => {
    const user = userEvent.setup()
    const { router } = await render()

    await user.click(screen.getByRole('button', { name: 'Sign Out' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })
})

/** The sidebar is off-canvas on mobile and the only way back to navigation. */
describe('opening and closing the sidebar on a small screen', () => {
  async function open() {
    const user = userEvent.setup()
    const result = await render()
    const aside = result.container.querySelector('aside') as HTMLElement
    expect(aside.className).toContain('-translate-x-full')
    await user.click(screen.getByRole('button', { name: /open menu/i }))
    expect(aside.className).toContain('translate-x-0')
    return { user, aside }
  }

  it('opens from the menu button', async () => {
    await open()
  })

  it('closes from the backdrop', async () => {
    const { user, aside } = await open()

    await user.click(screen.getAllByRole('button', { name: /close sidebar/i })[0])

    expect(aside.className).toContain('-translate-x-full')
  })

  it('closes from the control inside the panel', async () => {
    const { user, aside } = await open()

    const controls = screen.getAllByRole('button', { name: /close sidebar/i })
    await user.click(controls[controls.length - 1])

    expect(aside.className).toContain('-translate-x-full')
  })

  /**
   * The key is dispatched to a focused element rather than typed, because
   * user-event clicks before it types and a click on the backdrop closes the
   * sidebar on its own - which would pass whatever the handler did.
   */
  it('closes on Escape from the backdrop', async () => {
    const { user, aside } = await open()
    const backdrop = screen.getAllByRole('button', { name: /close sidebar/i })[0]
    backdrop.focus()

    await user.keyboard('{Escape}')

    expect(aside.className).toContain('-translate-x-full')
  })

  it('stays open on a key that is not Escape', async () => {
    const { user, aside } = await open()
    const backdrop = screen.getAllByRole('button', { name: /close sidebar/i })[0]
    backdrop.focus()

    await user.keyboard('{ArrowDown}')

    expect(aside.className).toContain('translate-x-0')
  })
})

describe('the top bar', () => {
  it('switches the theme and offers the way back', async () => {
    const user = userEvent.setup()
    await render()

    await user.click(screen.getByRole('button', { name: /dark mode|mode gelap/i }))

    expect(useThemeStore.getState().theme).toBe('dark')
    expect(await screen.findByRole('button', { name: /light mode|mode terang/i })).toBeDefined()
  })

  /** The harness pins the language to English, so the control offers ID first. */
  it('switches the language and offers the way back', async () => {
    const user = userEvent.setup()
    await render()

    await user.click(screen.getByRole('button', { name: 'ID' }))
    await waitFor(() => expect(i18n.resolvedLanguage).toBe('id'))

    await user.click(await screen.findByRole('button', { name: 'EN' }))
    await waitFor(() => expect(i18n.resolvedLanguage).toBe('en'))
  })

  it('shows no unread badge when there is nothing to read', async () => {
    stubUnread(0)

    await render()

    const bell = screen.getByRole('link', { name: /notifications|notifikasi/i })
    expect(within(bell).queryByText(/^\d+$/)).toBeNull()
  })

  it('shows the exact unread count below the cap', async () => {
    stubUnread(7)

    await render()

    expect(await screen.findByText('7')).toBeDefined()
  })

  it('caps the unread badge at 99+', async () => {
    stubUnread(150)

    await render()

    expect(await screen.findByText('99+')).toBeDefined()
  })

  it('sends an owner to settings and a talent to their profile', async () => {
    await render()
    expect(screen.getAllByRole('link').some((l) => l.getAttribute('href') === '/settings')).toBe(
      true,
    )

    signIn(TALENT)
    await render()
    expect(
      screen.getAllByRole('link').some((l) => l.getAttribute('href') === '/talent/profile'),
    ).toBe(true)
  })

  it('shows the uploaded avatar when there is one', async () => {
    signIn(OWNER, 'https://cdn.example/rina.png')

    const { container } = await render()

    const img = container.querySelector('img[alt="Rina"]') as HTMLImageElement
    expect(img.src).toBe('https://cdn.example/rina.png')
  })

  it('falls back to the initial of the name', async () => {
    signIn(OWNER, null)

    await render()

    expect(screen.getByText('R')).toBeDefined()
  })

  it('falls back to U for an account with no name', async () => {
    useAuthStore.setState({
      user: { ...OWNER, name: '', avatarUrl: null },
      isAuthenticated: true,
      isLoading: false,
    })

    await render()

    expect(screen.getByText('U')).toBeDefined()
  })
})

/**
 * Talent registration is a full-screen flow: the shell would put a sidebar
 * pointing at pages the account cannot use yet around a form it has to finish.
 */
describe('the full-screen registration route', () => {
  it('drops the sidebar and the top bar', async () => {
    signIn(TALENT)

    const { container } = await renderRoute(layoutRoute, {
      path: '/talent/register',
      destinations: DESTINATIONS,
    })

    expect(container.querySelector('aside')).toBeNull()
    expect(screen.queryByRole('button', { name: /open menu/i })).toBeNull()
  })
})
