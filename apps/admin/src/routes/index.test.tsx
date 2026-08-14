// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/lib/i18n'
import { useAuthStore } from '@/stores/auth'

/**
 * The admin console's front door. The sign-in endpoint is shared with the main
 * app, so it answers for owners and talents too: a successful response is not
 * on its own a reason to let somebody in. The role check after the 200 is the
 * part that matters, and it has to hold in both directions -- turn the account
 * away, and do not put it in the store on the way past.
 *
 * useNavigate needs a router. Only the navigation is stubbed, so the route's
 * own logic still runs.
 */

const navigate = vi.fn()

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => navigate,
}))

const { Route } = await import('./index')

const ADMIN = { id: 'u-1', email: 'admin@bytz.id', name: 'Admin', role: 'admin', locale: 'id' }
const OWNER = { id: 'u-2', email: 'budi@bytz.id', name: 'Budi', role: 'owner', locale: 'id' }

function stubSignIn(response: { ok?: boolean; body?: unknown; throws?: boolean }) {
  const spy = vi.fn(async () => {
    if (response.throws) throw new TypeError('Failed to fetch')
    return { ok: response.ok ?? true, json: async () => response.body }
  })
  vi.stubGlobal('fetch', spy)
  return spy
}

async function renderPage() {
  const lazy = Route.options.component as unknown as { preload: () => Promise<unknown> }
  await lazy.preload()
  const Component = Route.options.component as () => React.ReactNode
  return render(<Component />)
}

async function signIn(identifier = 'admin@bytz.id', password = 'rahasia') {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Email atau Nomor HP'), identifier)
  await user.type(screen.getByLabelText('Password'), password)
  await user.click(screen.getByRole('button', { name: 'Masuk' }))
  return user
}

beforeAll(async () => {
  await i18n.changeLanguage('id')
})

beforeEach(() => {
  navigate.mockClear()
  useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: false })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('login form', () => {
  it('renders both fields with visible labels', async () => {
    stubSignIn({ body: {} })
    await renderPage()

    expect(screen.getByRole('heading', { name: 'BYTZ Admin Panel' })).toBeDefined()
    expect(screen.getByText('Hanya untuk administrator BYTZ')).toBeDefined()
    expect(screen.getByLabelText('Email atau Nomor HP')).toBeDefined()
    expect(screen.getByLabelText('Password')).toBeDefined()
  })

  it('masks the password until the reveal is pressed', async () => {
    const user = userEvent.setup()
    stubSignIn({ body: {} })
    await renderPage()

    const field = screen.getByLabelText('Password')
    expect(field.getAttribute('type')).toBe('password')

    await user.click(screen.getByRole('button', { name: 'Show password' }))
    expect(screen.getByLabelText('Password').getAttribute('type')).toBe('text')

    await user.click(screen.getByRole('button', { name: 'Hide password' }))
    expect(screen.getByLabelText('Password').getAttribute('type')).toBe('password')
  })

  it('shows no error before anything is submitted', async () => {
    stubSignIn({ body: {} })
    await renderPage()

    expect(screen.queryByText('Email/nomor HP atau password salah')).toBeNull()
  })

  it('sends the credentials with the session cookie', async () => {
    const spy = stubSignIn({ body: { user: ADMIN } })
    await renderPage()

    await signIn('admin@bytz.id', 'rahasia')

    await waitFor(() => expect(spy).toHaveBeenCalled())
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/v1/auth/sign-in/email-or-phone')
    expect(init.credentials).toBe('include')
    expect(JSON.parse(String(init.body))).toEqual({
      identifier: 'admin@bytz.id',
      password: 'rahasia',
    })
  })
})

describe('successful admin sign-in', () => {
  it('stores the session and moves to the dashboard', async () => {
    stubSignIn({ body: { user: ADMIN } })
    await renderPage()

    await signIn()

    await waitFor(() => expect(useAuthStore.getState().isAuthenticated).toBe(true))
    expect(useAuthStore.getState().user?.email).toBe('admin@bytz.id')
    expect(navigate).toHaveBeenCalledWith({ to: '/dashboard' })
  })

  /** An already-signed-in admin should not be shown the form again. */
  it('redirects an established session straight through', async () => {
    stubSignIn({ body: {} })
    useAuthStore.setState({
      isAuthenticated: true,
      user: { ...ADMIN, role: 'admin', locale: 'id' },
    })
    await renderPage()

    expect(navigate).toHaveBeenCalledWith({ to: '/dashboard' })
    expect(screen.queryByLabelText('Email atau Nomor HP')).toBeNull()
  })
})

describe('rejected sign-in', () => {
  /**
   * The endpoint is shared with the main app, so a valid owner or talent
   * session is the expected case here, not a hypothetical one. It must not
   * reach the store and it must not navigate.
   */
  it.each([
    ['owner', OWNER],
    ['talent', { ...OWNER, role: 'talent' }],
  ])('turns a %s away without storing the session', async (_role, account) => {
    stubSignIn({ body: { user: account } })
    await renderPage()

    await signIn()

    expect(await screen.findByText('Akun ini bukan akun admin')).toBeDefined()
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
    expect(useAuthStore.getState().user).toBeNull()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('shows the server reason for a rejected credential', async () => {
    stubSignIn({ ok: false, body: { message: 'Akun terkunci sementara' } })
    await renderPage()

    await signIn()

    expect(await screen.findByText('Akun terkunci sementara')).toBeDefined()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('falls back to a generic message when the rejection carries no body', async () => {
    const spy = vi.fn(async () => ({
      ok: false,
      json: async () => {
        throw new SyntaxError('Unexpected end of JSON input')
      },
    }))
    vi.stubGlobal('fetch', spy)
    await renderPage()

    await signIn()

    expect(await screen.findByText('Email/nomor HP atau password salah')).toBeDefined()
  })

  it('reports a network failure rather than hanging on the spinner', async () => {
    stubSignIn({ throws: true })
    await renderPage()

    await signIn()

    expect(await screen.findByText('Gagal login. Coba lagi.')).toBeDefined()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Masuk' }).disabled).toBe(false)
  })

  /** A second attempt must not sit behind the first attempt's error. */
  it('clears the previous error when retried', async () => {
    const spy = vi.fn(async () => ({ ok: false, json: async () => ({ message: 'Salah' }) }))
    vi.stubGlobal('fetch', spy)
    await renderPage()
    await signIn()
    expect(await screen.findByText('Salah')).toBeDefined()

    spy.mockImplementation(async () => ({ ok: true, json: async () => ({ user: ADMIN }) }) as never)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Masuk' }))

    await waitFor(() => expect(screen.queryByText('Salah')).toBeNull())
  })
})
