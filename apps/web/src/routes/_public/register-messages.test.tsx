// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api'
import { renderRoute } from '@/lib/testing/harness'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'
import * as registerRoute from './register'

/**
 * What the register form says, per reason it was refused.
 *
 * The form has one error line and six ways to fill it, and it used to render
 * "Gagal mendaftar. Coba lagi." for five of them - including the duplicate
 * email, which it had precise copy for. Two things caused that: auth-service
 * forwarded Better Auth's `{ code, message }` body, which apiFetch cannot read
 * (it reads `error.code`), so the code arrived as UNKNOWN_ERROR; and the phone
 * duplicate answered the generic CONFLICT, which this page read as the phone
 * case only because sign-up happened to emit no other 409.
 *
 * Each case below is the code auth-service now returns for that reason. If the
 * two drift apart again, the message goes generic and these fail.
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

beforeEach(() => {
  apiFetch.mockReset()
  useToastStore.setState({ toasts: [] })
  useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: false })
})

function render() {
  return renderRoute(registerRoute, {
    path: '/register',
    destinations: ['/login', '/dashboard', '/talent/register', '/check-email'],
  })
}

async function fillAndSubmit(overrides: { phone?: string } = {}) {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Full Name'), 'Budi')
  await user.type(screen.getByLabelText('Email'), 'budi@kerjacus.id')
  await user.type(screen.getByLabelText('Phone Number'), overrides.phone ?? '81234567890')
  await user.type(screen.getByLabelText('Password'), 'password123')
  await user.click(screen.getByRole('button', { name: 'Register' }))
}

describe('a registration that succeeds', () => {
  it('signs the owner in and says so', async () => {
    apiFetch.mockResolvedValue({
      token: 'sess-1',
      user: { id: 'u1', email: 'budi@kerjacus.id', name: 'Budi', role: 'owner', locale: 'id' },
    })
    const { router } = await render()

    await fillAndSubmit()

    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'))
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
    expect(useToastStore.getState().toasts[0]?.message).toBe('Account created successfully!')
  })

  /**
   * No token means verification is required and there is no session yet.
   * Sending them to an authenticated route would bounce them to /login, which
   * reads as a sign-up that failed.
   */
  it('sends an account that still has to verify its email to check-email', async () => {
    apiFetch.mockResolvedValue({
      token: null,
      user: { id: 'u1', email: 'budi@kerjacus.id', name: 'Budi', role: 'owner', locale: 'id' },
    })
    const { router } = await render()

    await fillAndSubmit()

    await waitFor(() => expect(router.state.location.pathname).toBe('/check-email'))
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })
})

describe('a registration that is refused', () => {
  const REFUSALS = [
    {
      name: 'the email is already registered',
      error: new ApiError('taken', 409, 'AUTH_EMAIL_ALREADY_EXISTS'),
      copy: 'Email already registered',
    },
    {
      name: 'the phone number is already registered',
      error: new ApiError('taken', 409, 'AUTH_PHONE_ALREADY_EXISTS'),
      copy: 'Phone number already registered',
    },
    {
      name: 'the phone number is not a valid Indonesian one',
      error: new ApiError('bad', 400, 'AUTH_INVALID_PHONE'),
      copy: 'Invalid format. Use +62 followed by 9-13 digits',
    },
    {
      name: 'the role is not one of the two on offer',
      error: new ApiError('bad', 400, 'AUTH_INVALID_ROLE'),
      copy: 'Invalid role. Choose Project Owner or Talent',
    },
    {
      name: 'the body failed validation for another reason',
      error: new ApiError('bad', 400, 'VALIDATION_ERROR'),
      copy: 'Those registration details are not valid. Please check the form',
    },
    {
      name: 'the caller is being throttled',
      error: new ApiError('slow', 429, 'RATE_LIMIT_EXCEEDED'),
      copy: 'Too many attempts. Wait a moment and try again',
    },
  ]

  for (const refusal of REFUSALS) {
    it(`says so on the first attempt when ${refusal.name}`, async () => {
      apiFetch.mockRejectedValue(refusal.error)
      await render()

      await fillAndSubmit()

      expect(await screen.findByText(refusal.copy)).toBeDefined()
      // The line this page used to show for every one of these.
      expect(screen.queryByText('Registration failed. Please try again.')).toBeNull()
      expect(useAuthStore.getState().isAuthenticated).toBe(false)
    })
  }

  it('gives each reason a message of its own', async () => {
    const messages = new Set(REFUSALS.map((r) => r.copy))
    expect(messages.size, 'two reasons sharing a message is the bug').toBe(REFUSALS.length)
  })

  /** A genuine server fault is the one case the generic line is correct for. */
  it('keeps the generic line for a failure with no reason of its own', async () => {
    apiFetch.mockRejectedValue(new ApiError('boom', 500, 'INTERNAL_ERROR'))
    await render()

    await fillAndSubmit()

    expect(await screen.findByText('Registration failed. Please try again.')).toBeDefined()
  })

  it('keeps the generic line when the request never reached the server', async () => {
    apiFetch.mockRejectedValue(new TypeError('Failed to fetch'))
    await render()

    await fillAndSubmit()

    expect(await screen.findByText('Registration failed. Please try again.')).toBeDefined()
  })

  /** Checked before the request, so a malformed number never costs a round trip. */
  it('refuses a phone number that is too short without asking the server', async () => {
    await render()

    await fillAndSubmit({ phone: '812' })

    expect(await screen.findByText('Invalid format. Use +62 followed by 9-13 digits')).toBeDefined()
    expect(apiFetch).not.toHaveBeenCalled()
  })
})
