// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api'
import { renderRoute } from '@/lib/testing/harness'
import { useAuthStore } from '@/stores/auth'
import * as onboardingRoute from './onboarding'

/**
 * The page that repairs a Google sign-up.
 *
 * Everything that matters here is a one-way door: the role chosen on this form
 * is the role the account keeps, because every other path refuses to write it.
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

const GOOGLE_USER = {
  id: 'u1',
  email: 'rina@gmail.com',
  name: 'Rina',
  role: 'owner' as const,
  phone: null,
  locale: 'id' as const,
}

const render = () =>
  renderRoute(onboardingRoute, {
    path: '/onboarding',
    destinations: ['/dashboard', '/talent/register'],
  })

async function fillAndSubmit(digits: string) {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Phone Number'), digits)
  await user.click(screen.getByRole('button', { name: 'Save and Continue' }))
  return user
}

const beforeLoad = onboardingRoute.Route.options.beforeLoad as () => void

/** Where the route guard sent us, or null if it let us stay. */
function guard(): string | null {
  try {
    beforeLoad()
    return null
  } catch (thrown) {
    const target = (thrown as { options?: { to?: string } }).options?.to
    if (!target) throw thrown
    return target
  }
}

beforeEach(() => {
  apiFetch.mockReset()
  useAuthStore.setState({ user: GOOGLE_USER, isAuthenticated: true, isLoading: false })
})

describe('who the page is for', () => {
  it('stays open for an account with no phone number', () => {
    expect(guard()).toBeNull()
  })

  // Onboarding runs once. An account with a phone already chose, and the
  // endpoint behind this form would refuse a second attempt anyway.
  it('turns away an account that already finished', () => {
    useAuthStore.setState({ user: { ...GOOGLE_USER, phone: '+628123456789' } })

    expect(guard()).toBe('/dashboard')
  })
})

describe('the onboarding form', () => {
  it('asks for the two things OAuth could not supply', async () => {
    await render()

    expect(screen.getByRole('heading', { name: 'Complete Your Account' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Project Owner' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Talent' })).toBeDefined()
    expect(screen.getByLabelText('Phone Number')).toBeDefined()
  })

  /** The phone number is the anti-multi-account control, and the one-time key. */
  it('rejects a short phone number without calling the API', async () => {
    await render()

    await fillAndSubmit('812')

    await waitFor(() => expect(screen.getByText(/invalid format/i)).toBeDefined())
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('sends the chosen role and the typed number', async () => {
    apiFetch.mockResolvedValue({ data: { ...GOOGLE_USER, phone: '+6281234567890' } })
    const { router } = await render()

    // Both ways, because the picker is the only place the role is ever set.
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Talent' }))
    await user.click(screen.getByRole('button', { name: 'Project Owner' }))
    await fillAndSubmit('81234567890')

    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'))
    expect(apiFetch).toHaveBeenCalledWith('/api/v1/auth/complete-onboarding', {
      method: 'POST',
      body: JSON.stringify({ role: 'owner', phone: '+6281234567890' }),
    })
  })

  /*
   * The whole bug in one case: a talent who signed in with Google was filed as
   * an owner. Picking talent here has to reach the server and carry the person
   * on to the talent registration they were owed.
   */
  it('files a talent as a talent and sends them to talent registration', async () => {
    apiFetch.mockResolvedValue({
      data: { ...GOOGLE_USER, role: 'talent', phone: '+6281234567890' },
    })
    const { router } = await render()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Talent' }))
    await fillAndSubmit('81234567890')

    await waitFor(() => expect(router.state.location.pathname).toBe('/talent/register'))
    expect(apiFetch).toHaveBeenCalledWith('/api/v1/auth/complete-onboarding', {
      method: 'POST',
      body: JSON.stringify({ role: 'talent', phone: '+6281234567890' }),
    })
  })

  /**
   * Better Auth caches the session for five minutes, so the store has to take
   * the new role from the reply or the shell renders the old one until then.
   */
  it('writes the stored row into the session rather than waiting the cache out', async () => {
    const stored = { ...GOOGLE_USER, role: 'talent' as const, phone: '+6281234567890' }
    apiFetch.mockResolvedValue({ data: stored })
    await render()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Talent' }))
    await fillAndSubmit('81234567890')

    await waitFor(() => expect(useAuthStore.getState().user?.role).toBe('talent'))
    expect(useAuthStore.getState().user?.phone).toBe('+6281234567890')
  })

  const REFUSALS = [
    {
      name: 'a number another account already holds',
      error: new ApiError('taken', 409, 'AUTH_PHONE_ALREADY_EXISTS'),
      copy: /already registered/i,
    },
    {
      name: 'an account that was onboarded meanwhile',
      error: new ApiError('done', 403, 'AUTH_FORBIDDEN'),
      copy: /already set/i,
    },
    {
      name: 'a failure with no copy of its own',
      error: new ApiError('boom', 500, 'INTERNAL_ERROR'),
      copy: /could not save/i,
    },
  ] as const

  for (const testCase of REFUSALS) {
    it(`names ${testCase.name} instead of failing silently`, async () => {
      apiFetch.mockRejectedValue(testCase.error)
      const { router } = await render()

      await fillAndSubmit('81234567890')

      await waitFor(() => expect(screen.getByText(testCase.copy)).toBeDefined())
      expect(router.state.location.pathname).toBe('/onboarding')
    })
  }

  it('reports a thrown non-ApiError the same way', async () => {
    apiFetch.mockRejectedValue(new Error('offline'))
    await render()

    await fillAndSubmit('81234567890')

    await waitFor(() => expect(screen.getByText(/could not save/i)).toBeDefined())
  })
})
