// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/lib/i18n'
import { renderRoute } from '@/lib/testing/harness'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'

/**
 * The persistent way to reach a human at KerjaCUS.
 *
 * Mounted through the authenticated shell rather than on its own, because what
 * the button is for is being there on every page for both roles - and because
 * it navigates, which needs the router the shell is mounted inside anyway.
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

const { ApiError } = await import('@/lib/api')
const layoutRoute = await import('@/routes/_authenticated')

const OWNER = {
  id: 'u1',
  email: 'owner@kerjacus.id',
  name: 'Rina',
  role: 'owner' as const,
  locale: 'id' as const,
}
const TALENT = { ...OWNER, id: 'u2', name: 'Ari', role: 'talent' as const }

/**
 * `role` is widened to string on purpose. The store types it 'owner' | 'talent'
 * because those are the two roles the app is for, but an admin signed in
 * through the console shares the session cookie and hydrates here with role
 * 'admin' - which is exactly the case the button has to handle.
 */
type Caller = Omit<typeof OWNER, 'role'> & { role: string }

function signIn(user: Caller = OWNER) {
  useAuthStore.setState({
    user: user as typeof OWNER,
    isAuthenticated: true,
    isLoading: false,
  })
}

const DESTINATIONS = [
  '/talent',
  '/browse',
  '/projects',
  '/talent/projects',
  '/payments',
  '/messages',
  '/messages/$conversationId',
  '/notifications',
  '/settings',
  '/talent/profile',
  '/login',
]

function render() {
  return renderRoute(layoutRoute, {
    path: '/dashboard',
    entry: '/dashboard',
    destinations: DESTINATIONS,
  })
}

/** The unread badge is the shell's own call; everything else is the button's. */
let supportResponse: () => Promise<unknown> = async () => ({
  success: true,
  data: { id: 'c-1', projectId: 'p-1', type: 'admin_mediation', created: true, adminId: 'a-1' },
})

beforeEach(async () => {
  apiFetch.mockReset()
  apiFetch.mockImplementation(async (url: string) => {
    if (url.includes('/chat/conversations/support')) return await supportResponse()
    return { success: true, data: { count: 0 } }
  })
  supportResponse = async () => ({
    success: true,
    data: { id: 'c-1', projectId: 'p-1', type: 'admin_mediation', created: true, adminId: 'a-1' },
  })
  useToastStore.setState({ toasts: [] })
  await i18n.changeLanguage('en')
  signIn()
})

describe('the support control in the shell', () => {
  it('is there for an owner', async () => {
    await render()

    expect(screen.getByRole('button', { name: 'Contact Admin/Support' })).toBeDefined()
  })

  it('is there for a talent too', async () => {
    signIn(TALENT)

    await render()

    expect(screen.getByRole('button', { name: 'Contact Admin/Support' })).toBeDefined()
  })

  /**
   * An admin reaching the messages UI is the support side of the conversation.
   * A thread with themselves is the one request the endpoint cannot answer.
   */
  it('is not there for an admin', async () => {
    signIn({ ...OWNER, role: 'admin' })

    await render()

    expect(screen.queryByRole('button', { name: 'Contact Admin/Support' })).toBeNull()
  })

  /**
   * Asserted off the bundle rather than the DOM: renderRoute pins the language
   * to English so a mounted assertion could only ever read the English label.
   * i18n-keys.test.ts already fails on a key missing from a locale; this is
   * about the wording the product owner asked for, in the locale users get.
   */
  it('carries the Indonesian label the shell defaults to', () => {
    expect(i18n.getFixedT('id', 'common')('contact_support')).toBe('Hubungi Admin/Support')
    expect(i18n.getFixedT('en', 'common')('contact_support')).toBe('Contact Admin/Support')
  })
})

describe('pressing it', () => {
  it('asks the server for a room and opens it', async () => {
    const user = userEvent.setup()
    const { router } = await render()

    await user.click(screen.getByRole('button', { name: 'Contact Admin/Support' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/messages/c-1')
    })
    expect(apiFetch).toHaveBeenCalledWith(
      '/api/v1/chat/conversations/support',
      expect.objectContaining({ method: 'POST', body: '{}' }),
    )
  })

  /** Get-or-create: the second press lands in the same thread, not a new one. */
  it('opens the existing room when the server says it already had one', async () => {
    supportResponse = async () => ({
      success: true,
      data: {
        id: 'c-9',
        projectId: 'p-1',
        type: 'admin_mediation',
        created: false,
        adminId: 'a-1',
      },
    })
    const user = userEvent.setup()
    const { router } = await render()

    await user.click(screen.getByRole('button', { name: 'Contact Admin/Support' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/messages/c-9')
    })
  })

  /**
   * chat_conversations.project_id is NOT NULL, so someone party to no project
   * has nothing to hang a thread off. The localized message says what to do
   * about it, which is why it is shown rather than swallowed.
   */
  it('reports a refusal instead of navigating', async () => {
    supportResponse = async () => {
      throw new ApiError('No project yet', 409, 'SUPPORT_NO_PROJECT')
    }
    const user = userEvent.setup()
    const { router } = await render()

    await user.click(screen.getByRole('button', { name: 'Contact Admin/Support' }))

    await waitFor(() => {
      expect(useToastStore.getState().toasts).toHaveLength(1)
    })
    expect(useToastStore.getState().toasts[0]?.message).toBe('No project yet')
    expect(router.state.location.pathname).toBe('/dashboard')
  })

  it('reports a transport failure that carries no code', async () => {
    supportResponse = async () => {
      throw new Error('offline')
    }
    const user = userEvent.setup()
    await render()

    await user.click(screen.getByRole('button', { name: 'Contact Admin/Support' }))

    await waitFor(() => {
      expect(useToastStore.getState().toasts[0]?.message).toContain('offline')
    })
  })

  it('cannot be pressed twice while the first press is in flight', async () => {
    let release: (() => void) | undefined
    supportResponse = () =>
      new Promise((resolve) => {
        release = () =>
          resolve({
            success: true,
            data: {
              id: 'c-1',
              projectId: 'p-1',
              type: 'admin_mediation',
              created: true,
              adminId: null,
            },
          })
      })
    const user = userEvent.setup()
    await render()
    const button = screen.getByRole('button', { name: 'Contact Admin/Support' })

    await user.click(button)

    await waitFor(() => {
      expect((button as HTMLButtonElement).disabled).toBe(true)
    })
    release?.()
    await waitFor(() => {
      expect(apiFetch.mock.calls.filter((c) => String(c[0]).includes('support'))).toHaveLength(1)
    })
  })
})
