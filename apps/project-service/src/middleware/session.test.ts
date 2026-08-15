import { AppError } from '@kerjacus/shared'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountStatus } from '../lib/account-status'
import { getAuthUser, optionalSessionMiddleware, sessionMiddleware } from './session'
import * as sessionCache from './session-cache'

// The account behind the cookie, re-read per request.
let accountStatus: AccountStatus | Error = 'active'
vi.mock('../lib/account-status', () => ({
  getAccountStatus: async () => {
    if (accountStatus instanceof Error) throw accountStatus
    return accountStatus
  },
}))

type ErrorBody = { success: boolean; error: { code: string; message: string }; user?: unknown }

describe('getAuthUser', () => {
  it('throws AUTH_UNAUTHORIZED when no user in context', () => {
    const mockContext = { var: {} } as never
    expect(() => getAuthUser(mockContext)).toThrow(AppError)
    expect(() => getAuthUser(mockContext)).toThrow('Authentication required')
  })

  it('throws AUTH_UNAUTHORIZED when user is undefined', () => {
    const mockContext = { var: { user: undefined } } as never
    expect(() => getAuthUser(mockContext)).toThrow('Authentication required')
  })

  it('returns user when present in context', () => {
    const user = { id: 'u1', email: 'a@b.com', name: 'Test', role: 'owner' }
    const mockContext = { var: { user } } as never
    expect(getAuthUser(mockContext)).toEqual(user)
  })

  it('returns user with optional phone field', () => {
    const user = {
      id: 'u1',
      email: 'a@b.com',
      name: 'Test',
      role: 'talent',
      phone: '+6281234567890',
    }
    const mockContext = { var: { user } } as never
    const result = getAuthUser(mockContext)
    expect(result.phone).toBe('+6281234567890')
  })
})

describe('sessionMiddleware', () => {
  const originalEnv = { ...process.env }
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    process.env.BETTER_AUTH_URL = 'http://localhost:3001'
    accountStatus = 'active'
    vi.spyOn(sessionCache, 'getCachedSession').mockReturnValue(null)
    vi.spyOn(sessionCache, 'setCachedSession').mockImplementation(() => {})
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  function createApp() {
    const app = new Hono()
    app.use('*', sessionMiddleware)
    app.get('/test', (c) => {
      const user = c.get('user' as never)
      return c.json({ user })
    })
    return app
  }

  it('returns 401 when no cookie header', async () => {
    const app = createApp()
    const res = await app.request('/test')

    expect(res.status).toBe(401)
    const body = (await res.json()) as ErrorBody
    expect(body.success).toBe(false)
    expect(body.error.code).toBe('AUTH_UNAUTHORIZED')
    expect(body.error.message).toBe('Session required')
  })

  it('returns cached session when available', async () => {
    const mockUser = { id: 'u1', email: 'a@b.com', name: 'Cached', role: 'owner' }
    vi.spyOn(sessionCache, 'getCachedSession').mockReturnValue(mockUser)

    const app = createApp()
    const res = await app.request('/test', {
      headers: { Cookie: 'session=abc123def456' },
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as ErrorBody
    expect(body.user).toEqual(mockUser)
  })

  it('calls auth service when not cached', async () => {
    const mockUser = { id: 'u2', email: 'b@c.com', name: 'Fresh', role: 'talent' }
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ user: mockUser }),
    })
    globalThis.fetch = mockFetch as unknown as typeof fetch

    const app = createApp()
    const res = await app.request('/test', {
      headers: { Cookie: 'session=xyz789' },
    })

    expect(res.status).toBe(200)
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3001/api/v1/auth/get-session',
      expect.objectContaining({
        headers: expect.objectContaining({ Cookie: 'session=xyz789' }),
      }),
    )
    expect(sessionCache.setCachedSession).toHaveBeenCalled()
  })

  it('returns 401 when auth service returns non-ok', async () => {
    // A real Response always carries a status; 401 is what auth-service sends
    // for a cookie it refuses, and it is what separates "bad session" (401)
    // from "auth-service is down" (503).
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 401 })
    globalThis.fetch = mockFetch as unknown as typeof fetch

    const app = createApp()
    const res = await app.request('/test', {
      headers: { Cookie: 'session=invalid' },
    })

    expect(res.status).toBe(401)
    const body = (await res.json()) as ErrorBody
    expect(body.error.message).toBe('Invalid session')
  })

  it('returns 401 when auth service returns no user', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    })
    globalThis.fetch = mockFetch as unknown as typeof fetch

    const app = createApp()
    const res = await app.request('/test', {
      headers: { Cookie: 'session=no-user' },
    })

    expect(res.status).toBe(401)
    const body = (await res.json()) as ErrorBody
    expect(body.error.message).toBe('No user in session')
  })

  it('returns 503 when auth service is unreachable', { timeout: 15_000 }, async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    globalThis.fetch = mockFetch as unknown as typeof fetch

    const app = createApp()
    const res = await app.request('/test', {
      headers: { Cookie: 'session=timeout' },
    })

    expect(res.status).toBe(503)
    const body = (await res.json()) as ErrorBody
    expect(body.error.code).toBe('SERVICE_UNAVAILABLE')
    expect(body.error.message).toBe('Auth service unavailable')
  })
})

