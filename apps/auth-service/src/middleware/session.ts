import { createMiddleware } from 'hono/factory'
import { auth } from '../lib/auth'

type SessionUser = {
  id: string
  email: string
  name: string
  role: string
  phone?: string | null
  avatarUrl?: string | null
  isVerified?: boolean
  deletedAt?: string | null
  locale?: string
}

type SessionData = {
  session: {
    id: string
    userId: string
    expiresAt: Date
    token: string
  }
  user: SessionUser
}

export type AuthVariables = {
  user: SessionUser
  session: SessionData['session']
}

export const sessionMiddleware = createMiddleware<{
  Variables: AuthVariables
}>(async (c, next) => {
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  })

  if (!session) {
    return c.json(
      {
        success: false,
        error: {
          code: 'AUTH_UNAUTHORIZED',
          message: 'Valid session required',
        },
      },
      401,
    )
  }

  const user = session.user as SessionUser

  // Refuse a soft-deleted (banned) account, not an unverified one. is_verified
  // defaults false at sign-up and no path sets it true, so gating on it locked
  // out every organically registered user, not the suspended ones. deleted_at
  // is the unambiguous signal, and project-service already documents this same
  // decision for its own request path.
  if (user.deletedAt) {
    return c.json(
      {
        success: false,
        error: {
          code: 'AUTH_FORBIDDEN',
          message: 'Account suspended',
        },
      },
      403,
    )
  }

  c.set('user', user)
  c.set('session', session.session)

  await next()
})

export const requireRole = (...roles: string[]) =>
  createMiddleware<{
    Variables: AuthVariables
  }>(async (c, next) => {
    const user = c.get('user')

    if (!user) {
      return c.json(
        {
          success: false,
          error: {
            code: 'AUTH_UNAUTHORIZED',
            message: 'Valid session required',
          },
        },
        401,
      )
    }

    if (!roles.includes(user.role)) {
      return c.json(
        {
          success: false,
          error: {
            code: 'AUTH_FORBIDDEN',
            message: 'Insufficient permissions',
          },
        },
        403,
      )
    }

    await next()
  })
