import { createMiddleware } from 'hono/factory'

// Validate admin session
export const adminAuth = createMiddleware(async (c, next) => {
  const sessionCookie = c.req.header('Cookie')
  if (!sessionCookie) {
    return c.json(
      {
        success: false,
        error: {
          code: 'AUTH_UNAUTHORIZED',
          message: 'Admin session required',
        },
      },
      401,
    )
  }

  try {
    const authUrl = process.env.BETTER_AUTH_URL || 'http://localhost:3001'
    const res = await fetch(`${authUrl}/api/v1/auth/get-session`, {
      headers: { Cookie: sessionCookie },
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

    const data = (await res.json()) as { user?: { role?: string; id?: string; name?: string } }

    if (data.user?.role !== 'admin') {
      return c.json(
        {
          success: false,
          error: { code: 'AUTH_FORBIDDEN', message: 'Admin access required' },
        },
        403,
      )
    }

    c.set('adminUser', data.user)
    await next()
  } catch {
    return c.json(
      {
        success: false,
        error: {
          code: 'AUTH_UNAUTHORIZED',
          message: 'Auth service unavailable',
        },
      },
      503,
    )
  }
})