/**
 * Suspending an account did nothing to the session it already had: nothing on
 * this path re-read the account, so a suspended talent kept submitting
 * milestones and minting realtime tokens until the cookie expired a week
 * later.
 */
describe('an account suspended mid-session', () => {
  const originalFetch = globalThis.fetch
  const user = { id: 'u1', email: 'a@b.com', name: 'Suspended', role: 'talent' }

  beforeEach(() => {
    process.env.BETTER_AUTH_URL = 'http://localhost:3001'
    accountStatus = 'active'
    vi.spyOn(sessionCache, 'setCachedSession').mockImplementation(() => {})
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ user }),
    }) as unknown as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  function createApp() {
    const app = new Hono()
    app.use('*', sessionMiddleware)
    app.get('/test', (c) => c.json({ user: c.get('user' as never) }))
    return app
  }

  async function request() {
    return await createApp().request('/test', { headers: { Cookie: 'session=abc123def456' } })
  }

  it('refuses the request', async () => {
    vi.spyOn(sessionCache, 'getCachedSession').mockReturnValue(null)
    accountStatus = 'suspended'

    const res = await request()
    expect(res.status).toBe(403)
    const body = (await res.json()) as ErrorBody
    expect(body.error.code).toBe('AUTH_FORBIDDEN')
    expect(body.error.message).toBe('Account suspended')
  })

  /**
   * The check has to survive the 5-minute session cache. Reading the account
   * only on a cache miss would leave a suspended talent the rest of the TTL,
   * which is most of the window the check exists to close.
   */
  it('refuses it even when the session is still cached', async () => {
    vi.spyOn(sessionCache, 'getCachedSession').mockReturnValue(user)
    accountStatus = 'suspended'

    expect((await request()).status).toBe(403)
  })

  it('refuses a soft-deleted account as an invalid session', async () => {
    vi.spyOn(sessionCache, 'getCachedSession').mockReturnValue(user)
    accountStatus = 'gone'

    const res = await request()
    expect(res.status).toBe(401)
    expect((await res.json()) as ErrorBody).toMatchObject({
      error: { code: 'AUTH_UNAUTHORIZED' },
    })
  })

  it('lets an active account through on the cached path', async () => {
    vi.spyOn(sessionCache, 'getCachedSession').mockReturnValue(user)

    const res = await request()
    expect(res.status).toBe(200)
    expect(((await res.json()) as ErrorBody).user).toEqual(user)
  })

  // Fails closed, and names the database rather than auth-service, which is up.
  it('refuses the request when the account cannot be read', async () => {
    vi.spyOn(sessionCache, 'getCachedSession').mockReturnValue(user)
    accountStatus = new Error('connection refused')

    const res = await request()
    expect(res.status).toBe(503)
    const body = (await res.json()) as ErrorBody
    expect(body.error.code).toBe('SERVICE_UNAVAILABLE')
    expect(body.error.message).toBe('Account status unavailable')
  })
})

