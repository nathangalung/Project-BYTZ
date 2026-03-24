import { zValidator } from '@hono/zod-validator'
import { getDb, user as userTable } from '@kerjacus/db'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AuthVariables } from '../middleware/session'
import { sessionMiddleware } from '../middleware/session'

export const meRoute = new Hono<{ Variables: AuthVariables }>()

meRoute.use('*', sessionMiddleware)

// GET /api/v1/me - current user profile
meRoute.get('/', async (c) => {
  const sessionUser = c.get('user')
  const db = getDb()

  const [foundUser] = await db
    .select({
      id: userTable.id,
      email: userTable.email,
      name: userTable.name,
      phone: userTable.phone,
      phoneVerified: userTable.phoneVerified,
      role: userTable.role,
      avatarUrl: userTable.avatarUrl,
      isVerified: userTable.isVerified,
      locale: userTable.locale,
      createdAt: userTable.createdAt,
      updatedAt: userTable.updatedAt,
    })
    .from(userTable)
    .where(eq(userTable.id, sessionUser.id))
    .limit(1)

  if (!foundUser) {
    return c.json(
      {
        success: false,
        error: { code: 'NOT_FOUND', message: 'User not found' },
      },
      404,
    )
  }

  return c.json({ success: true, data: foundUser })
})

const updateProfileSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  phone: z
    .string()
    .regex(/^\+62\d{9,13}$/, 'Indonesian format: +62 + 9-13 digits')
    .optional(),
  locale: z.enum(['id', 'en']).optional(),
})

// PATCH /api/v1/me - update current user profile
meRoute.patch('/', zValidator('json', updateProfileSchema), async (c) => {
  const sessionUser = c.get('user')
  const body = c.req.valid('json')
  const db = getDb()

  const [updated] = await db
    .update(userTable)
    .set({
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.phone !== undefined ? { phone: body.phone, phoneVerified: false } : {}),
      ...(body.locale !== undefined ? { locale: body.locale } : {}),
      updatedAt: new Date(),
    })
    .where(eq(userTable.id, sessionUser.id))
    .returning({
      id: userTable.id,
      email: userTable.email,
      name: userTable.name,
      phone: userTable.phone,
      phoneVerified: userTable.phoneVerified,
      role: userTable.role,
      avatarUrl: userTable.avatarUrl,
      isVerified: userTable.isVerified,
      locale: userTable.locale,
      createdAt: userTable.createdAt,
      updatedAt: userTable.updatedAt,
    })

  if (!updated) {
    return c.json(
      {
        success: false,
        error: { code: 'NOT_FOUND', message: 'User not found' },
      },
      404,
    )
  }

  return c.json({ success: true, data: updated })
})

const changePasswordSchema = z.object({
  currentPassword: z.string().min(8),
  newPassword: z.string().min(8).max(128),
})

// POST /api/v1/me/change-password
meRoute.post('/change-password', zValidator('json', changePasswordSchema), async (c) => {
  const sessionUser = c.get('user')
  const { currentPassword, newPassword } = c.req.valid('json')

  const authUrl = process.env.BETTER_AUTH_URL || 'http://localhost:3001'

  // Verify current password
  const verifyRes = await fetch(`${authUrl}/api/v1/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: sessionUser.email, password: currentPassword }),
  })

  if (!verifyRes.ok) {
    return c.json(
      {
        success: false,
        error: { code: 'AUTH_INVALID_PASSWORD', message: 'Current password is incorrect' },
      },
      400,
    )
  }

  // Change password via Better Auth
  const changeRes = await fetch(`${authUrl}/api/v1/auth/change-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: c.req.header('Cookie') ?? '' },
    body: JSON.stringify({ currentPassword, newPassword }),
  })

  if (!changeRes.ok) {
    return c.json(
      {
        success: false,
        error: { code: 'AUTH_PASSWORD_CHANGE_FAILED', message: 'Failed to change password' },
      },
      500,
    )
  }

  return c.json({ success: true, data: { message: 'Password changed successfully' } })
})
