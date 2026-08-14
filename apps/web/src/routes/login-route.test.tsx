// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderRoute } from '@/lib/testing/harness'
import { useAuthStore } from '@/stores/auth'
import { ApiError } from '../lib/api'
import * as loginRoute from './_public/login'

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

const OWNER = {
  id: 'u1',
  email: 'owner@kerjacus.id',
  name: 'Owner',
  role: 'owner' as const,
  locale: 'id' as const,
}

beforeEach(() => {
  apiFetch.mockReset()
  useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: false })
})

function render() {
  return renderRoute(loginRoute, { path: '/login', destinations: ['/dashboard', '/register'] })
}

async function fillAndSubmit(identifier = 'owner@kerjacus.id', password = 'secret') {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText(/email or phone/i), identifier)
  await user.type(screen.getByLabelText(/^password$/i), password)
  await user.click(screen.getByRole('button', { name: /sign in/i }))
}

describe('the login form', () => {
  it('labels both fields so they are reachable by name', async () => {
    await render()

    expect(screen.getByLabelText(/email or phone/i)).toBeDefined()
    expect(screen.getByLabelText(/^password$/i)).toBeDefined()
  })

  it('offers Google as an alternative to the password form', async () => {
    await render()

    const google = screen.getByRole('link', { name: /google/i })
    expect(google.getAttribute('href')).toBe('/api/v1/auth/sign-in/social?provider=google')
  })

  /** The eye toggle is the only way to check a typo before submitting. */
  it('reveals and re-hides the password', async () => {
    const user = userEvent.setup()
    await render()
    const password = screen.getByLabelText(/^password$/i)
    expect(password.getAttribute('type')).toBe('password')

    await user.click(screen.getByRole('button', { name: /show password/i }))
    expect(password.getAttribute('type')).toBe('text')

    await user.click(screen.getByRole('button', { name: /hide password/i }))
    expect(password.getAttribute('type')).toBe('password')
  })
})

describe('a successful sign-in', () => {
  it('stores the session and moves to the dashboard', async () => {
    apiFetch.mockResolvedValue({ user: OWNER })
    const { router } = await render()

    await fillAndSubmit()

    await waitFor(() => expect(useAuthStore.getState().user).toEqual(OWNER))
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'))
  })

  it('sends the identifier and password it was given', async () => {
    apiFetch.mockResolvedValue({ user: OWNER })
    await render()

    await fillAndSubmit('+628123456789', 'hunter2')

    await waitFor(() => expect(apiFetch).toHaveBeenCalled())
    expect(apiFetch).toHaveBeenCalledWith('/api/v1/auth/sign-in/email-or-phone', {
      method: 'POST',
      body: JSON.stringify({ identifier: '+628123456789', password: 'hunter2' }),
    })
  })
})

/**
 * An admin has a separate console on its own port. Accepting the session here
 * would drop them into an owner shell with no admin routes in it.
 */
describe('an admin signing in to the main app', () => {
  it('is told to use the admin panel and is not signed in', async () => {
    apiFetch.mockResolvedValue({ user: { ...OWNER, role: 'admin' } })
    const { router } = await render()

    await fillAndSubmit()

    await waitFor(() => expect(screen.getByText(/admin/i)).toBeDefined())
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
    expect(router.state.location.pathname).toBe('/login')
  })
})

/**
 * The reply must never reveal whether an account exists, so every rejection
 * under 500 reads the same. A 5xx is a different message because retrying is
 * the right advice there and correcting the password is not.
 */
describe('a rejected sign-in', () => {
  it('gives one generic reason for a wrong password', async () => {
    apiFetch.mockRejectedValue(new ApiError('nope', 401, 'AUTH_SESSION_EXPIRED'))
    await render()

    await fillAndSubmit()

    await waitFor(() => expect(screen.getByText(/invalid/i)).toBeDefined())
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })

  it('gives the same reason for an unknown account', async () => {
    apiFetch.mockRejectedValue(new ApiError('nope', 404, 'AUTH_USER_NOT_FOUND'))
    await render()

    await fillAndSubmit()

    await waitFor(() => expect(screen.getByText(/invalid/i)).toBeDefined())
  })

  it('distinguishes a server failure from a bad password', async () => {
    apiFetch.mockRejectedValue(new ApiError('boom', 500, 'INTERNAL_ERROR'))
    await render()

    await fillAndSubmit()

    await waitFor(() => expect(screen.getByText(/please try again/i)).toBeDefined())
    expect(screen.queryByText(/invalid/i)).toBeNull()
  })

  it('treats a dropped connection as a server failure', async () => {
    apiFetch.mockRejectedValue(new TypeError('Failed to fetch'))
    await render()

    await fillAndSubmit()

    await waitFor(() => expect(screen.getByText(/please try again/i)).toBeDefined())
  })

  /** Leaving the button disabled after a failure strands the user. */
  it('re-enables the submit button so the user can try again', async () => {
    apiFetch.mockRejectedValue(new ApiError('nope', 401, 'AUTH_SESSION_EXPIRED'))
    await render()

    await fillAndSubmit()

    await waitFor(() => expect(screen.getByText(/invalid/i)).toBeDefined())
    const submit = screen.getByRole('button', { name: /sign in/i }) as HTMLButtonElement
    expect(submit.disabled).toBe(false)
  })

  it('clears the previous error when the next attempt succeeds', async () => {
    apiFetch.mockRejectedValueOnce(new ApiError('nope', 401, 'AUTH_SESSION_EXPIRED'))
    await render()
    await fillAndSubmit()
    await waitFor(() => expect(screen.getByText(/invalid/i)).toBeDefined())

    apiFetch.mockResolvedValue({ user: OWNER })
    await fillAndSubmit('x', 'y')

    await waitFor(() => expect(screen.queryByText(/invalid/i)).toBeNull())
  })
})
