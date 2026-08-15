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

  /**
   * A dropped connection is not a rejected code, but the user has to be told
   * something. Without the catch the promise rejects unhandled, the spinner
   * never clears, and the page sits there looking like it is still checking.
   */
  it('explains a verification that never reached the server', async () => {
    const user = userEvent.setup()
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/phone/verify')) throw new TypeError('Failed to fetch')
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch
    await render()
    const inputs = boxes()
    await user.click(inputs[0])
    await user.paste('482913')

    await user.click(screen.getByRole('button', { name: /verify|verifikasi/i }))

    expect(await screen.findByText(/invalid or expired/i)).toBeDefined()
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: /verify|verifikasi/i }).disabled,
    ).toBe(false)
  })

  /**
   * Not covered: `if (code.length !== OTP_LENGTH) return` in handleSubmit.
   *
   * A test that types a short code and presses Enter passes with the guard
   * deleted, so it asserts nothing. The reason is the HTML spec: implicit
   * submission is suppressed when the form's default button is disabled, and
   * this one is disabled below six digits. The submit handler is therefore
   * unreachable with a short code, and the guard is dead defensively.
   */

  /** The last box has nowhere to advance to; moving on would wrap to the start. */
  it('keeps focus in the final box once it is filled', async () => {
    const user = userEvent.setup()
    await render()
    const inputs = boxes()

    await user.click(inputs[5])
    await user.keyboard('9')

    expect(inputs[5].value).toBe('9')
    expect(document.activeElement).toBe(inputs[5])
  })
})

/**
 * The rest of the sign-up form.
 *
 * Role decides which onboarding the account lands in, and a talent sent to the
 * owner dashboard never completes the CV step that makes them matchable. The
 * reveal is the only way to check a password before committing to it.
 */
