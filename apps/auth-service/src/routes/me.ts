import { getDb, user as userTable } from '@bytz/db'
import { zValidator } from '@hono/zod-validator'
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
