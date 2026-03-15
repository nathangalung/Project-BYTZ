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

  c.set('user', session.user as SessionUser)
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
