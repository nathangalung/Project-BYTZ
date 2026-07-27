import { AppError } from '@kerjacus/shared'
import type { Context, Next } from 'hono'
import { type AccountStatus, getAccountStatus } from '../lib/account-status'
import { env } from '../lib/env'
import { serviceFetch } from '../lib/http/service-fetch'
import { UpstreamError } from '../lib/http/upstream-error'
import { getCachedSession, setCachedSession } from './session-cache'

const AUTH_TIMEOUT_MS = 5_000

/**
 * Outcome of a session lookup.
 *
 * `rejected` and `empty` are both 401s but stay distinct because they mean
 * different things when debugging: auth-service refused the cookie, versus
 * auth-service accepted it and returned no user.
 */
type SessionLookup = { kind: 'user'; user: SessionUser } | { kind: 'rejected' } | { kind: 'empty' }

/**
 * Ask auth-service who this cookie belongs to.
 *
 * Throws UpstreamError only when auth-service could not answer at all, which
 * is a 503 for the caller. A 4xx is auth-service successfully answering that
 * the session is bad, which is a 401. Transient faults are not retried: this
 * runs on every authenticated request, so failing fast beats adding backoff to
 * the hot path.
 */
async function fetchSessionUser(cookie: string): Promise<SessionLookup> {
  let res: Response
  try {
    res = await serviceFetch(
      `${env.AUTH_SERVICE_URL}/api/v1/auth/get-session`,
      { headers: { Cookie: cookie } },
      { service: 'auth-service', timeoutMs: AUTH_TIMEOUT_MS },
    )
  } catch (err) {
    // Not retryable, so a 4xx never counts toward the circuit breaker either.
    if (err instanceof UpstreamError && err.status !== null && err.status < 500) {
      return { kind: 'rejected' }
    }
    throw err
  }
  const data = (await res.json()) as { user?: SessionUser }
  return data?.user ? { kind: 'user', user: data.user } : { kind: 'empty' }
}

export type SessionUser = {
  id: string
  email: string
  name: string
  role: string
  phone?: string
}

/** Extract authenticated user from context. Throws if not authenticated. */
export function getAuthUser(c: Context): SessionUser {
  const user = (c as unknown as { var: { user?: SessionUser } }).var.user
  if (!user) {
    throw new AppError('AUTH_UNAUTHORIZED', 'Authentication required')
  }
  return user
}

/** Extract the authenticated user if one was resolved, else null. Never throws. */
export function getOptionalUser(c: Context): SessionUser | null {
  return (c as unknown as { var: { user?: SessionUser } }).var.user ?? null
}

/**
 * Resolve a session when a cookie is present, otherwise continue anonymously.
 *
 * Used by routes that are reachable without login but render differently for the
 * owner - the handler still needs to know who is asking so it can apply a
 * visibility gate. An auth-service outage degrades to the anonymous view rather
 * than taking public pages down with it.
 */
export async function optionalSessionMiddleware(c: Context, next: Next) {
  const cookie = c.req.header('Cookie')
  if (!cookie) return next()

  try {
    const cookieHash = cookie.substring(0, 64)
    const cached = getCachedSession(cookieHash)
    const user = cached ?? (await resolveAndCache(cookie, cookieHash))

    // A suspended or removed account reads these pages as a stranger would.
    // Checked on the cached path too, for one rule rather than two: an account
    // the platform has stopped is a participant nowhere. The cost is the same
    // indexed read, and a failure here degrades to the anonymous view.
    if (user && (await getAccountStatus(user.id)) === 'active') {
      c.set('user' as never, user as never)
    }
  } catch {
    // Anonymous view is the correct fallback.
  }
  return next()
}

/** Resolve a cookie against auth-service and cache the identity it names. */
async function resolveAndCache(cookie: string, cookieHash: string): Promise<SessionUser | null> {
  const lookup = await fetchSessionUser(cookie)
  if (lookup.kind !== 'user') return null
  setCachedSession(cookieHash, lookup.user)
  return lookup.user
}

/** Session validation middleware */
export async function sessionMiddleware(c: Context, next: Next) {
  const cookie = c.req.header('Cookie')
  if (!cookie) {
    return c.json(
      { success: false, error: { code: 'AUTH_UNAUTHORIZED', message: 'Session required' } },
      401,
    )
  }

  try {
    const cookieHash = cookie.substring(0, 64)
    const cached = getCachedSession(cookieHash)
    let user = cached

    if (!user) {
      const lookup = await fetchSessionUser(cookie)
      if (lookup.kind !== 'user') {
        const message = lookup.kind === 'rejected' ? 'Invalid session' : 'No user in session'
        return c.json({ success: false, error: { code: 'AUTH_UNAUTHORIZED', message } }, 401)
      }
      setCachedSession(cookieHash, lookup.user)
      user = lookup.user
    }

    // Runs on the cached path too. Caching this would give a suspended account
    // the rest of the 5-minute TTL to keep working, which is the window the
    // check exists to close. Its own catch: a failure here is the database,
    // not auth-service, and saying so is the difference between one and two
    // wrong places to look during an incident.
    let status: AccountStatus
    try {
      status = await getAccountStatus(user.id)
    } catch {
      return c.json(
        {
          success: false,
          error: { code: 'SERVICE_UNAVAILABLE', message: 'Account status unavailable' },
        },
        503,
      )
    }

    if (status === 'suspended') {
      return c.json(
        { success: false, error: { code: 'AUTH_FORBIDDEN', message: 'Account suspended' } },
        403,
      )
    }
    if (status === 'gone') {
      return c.json(
        { success: false, error: { code: 'AUTH_UNAUTHORIZED', message: 'Invalid session' } },
        401,
      )
    }

    c.set('user' as never, user as never)
    await next()
  } catch {
    return c.json(
      {
        success: false,
        error: { code: 'SERVICE_UNAVAILABLE', message: 'Auth service unavailable' },
      },
      503,
    )
  }
}
