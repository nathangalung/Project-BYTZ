import { AppError } from '@kerjacus/shared'
import type { Context, Next } from 'hono'
import { getCachedSession, setCachedSession } from './session-cache'

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

    const authUrl =
      process.env.AUTH_SERVICE_URL || process.env.BETTER_AUTH_URL || 'http://localhost:3001'
    const res = await fetch(`${authUrl}/api/v1/auth/get-session`, {
      headers: { Cookie: cookie },
      signal: AbortSignal.timeout(5000),
    })
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
