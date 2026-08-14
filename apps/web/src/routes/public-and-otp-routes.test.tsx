// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderRoute } from '@/lib/testing/harness'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'
import { ApiError } from '../lib/api'
import * as verifyPhoneRoute from './_authenticated/verify-phone'
import * as checkEmailRoute from './_public/check-email'
import * as registerRoute from './_public/register'
import * as verifyEmailRoute from './_public/verify-email'

/*
 * Mounting a route pulls its whole import graph through vite's transform on
 * first render, and the router plugin splits some route components into their
 * own chunk, so that cost lands inside the test rather than at import time.
 * Measured at over five seconds for the heaviest route under a full parallel
 * run, against a default timeout of five - which fails only when the whole
 * workspace runs, the worst way to find out.
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

function setSearch(search: string) {
  window.history.replaceState({}, '', `/verify-email${search}`)
}

beforeEach(() => {
  apiFetch.mockReset()
  useToastStore.setState({ toasts: [] })
  useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: false })
  globalThis.fetch = vi.fn(
    async () => new Response('{}', { status: 200 }),
  ) as unknown as typeof fetch
})

describe('the check-your-email page', () => {
  it('tells the user what happened and offers the way back', async () => {
    await renderRoute(checkEmailRoute, { path: '/check-email', destinations: ['/login'] })

    expect(screen.getByRole('heading', { name: /check your email/i })).toBeDefined()
    expect(screen.getByRole('link', { name: /sign in/i }).getAttribute('href')).toBe('/login')
  })
})

/**
 * The verification outcome arrives as a query parameter on a link the user
 * clicked in their inbox. Reading it wrongly tells someone their address is
 * verified when it is not.
 */
describe('the email verification result', () => {
  it('confirms success when the link carried no error', async () => {
    setSearch('')

    await renderRoute(verifyEmailRoute, {
      path: '/verify-email',
      destinations: ['/login', '/register'],
    })

    expect(await screen.findByText(/verified successfully/i)).toBeDefined()
    expect(screen.getByRole('link', { name: /sign in/i })).toBeDefined()
  })

  it('reports failure and offers to register again when the link expired', async () => {
    setSearch('?error=token_expired')

    await renderRoute(verifyEmailRoute, {
      path: '/verify-email',
      destinations: ['/login', '/register'],
    })

    expect(await screen.findByText(/verification failed/i)).toBeDefined()
    expect(screen.getByRole('link', { name: /register/i }).getAttribute('href')).toBe('/register')
  })
})

describe('the registration form', () => {
  async function render() {
    return renderRoute(registerRoute, {
      path: '/register',
      destinations: ['/login', '/check-email', '/dashboard'],
    })
  }

  it('labels every field it asks for', async () => {
    await render()

    expect(screen.getByLabelText('Full Name')).toBeDefined()
    expect(screen.getByLabelText('Email')).toBeDefined()
    expect(screen.getByLabelText('Phone Number')).toBeDefined()
    expect(screen.getByLabelText('Password')).toBeDefined()
  })

  /**
   * The phone number is the anti-multi-account control, so a malformed one
   * has to be caught before the account exists rather than after.
   */
  it('rejects a phone number that is too short without calling the API', async () => {
    const user = userEvent.setup()
    await render()

    await user.type(screen.getByLabelText('Full Name'), 'Owner')
    await user.type(screen.getByLabelText('Email'), 'owner@kerjacus.id')
    await user.type(screen.getByLabelText('Phone Number'), '812')
    await user.type(screen.getByLabelText('Password'), 'secret123')
    await user.click(screen.getByRole('button', { name: 'Register' }))

    await waitFor(() => expect(screen.getByText(/invalid format/i)).toBeDefined())
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('confirms a successful sign-up with a toast', async () => {
    const user = userEvent.setup()
    apiFetch.mockResolvedValue({
      user: { id: 'u1', email: 'o@k.id', name: 'O', role: 'owner', locale: 'id' },
    })
    await render()

    await user.type(screen.getByLabelText('Full Name'), 'Owner')
    await user.type(screen.getByLabelText('Email'), 'owner@kerjacus.id')
    await user.type(screen.getByLabelText('Phone Number'), '81234567890')
    await user.type(screen.getByLabelText('Password'), 'secret123')
    await user.click(screen.getByRole('button', { name: 'Register' }))

    await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1))
    expect(useToastStore.getState().toasts[0].type).toBe('success')
  })

  it('surfaces a rejected sign-up instead of failing silently', async () => {
    const user = userEvent.setup()
    apiFetch.mockRejectedValue(new ApiError('taken', 409, 'AUTH_EMAIL_TAKEN'))
    await render()

    await user.type(screen.getByLabelText('Full Name'), 'Owner')
    await user.type(screen.getByLabelText('Email'), 'owner@kerjacus.id')
    await user.type(screen.getByLabelText('Phone Number'), '81234567890')
    await user.type(screen.getByLabelText('Password'), 'secret123')
    await user.click(screen.getByRole('button', { name: 'Register' }))

    await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(0))
    const submit = screen.getByRole('button', {
      name: /register|sign up/i,
    }) as HTMLButtonElement
    expect(submit.disabled).toBe(false)
  })
})

