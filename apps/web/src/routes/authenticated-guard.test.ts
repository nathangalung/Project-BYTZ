// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth'
import { Route } from './_authenticated'

/**
 * beforeLoad is the only thing standing between a signed-out browser and every
 * authenticated page, so it is tested as a function rather than by rendering
 * the layout around it. Each case asserts where the guard sends the request,
 * which is the whole of its observable behaviour.
 */

const beforeLoad = Route.options.beforeLoad as (ctx: {
  location: { pathname: string }
}) => Promise<void>

/**
 * Run the guard and report where it sent us, or null if it let us pass.
 *
 * redirect() throws a Response subclass carrying the target on `options.to`.
 */
async function guard(pathname: string): Promise<string | null> {
  try {
    await beforeLoad({ location: { pathname } })
    return null
  } catch (thrown) {
    const target = (thrown as { options?: { to?: string } }).options?.to
    if (!target) throw thrown
    return target
  }
}

function signIn(role: 'owner' | 'talent' | 'admin', id = 'u1') {
  useAuthStore.setState({
    user: {
      id,
      email: `${id}@kerjacus.id`,
      name: id,
      role: role as 'owner' | 'talent',
      locale: 'id',
    },
    isAuthenticated: true,
    isLoading: false,
  })
}

function stubProfile(status: number, body: unknown) {
  globalThis.fetch = vi.fn(
    async () => new Response(JSON.stringify(body), { status }),
  ) as unknown as typeof fetch
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: false })
})

describe('signed out', () => {
  it('sends every authenticated path to the login page', async () => {
    expect(await guard('/dashboard')).toBe('/login')
  })
})

/** The admin console is a separate app on its own port and login. */
describe('an admin account in the main app', () => {
  it('is bounced to login rather than shown the owner shell', async () => {
    signIn('admin')

    expect(await guard('/dashboard')).toBe('/login')
  })
})

describe('role separation', () => {
  it('keeps an owner out of the talent area', async () => {
    signIn('owner')

    expect(await guard('/talent')).toBe('/dashboard')
  })

  it('keeps a talent out of project creation', async () => {
    signIn('talent')
    localStorage.setItem('kerjacus-profile-complete', 'u1')

    expect(await guard('/projects/new')).toBe('/dashboard')
  })

  it('keeps a talent out of the owner project list', async () => {
    signIn('talent')
    localStorage.setItem('kerjacus-profile-complete', 'u1')

    expect(await guard('/projects')).toBe('/dashboard')
  })

  it('lets an owner reach their own project list', async () => {
    signIn('owner')

    expect(await guard('/projects')).toBeNull()
  })

  it('lets a talent reach the talent area once their profile is on file', async () => {
    signIn('talent')
    localStorage.setItem('kerjacus-profile-complete', 'u1')

    expect(await guard('/talent')).toBeNull()
  })
})

/**
 * A talent with no parsed CV cannot be matched to anything, so every page but
 * registration and settings redirects them back to finish it. The localStorage
 * flag is only a cache: it is keyed by user id so that a second account on the
 * same browser is still checked against the API.
 */
describe('talent profile completion gate', () => {
  it('sends an unregistered talent to registration', async () => {
    signIn('talent')
    stubProfile(404, { error: 'not found' })

    expect(await guard('/dashboard')).toBe('/talent/register')
  })

  it.each(['verified', 'cv_parsing'])('lets a %s talent through and caches it', async (status) => {
    signIn('talent')
    stubProfile(200, { data: { verificationStatus: status } })

    expect(await guard('/dashboard')).toBeNull()
    expect(localStorage.getItem('kerjacus-profile-complete')).toBe('u1')
  })

  it('sends an unverified talent back to registration', async () => {
    signIn('talent')
    stubProfile(200, { data: { verificationStatus: 'unverified' } })

    expect(await guard('/dashboard')).toBe('/talent/register')
  })

  it('does not call the API again once the check is cached', async () => {
    signIn('talent')
    localStorage.setItem('kerjacus-profile-complete', 'u1')
    stubProfile(200, { data: { verificationStatus: 'verified' } })

    expect(await guard('/dashboard')).toBeNull()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  /** A cache entry left by the previous account must not admit this one. */
  it('ignores a cache entry belonging to a different user', async () => {
    signIn('talent', 'u2')
    localStorage.setItem('kerjacus-profile-complete', 'u1')
    stubProfile(404, {})

    expect(await guard('/dashboard')).toBe('/talent/register')
  })

  it('lets an unregistered talent reach the registration page itself', async () => {
    signIn('talent')
    stubProfile(404, {})

    expect(await guard('/talent/register')).toBeNull()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('lets an unregistered talent reach settings', async () => {
    signIn('talent')
    stubProfile(404, {})

    expect(await guard('/settings')).toBeNull()
  })

  /** A profile service outage must not silently admit an unchecked talent. */
  it('sends the talent to registration when the profile check cannot run', async () => {
    signIn('talent')
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch

    expect(await guard('/dashboard')).toBe('/talent/register')
  })

  it('does not apply the profile gate to an owner', async () => {
    signIn('owner')
    stubProfile(404, {})

    expect(await guard('/dashboard')).toBeNull()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})
