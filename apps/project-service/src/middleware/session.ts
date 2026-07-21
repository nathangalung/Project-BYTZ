import { AppError } from '@kerjacus/shared'
import type { Context, Next } from 'hono'
import { env } from '../lib/env'
import { makeResilientPolicy } from '../lib/resilience'
import { getCachedSession, setCachedSession } from './session-cache'

const authServicePolicy = makeResilientPolicy('auth-service')

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
    if (cached) {
      c.set('user' as never, cached as never)
      return next()
    }

    const res = await authServicePolicy.execute(() =>
      fetch(`${env.AUTH_SERVICE_URL}/api/v1/auth/get-session`, {
        headers: { Cookie: cookie },
        signal: AbortSignal.timeout(5000),
      }),
    )
    if (res.ok) {
      const data = (await res.json()) as { user?: SessionUser }
      if (data?.user) {
        setCachedSession(cookieHash, data.user)
        c.set('user' as never, data.user as never)
      }
    }
  } catch {
    // Anonymous view is the correct fallback.
  }
  return next()
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
    if (cached) {
      c.set('user' as never, cached as never)
      return next()
    }

    const res = await authServicePolicy.execute(() =>
      fetch(`${env.AUTH_SERVICE_URL}/api/v1/auth/get-session`, {
        headers: { Cookie: cookie },
        signal: AbortSignal.timeout(5000),
      }),
    )
    if (!res.ok) {
      return c.json(
        { success: false, error: { code: 'AUTH_UNAUTHORIZED', message: 'Invalid session' } },
        401,
      )
    }
    const data = (await res.json()) as { user?: SessionUser }
    if (!data?.user) {
      return c.json(
        { success: false, error: { code: 'AUTH_UNAUTHORIZED', message: 'No user in session' } },
        401,
      )
    }
    setCachedSession(cookieHash, data.user)
    c.set('user' as never, data.user as never)
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
