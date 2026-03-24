import { AppError } from '@kerjacus/shared'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAuthUser, sessionMiddleware } from './session'

// Mock session-cache
vi.mock('./session-cache', () => ({
  getCachedSession: vi.fn().mockReturnValue(null),
  setCachedSession: vi.fn(),
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

  beforeEach(() => {
    vi.resetModules()
    process.env.BETTER_AUTH_URL = 'http://localhost:3001'
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
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
    const { getCachedSession } = await import('./session-cache')
    const mockUser = { id: 'u1', email: 'a@b.com', name: 'Cached', role: 'owner' }
    vi.mocked(getCachedSession).mockReturnValue(mockUser)

    const app = createApp()
    const res = await app.request('/test', {
      headers: { Cookie: 'session=abc123def456' },
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as ErrorBody
    expect(body.user).toEqual(mockUser)
  })

  it('calls auth service when not cached', async () => {
    const { getCachedSession, setCachedSession } = await import('./session-cache')
    vi.mocked(getCachedSession).mockReturnValue(null)

    const mockUser = { id: 'u2', email: 'b@c.com', name: 'Fresh', role: 'talent' }
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ user: mockUser }),
    })
    vi.stubGlobal('fetch', mockFetch)

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
    expect(setCachedSession).toHaveBeenCalled()
  })

  it('returns 401 when auth service returns non-ok', async () => {
    const { getCachedSession } = await import('./session-cache')
    vi.mocked(getCachedSession).mockReturnValue(null)

    const mockFetch = vi.fn().mockResolvedValue({ ok: false })
    vi.stubGlobal('fetch', mockFetch)

    const app = createApp()
    const res = await app.request('/test', {
      headers: { Cookie: 'session=invalid' },
    })

    expect(res.status).toBe(401)
    const body = (await res.json()) as ErrorBody
    expect(body.error.message).toBe('Invalid session')
  })

  it('returns 401 when auth service returns no user', async () => {
    const { getCachedSession } = await import('./session-cache')
    vi.mocked(getCachedSession).mockReturnValue(null)

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    })
    vi.stubGlobal('fetch', mockFetch)

    const app = createApp()
    const res = await app.request('/test', {
      headers: { Cookie: 'session=no-user' },
    })

    expect(res.status).toBe(401)
    const body = (await res.json()) as ErrorBody
    expect(body.error.message).toBe('No user in session')
  })

  it('returns 503 when auth service is unreachable', async () => {
    const { getCachedSession } = await import('./session-cache')
    vi.mocked(getCachedSession).mockReturnValue(null)

    const mockFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    vi.stubGlobal('fetch', mockFetch)

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
