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

/**
 * A phone number by default, because every account that finished sign-up has
 * one. Pass null for the Google account that never chose a role.
 */
function signIn(
  role: 'owner' | 'talent' | 'admin',
  id = 'u1',
  phone: string | null = '+628123456789',
) {
  useAuthStore.setState({
    user: {
      id,
      email: `${id}@kerjacus.id`,
      name: id,
      role: role as 'owner' | 'talent',
      phone,
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

  /**
   * Messages is the exception, and it has to be.
   *
   * A support room seats an admin as an ordinary chat_participants row, which
   * is what the chat routes and the Centrifugo channel authorise on - and
   * apps/admin ships no messaging UI, so a blanket bounce would leave every
   * support room with an admin in it who cannot open it.
   */
  it('is let through to the messages area', async () => {
    signIn('admin')

    expect(await guard('/messages')).toBeNull()
  })

  it('is let through to one conversation', async () => {
    signIn('admin')

    expect(await guard('/messages/c-1')).toBeNull()
  })

  it('is still kept out of the rest of the shell', async () => {
    signIn('admin')

    expect(await guard('/projects')).toBe('/login')
  })

  /** The profile gate is about choosing owner-or-talent; an admin has not. */
  it('is not put through the talent profile check on the way in', async () => {
    signIn('admin')
    stubProfile(404, {})

    expect(await guard('/messages')).toBeNull()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})

/**
 * Google gives no phone number and OAuth never reaches the sign-up handler, so
 * the row is created on the column default - owner - whatever the person is.
 * A missing phone is the only mark that an account never chose, and role is
 * immutable everywhere else, so the guard has to catch it before any page.
 */
describe('an account that never chose a role', () => {
  it('sends a Google sign-in with no phone to onboarding', async () => {
    signIn('owner', 'u1', null)

    expect(await guard('/dashboard')).toBe('/onboarding')
  })

  it('lets it reach the onboarding page itself', async () => {
    signIn('owner', 'u1', null)

    expect(await guard('/onboarding')).toBeNull()
  })

  // Otherwise the profile lookup runs for an account whose role is a guess.
  it('does not run the talent profile check first', async () => {
    signIn('talent', 'u1', null)
    stubProfile(404, {})

    expect(await guard('/dashboard')).toBe('/onboarding')
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  // Admin belongs to the other app, phone or no phone.
  it('still sends an admin to login rather than onboarding', async () => {
    signIn('admin', 'u1', null)

    expect(await guard('/dashboard')).toBe('/login')
  })

  // And is not sent to onboarding on the one path it is allowed: an admin
  // account has no phone-number step to finish.
  it('does not send a phoneless admin to onboarding before messages', async () => {
    signIn('admin', 'u1', null)

    expect(await guard('/messages')).toBeNull()
  })

  it('leaves an account that already has a phone alone', async () => {
    signIn('owner')

    expect(await guard('/dashboard')).toBeNull()
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

  /**
   * A check that could not run is not a failed check.
   *
   * This gate used to close on any failure, so a 500, a restarting service or
   * an offline tab pushed a verified talent back to the registration form they
   * had already completed - indistinguishable, from where they sit, from
   * losing their account. Nothing is admitted by letting them through: every
   * endpoint behind this still enforces its own access, and each page reports
   * its own failure. Only an answer that says the profile is not there sends
   * them to registration.
   */
  it.each([
    ['a failing service', 500],
    ['a restarting gateway', 502],
    ['a shared rate limit', 429],
  ])('lets the talent through when the profile check hits %s', async (_name, status) => {
    signIn('talent')
    stubProfile(status, { error: { code: 'INTERNAL_ERROR' } })

    expect(await guard('/dashboard')).toBeNull()
  })

  it('lets the talent through when the profile check cannot reach the network', async () => {
    signIn('talent')
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch

    expect(await guard('/dashboard')).toBeNull()
  })

  /** A failed check is not cached either, so the next navigation asks again. */
  it('does not cache a check that never got an answer', async () => {
    signIn('talent')
    stubProfile(503, {})

    await guard('/dashboard')

    expect(localStorage.getItem('kerjacus-profile-complete')).toBeNull()
  })

  it('does not apply the profile gate to an owner', async () => {
    signIn('owner')
    stubProfile(404, {})

    expect(await guard('/dashboard')).toBeNull()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})
