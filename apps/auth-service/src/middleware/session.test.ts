import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The gate every authenticated route sits behind, and it was at 11% covered.
 *
 * Two of its branches are security controls rather than plumbing. The
 * suspension check exists because admin suspension writes is_verified = false
 * and nothing read it, so a suspended account kept its session and could sign
 * in again. requireRole is the only thing standing between a talent and an
 * owner-only route.
 */

const getSession = vi.fn()

vi.mock('../lib/auth', () => ({
  auth: {
    api: {
      get getSession() {
        return getSession
      },
    },
  },
}))

const { requireRole, sessionMiddleware } = await import('./session')
type AuthVariables = import('./session').AuthVariables

type Body = { success: boolean; error?: { code: string; message: string } }

function appWithSession() {
  const app = new Hono<{ Variables: AuthVariables }>()
  app.use('*', sessionMiddleware)
  app.get('/', (c) => c.json({ success: true, user: c.get('user'), session: c.get('session') }))
  return app
}

beforeEach(() => {
  getSession.mockReset()
})

describe('sessionMiddleware', () => {
  it('refuses a request with no session', async () => {
    getSession.mockResolvedValue(null)

    const res = await appWithSession().request('/')
    const body = (await res.json()) as Body

    expect(res.status).toBe(401)
    expect(body.error?.code).toBe('AUTH_UNAUTHORIZED')
  })

  /**
   * The control that closed the suspension hole. A suspended user still holds
   * a valid session, so passing this through is exactly the bug.
   */
  it('refuses a suspended account that still holds a valid session', async () => {
    getSession.mockResolvedValue({
      user: { id: 'u1', role: 'talent', isVerified: false },
      session: { id: 's1' },
    })

    const res = await appWithSession().request('/')
    const body = (await res.json()) as Body

    expect(res.status).toBe(403)
    expect(body.error?.code).toBe('AUTH_FORBIDDEN')
    expect(body.error?.message).toBe('Account suspended')
  })

  /** Only an explicit false suspends; absent means an account predating the flag. */
  it('admits a user whose verification flag is absent', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1', role: 'owner' }, session: { id: 's1' } })

    const res = await appWithSession().request('/')

    expect(res.status).toBe(200)
  })

  it('puts the user and session on the context for the handler', async () => {
    getSession.mockResolvedValue({
      user: { id: 'u1', role: 'owner', isVerified: true },
      session: { id: 's1' },
    })

    const res = await appWithSession().request('/')
    const body = (await res.json()) as { user: { id: string }; session: { id: string } }

    expect(body.user.id).toBe('u1')
    expect(body.session.id).toBe('s1')
  })

  it('reads the session from the request headers, not from anywhere else', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1', role: 'owner' }, session: { id: 's1' } })

    await appWithSession().request('/', { headers: { cookie: 'better-auth.session_token=abc' } })

    const passed = getSession.mock.calls[0]?.[0] as { headers: Headers }
    expect(passed.headers.get('cookie')).toBe('better-auth.session_token=abc')
  })
})

describe('requireRole', () => {
  function appWithRole(roles: string[], user?: { id: string; role: string }) {
    const app = new Hono<{ Variables: AuthVariables }>()
    if (user) {
      app.use('*', async (c, next) => {
        c.set('user', user as AuthVariables['user'])
        await next()
      })
    }
    app.use('*', requireRole(...roles))
    app.get('/', (c) => c.json({ success: true }))
    return app
  }

  it('refuses when no user reached the context', async () => {
    const res = await appWithRole(['owner']).request('/')
    const body = (await res.json()) as Body

    expect(res.status).toBe(401)
    expect(body.error?.code).toBe('AUTH_UNAUTHORIZED')
  })

  it('refuses a role outside the allowed set', async () => {
    const res = await appWithRole(['owner'], { id: 'u1', role: 'talent' }).request('/')
    const body = (await res.json()) as Body

    expect(res.status).toBe(403)
    expect(body.error?.code).toBe('AUTH_FORBIDDEN')
    expect(body.error?.message).toBe('Insufficient permissions')
  })

  it('admits a role in the set', async () => {
    const res = await appWithRole(['owner', 'admin'], { id: 'u1', role: 'admin' }).request('/')

    expect(res.status).toBe(200)
  })

  /** An empty allow-list admits nobody, rather than everybody. */
  it('refuses everyone when the allowed set is empty', async () => {
    const res = await appWithRole([], { id: 'u1', role: 'owner' }).request('/')

    expect(res.status).toBe(403)
  })
})