describe('choosing a role and revealing the password', () => {
  async function render() {
    return renderRoute(registerRoute, {
      path: '/register',
      destinations: ['/login', '/dashboard', '/talent/register'],
    })
  }

  async function fill(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText('Full Name'), 'Owner')
    await user.type(screen.getByLabelText('Email'), 'owner@kerjacus.id')
    await user.type(screen.getByLabelText('Phone Number'), '81234567890')
    await user.type(screen.getByLabelText('Password'), 'secret123')
  }

  it('reveals the password and offers to hide it again', async () => {
    const user = userEvent.setup()
    await render()
    const field = screen.getByLabelText('Password') as HTMLInputElement
    expect(field.type).toBe('password')

    await user.click(screen.getByRole('button', { name: 'Show password' }))
    expect((screen.getByLabelText('Password') as HTMLInputElement).type).toBe('text')

    await user.click(screen.getByRole('button', { name: 'Hide password' }))
    expect((screen.getByLabelText('Password') as HTMLInputElement).type).toBe('password')
  })

  it('sends an owner to the owner dashboard', async () => {
    const user = userEvent.setup()
    apiFetch.mockResolvedValue({
      user: { id: 'u1', email: 'o@k.id', name: 'O', role: 'owner', locale: 'id' },
    })
    const { router } = await render()

    await fill(user)
    await user.click(screen.getByRole('button', { name: 'Register' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'))
  })

  it('sends a talent to the CV step rather than the owner dashboard', async () => {
    const user = userEvent.setup()
    apiFetch.mockResolvedValue({
      user: { id: 'u2', email: 't@k.id', name: 'T', role: 'talent', locale: 'id' },
    })
    const { router } = await render()

    await fill(user)
    await user.click(screen.getByRole('button', { name: 'Talent' }))
    await user.click(screen.getByRole('button', { name: 'Register' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/talent/register'))
    const body = String((apiFetch.mock.calls[0][1] as RequestInit).body)
    expect(body).toContain('talent')
  })

  it('marks the chosen role and unmarks the other', async () => {
    const user = userEvent.setup()
    await render()
    const owner = screen.getByRole('button', { name: 'Project Owner' })
    const talent = screen.getByRole('button', { name: 'Talent' })
    expect(owner.className).toContain('bg-primary-600')

    await user.click(talent)

    expect(talent.className).toContain('bg-primary-600')
    expect(owner.className).not.toContain('bg-primary-600')

    await user.click(owner)

    expect(owner.className).toContain('bg-primary-600')
    expect(talent.className).not.toContain('bg-primary-600')
  })

  /** An unmapped API code must still say something the user can act on. */
  it('falls back to a generic message for an error code it does not map', async () => {
    const user = userEvent.setup()
    apiFetch.mockRejectedValue(new ApiError('nope', 500, 'AUTH_UNKNOWN_THING'))
    await render()

    await fill(user)
    await user.click(screen.getByRole('button', { name: 'Register' }))

    expect(await screen.findByText(/could not|failed|try again/i)).toBeDefined()
  })

  it('falls back to a generic message when the failure is not an ApiError', async () => {
    const user = userEvent.setup()
    apiFetch.mockRejectedValue(new TypeError('Failed to fetch'))
    await render()

    await fill(user)
    await user.click(screen.getByRole('button', { name: 'Register' }))

    expect(await screen.findByText(/could not|failed|try again/i)).toBeDefined()
  })
})

/**
 * The parts of phone verification around the six boxes.
 *
 * The cooldown is what stops an accidental double-tap sending two SMS, the
 * dev code is a development affordance that must never appear in a build, and
 * the mask is the only confirmation the user has that the code went to the
 * right number.
 */
describe('requesting and re-requesting the code', () => {
  function signIn(phone: string | null = '+628123456789') {
    useAuthStore.setState({
      user: { id: 'u1', email: 'o@kerjacus.id', name: 'O', role: 'owner', phone, locale: 'id' },
      isAuthenticated: true,
      isLoading: false,
    })
  }

  function stubOtp(body: unknown, ok = true) {
    const spy = vi.fn(async () => new Response(JSON.stringify(body), { status: ok ? 200 : 400 }))
    globalThis.fetch = spy as unknown as typeof fetch
    return spy
  }

  async function render() {
    return renderRoute(verifyPhoneRoute, { path: '/verify-phone', destinations: ['/dashboard'] })
  }

  it('masks the middle of the number it sent the code to', async () => {
    signIn()
    stubOtp({})

    await render()

    expect(await screen.findByText(/\+62812\*+789|\+6281\*+789/)).toBeDefined()
  })

  it('falls back to a placeholder when the account has no number', async () => {
    signIn(null)
    stubOtp({})

    await render()

    expect(await screen.findByText('+62***')).toBeDefined()
  })

  it('leaves a number too short to mask alone', async () => {
    signIn('+62812')
    stubOtp({})

    await render()

    expect(await screen.findByText('+62812')).toBeDefined()
  })

  /**
   * Records a defect rather than endorsing it. `if (res.ok)` has no else, so a
   * rejected request sets neither a success nor an error: the user is left on
   * a page with no code and nothing said. Only the network throwing reaches
   * the catch. When that is fixed this will fail, which is the point.
   */
  it('says nothing at all when the server rejects the request', async () => {
    signIn()
    stubOtp({ error: { message: 'Too many requests' } }, false)

    await render()

    await waitFor(() => expect(screen.queryByText('OTP code has been sent')).toBeNull())
    expect(screen.queryByText('Invalid or expired OTP code')).toBeNull()
  })

  it('reports a request the network never completed', async () => {
    signIn()
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch

    await render()

    expect(await screen.findByText('Invalid or expired OTP code')).toBeDefined()
  })

  /** A dev build echoes the code back; it must be visible only in dev. */
  it('shows the development code when the server echoes one', async () => {
    signIn()
    stubOtp({ otp: '123456' })

    await render()

    if (import.meta.env.DEV) {
      expect(await screen.findByText('123456')).toBeDefined()
    } else {
      await waitFor(() => expect(screen.queryByText('123456')).toBeNull())
    }
  })

  it('refuses to submit a code that is not six digits long', async () => {
    signIn()
    const spy = stubOtp({})
    await render()
    await waitFor(() => expect(spy).toHaveBeenCalled())
    const before = spy.mock.calls.length

    const user = userEvent.setup()
    const inputs = screen.getAllByRole('textbox') as HTMLInputElement[]
    await user.type(inputs[0], '1')
    await user.click(screen.getByRole('button', { name: /verify|verifikasi/i }))

    expect(spy.mock.calls.length).toBe(before)
  })

  /**
   * The resend control is disabled for a minute after a send. Without the
   * countdown the owner sees a dead button and no reason for it.
   */
  it('counts the cooldown down and re-enables the resend', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      signIn()
      stubOtp({})
      await render()

      const resend = await screen.findByRole('button', { name: /60|resend|kirim ulang/i })
      expect((resend as HTMLButtonElement).disabled).toBe(true)

      await vi.advanceTimersByTimeAsync(61_000)

      await waitFor(() => {
        const after = screen.getByRole('button', { name: /resend|kirim ulang/i })
        expect((after as HTMLButtonElement).disabled).toBe(false)
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('ignores a paste that carries no digits', async () => {
    signIn()
    stubOtp({})
    await render()
    const inputs = screen.getAllByRole('textbox') as HTMLInputElement[]

    const user = userEvent.setup()
    await user.click(inputs[0])
    await user.paste('no digits here')

    expect(inputs.map((i) => i.value).join('')).toBe('')
  })
})
