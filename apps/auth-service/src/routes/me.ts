import { zValidator } from '@hono/zod-validator'
import { getDb, userNotificationPreferences as prefsTable, user as userTable } from '@kerjacus/db'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { uuidv7 } from 'uuidv7'
import { z } from 'zod'
import type { AuthVariables } from '../middleware/session'
import { sessionMiddleware } from '../middleware/session'

export const meRoute = new Hono<{ Variables: AuthVariables }>()

meRoute.use('*', sessionMiddleware)

type NotificationPreferences = {
  emailNotifications: boolean
  projectUpdates: boolean
  paymentAlerts: boolean
}

/**
 * What an account with no preferences row is treated as having.
 *
 * Fail open, and match the column defaults in
 * packages/db/src/schema/shared.ts. notification-service applies the same
 * defaults over its own LEFT JOIN, so a user who has never opened settings is
 * described identically on both sides.
 */
const PREF_DEFAULTS: NotificationPreferences = {
  emailNotifications: true,
  projectUpdates: true,
  paymentAlerts: true,
}

const prefColumns = {
  emailNotifications: prefsTable.emailNotifications,
  projectUpdates: prefsTable.projectUpdates,
  paymentAlerts: prefsTable.paymentAlerts,
}

type Db = ReturnType<typeof getDb>

async function readPreferences(db: Db, userId: string): Promise<NotificationPreferences> {
  const [row] = await db
    .select(prefColumns)
    .from(prefsTable)
    .where(eq(prefsTable.userId, userId))
    .limit(1)

  return row ?? PREF_DEFAULTS
}

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

  const notificationPreferences = await readPreferences(db, sessionUser.id)

  return c.json({ success: true, data: { ...foundUser, notificationPreferences } })
})

const updateProfileSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  phone: z
    .string()
    .regex(/^\+62\d{9,13}$/, 'Indonesian format: +62 + 9-13 digits')
    .optional(),
  locale: z.enum(['id', 'en']).optional(),
  // The settings page uploads to storage first and sends back the unsigned
  // URL. Bounded because it goes straight into a column and an <img src>.
  avatarUrl: z.string().url().max(2048).optional(),
  // .partial() so one toggle can be sent on its own; the upsert below writes
  // only the keys that arrived, leaving the rest of the row standing.
  notificationPreferences: z
    .object({
      emailNotifications: z.boolean(),
      projectUpdates: z.boolean(),
      paymentAlerts: z.boolean(),
    })
    .partial()
    .optional(),
})

/**
 * Writes the supplied toggles and returns the whole row.
 *
 * An upsert rather than read-modify-write: the row may not exist yet (it is
 * created by the seed and by nothing else), and two toggles flipped in quick
 * succession would otherwise race on the read.
 */
async function writePreferences(
  db: Db,
  userId: string,
  patch: Partial<NotificationPreferences>,
): Promise<NotificationPreferences> {
  const [row] = await db
    .insert(prefsTable)
    .values({ id: uuidv7(), userId, ...patch })
    .onConflictDoUpdate({
      target: prefsTable.userId,
      set: { ...patch, updatedAt: new Date() },
    })
    .returning(prefColumns)

  return row ?? { ...PREF_DEFAULTS, ...patch }
}

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
      ...(body.avatarUrl !== undefined ? { avatarUrl: body.avatarUrl } : {}),
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

  const notificationPreferences = body.notificationPreferences
    ? await writePreferences(db, sessionUser.id, body.notificationPreferences)
    : await readPreferences(db, sessionUser.id)

  return c.json({ success: true, data: { ...updated, notificationPreferences } })
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
