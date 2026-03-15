import { createMiddleware } from 'hono/factory'

type SessionUser = {
  id: string
  email: string
  name: string
  role: string
  phone?: string
}

export type ProjectAuthVariables = { user: SessionUser }

// Validate via auth service
export const sessionMiddleware = createMiddleware<{
  Variables: ProjectAuthVariables
}>(async (c, next) => {
  const cookie = c.req.header('Cookie')
  if (!cookie) {
    return c.json(
      {
        success: false,
        error: { code: 'AUTH_UNAUTHORIZED', message: 'Session required' },
      },
      401,
    )
  }

  try {
    const authUrl = process.env.BETTER_AUTH_URL || 'http://localhost:3001'
    const res = await fetch(`${authUrl}/api/v1/auth/get-session`, {
      headers: { Cookie: cookie },
    })
    if (!res.ok) {
      return c.json(
        {
          success: false,
          error: { code: 'AUTH_UNAUTHORIZED', message: 'Invalid session' },
        },
        401,
      )
    }
    const data = (await res.json()) as { user?: SessionUser }
    if (!data?.user) {
      return c.json(
        {
          success: false,
          error: { code: 'AUTH_UNAUTHORIZED', message: 'No user in session' },
        },
        401,
      )
    }
    c.set('user', data.user as SessionUser)
    await next()
  } catch {
    return c.json(
      {
        success: false,
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Auth service unavailable',
        },
      },
      503,
    )
  }
})