/**
 * The public half: pages reachable without login that still render differently
 * for the owner.
 *
 * Every failure mode here has to degrade to the anonymous view rather than to
 * an error, because the alternative is a public project page that goes down
 * with auth-service. The one thing it must NOT do is degrade the other way -
 * resolving a suspended account to a signed-in viewer - so the account check
 * runs on the cached path too, the same rule sessionMiddleware follows.
 */
describe('optionalSessionMiddleware', () => {
  const originalFetch = globalThis.fetch
  const user = { id: 'u9', email: 'p@q.com', name: 'Public viewer', role: 'owner' }

  beforeEach(() => {
    process.env.BETTER_AUTH_URL = 'http://localhost:3001'
    accountStatus = 'active'
    vi.spyOn(sessionCache, 'getCachedSession').mockReturnValue(null)
    vi.spyOn(sessionCache, 'setCachedSession').mockImplementation(() => {})
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  function createApp() {
    const app = new Hono()
    app.use('*', optionalSessionMiddleware)
    app.get('/public', (c) => c.json({ user: c.get('user' as never) ?? null }))
    return app
  }

  async function viewer(cookie?: string): Promise<unknown> {
    const res = await createApp().request(
      '/public',
      cookie ? { headers: { Cookie: cookie } } : undefined,
    )
    expect(res.status).toBe(200)
    return ((await res.json()) as { user: unknown }).user
  }

  function authServiceReturns(body: unknown) {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve(body) }) as unknown as typeof fetch
  }

  it('continues anonymously with no cookie, without asking auth-service', async () => {
    const fetchSpy = vi.fn()
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    expect(await viewer()).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('resolves the cookie and exposes the viewer', async () => {
    authServiceReturns({ user })

    expect(await viewer('session=fresh')).toEqual(user)
    expect(sessionCache.setCachedSession).toHaveBeenCalled()
  })

  it('serves the cached identity without a second auth-service call', async () => {
    vi.spyOn(sessionCache, 'getCachedSession').mockReturnValue(user)
    const fetchSpy = vi.fn()
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    expect(await viewer('session=cached')).toEqual(user)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('stays anonymous when auth-service accepts the cookie but names no user', async () => {
    authServiceReturns({})

    expect(await viewer('session=empty')).toBeNull()
    expect(sessionCache.setCachedSession).not.toHaveBeenCalled()
  })

  /**
   * The rule that makes this middleware match the strict one: an account the
   * platform has stopped is a participant nowhere, cache hit or not.
   */
  it('reads a suspended account as a stranger, even from cache', async () => {
    vi.spyOn(sessionCache, 'getCachedSession').mockReturnValue(user)
    accountStatus = 'suspended'

    expect(await viewer('session=cached')).toBeNull()
  })

  it('reads a soft-deleted account as a stranger', async () => {
    vi.spyOn(sessionCache, 'getCachedSession').mockReturnValue(user)
    accountStatus = 'gone'

    expect(await viewer('session=cached')).toBeNull()
  })

  /** An account-status outage must cost the viewer their name, not the page. */
  it('falls back to the anonymous view when the account cannot be read', async () => {
    vi.spyOn(sessionCache, 'getCachedSession').mockReturnValue(user)
    accountStatus = new Error('connection refused')

    expect(await viewer('session=cached')).toBeNull()
  })

  it('falls back to the anonymous view when auth-service is unreachable', {
    timeout: 15_000,
  }, async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch

    expect(await viewer('session=down')).toBeNull()
  })
})