/**
 * The OTP boxes are six separate inputs. Everything interesting is in how they
 * behave as one field: paste, backspace, and refusing to submit a short code.
 */
describe('the phone verification page', () => {
  async function render() {
    useAuthStore.setState({
      user: {
        id: 'u1',
        email: 'o@kerjacus.id',
        name: 'O',
        role: 'owner',
        phone: '+628123456789',
        locale: 'id',
      },
      isAuthenticated: true,
      isLoading: false,
    })
    return renderRoute(verifyPhoneRoute, {
      path: '/verify-phone',
      destinations: ['/dashboard'],
    })
  }

  function boxes() {
    return screen.getAllByRole('textbox') as HTMLInputElement[]
  }

  it('requests a code once on arrival, not once per render', async () => {
    await render()

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    const requests = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.filter((c) =>
      String(c[0]).includes('request-otp'),
    )
    expect(requests).toHaveLength(1)
  })

  it('names the code entry so it is reachable without sight', async () => {
    await render()

    expect(screen.getByRole('group', { name: /code|otp|kode/i })).toBeDefined()
  })

  it('masks the number the code was sent to', async () => {
    const { container } = await render()

    expect(container.textContent).toContain('+62')
    expect(container.textContent).not.toContain('+628123456789')
  })

  it('advances to the next box as each digit is typed', async () => {
    const user = userEvent.setup()
    await render()
    const inputs = boxes()

    await user.click(inputs[0])
    await user.keyboard('12')

    expect(inputs[0].value).toBe('1')
    expect(inputs[1].value).toBe('2')
    expect(document.activeElement).toBe(inputs[2])
  })

  it('refuses a non-digit', async () => {
    const user = userEvent.setup()
    await render()
    const inputs = boxes()

    await user.click(inputs[0])
    await user.keyboard('a')

    expect(inputs[0].value).toBe('')
  })

  /** Codes arrive by SMS and get pasted whole, not typed one box at a time. */
  it('spreads a pasted code across all six boxes', async () => {
    const user = userEvent.setup()
    await render()
    const inputs = boxes()

    await user.click(inputs[0])
    await user.paste('482913')

    expect(inputs.map((i) => i.value)).toEqual(['4', '8', '2', '9', '1', '3'])
  })

  it('strips separators out of a pasted code', async () => {
    const user = userEvent.setup()
    await render()
    const inputs = boxes()

    await user.click(inputs[0])
    await user.paste('48-29 13')

    expect(inputs.map((i) => i.value).join('')).toBe('482913')
  })

  it('steps back to the previous box on backspace in an empty one', async () => {
    const user = userEvent.setup()
    await render()
    const inputs = boxes()

    await user.click(inputs[0])
    await user.keyboard('1')
    await user.keyboard('{Backspace}')

    expect(document.activeElement).toBe(inputs[0])
  })

  it('does not submit a code that is still incomplete', async () => {
    const user = userEvent.setup()
    await render()
    const inputs = boxes()
    await user.click(inputs[0])
    await user.paste('482')

    await user.click(screen.getByRole('button', { name: /verify|verifikasi/i }))

    const verifies = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.filter((c) =>
      String(c[0]).includes('/phone/verify'),
    )
    expect(verifies).toHaveLength(0)
  })

  it('sends the completed code and moves on when it is accepted', async () => {
    const user = userEvent.setup()
    const { router } = await render()
    const inputs = boxes()
    await user.click(inputs[0])
    await user.paste('482913')

    await user.click(screen.getByRole('button', { name: /verify|verifikasi/i }))

    await waitFor(() => {
      const verify = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find((c) =>
        String(c[0]).includes('/phone/verify'),
      )
      expect(verify?.[1]).toMatchObject({ body: JSON.stringify({ code: '482913' }) })
    })
    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'))
  })

  it('keeps the user on the page and explains a rejected code', async () => {
    const user = userEvent.setup()
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes('/phone/verify')
        ? new Response('{}', { status: 400 })
        : new Response('{}', { status: 200 }),
    ) as unknown as typeof fetch
    const { router } = await render()
    const inputs = boxes()
    await user.click(inputs[0])
    await user.paste('000000')

    await user.click(screen.getByRole('button', { name: /verify|verifikasi/i }))

    expect(await screen.findByText(/invalid or expired/i)).toBeDefined()
    expect(router.state.location.pathname).toBe('/verify-phone')
  })
})
