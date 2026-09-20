import { getDb, user as userTable } from '@kerjacus/db'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { type AuthVariables, sessionMiddleware } from '../middleware/session'

/**
 * The one sanctioned path that writes `role` after the row exists.
 *
 * Google sign-in goes through Better Auth's catch-all, so it never reaches the
 * sign-up handler that validates a role and a phone number. The account is
 * created on the column default - owner - with no phone, which left a talent
 * who chose Google permanently filed as an owner and with no way back: role is
 * in PROTECTED_USER_FIELDS and /me refuses it too.
 *
 * `phone IS NULL` is the "not onboarded yet" signal. Every email sign-up
 * validates a phone before Better Auth ever sees the body, so a row without
 * one can only have come from OAuth. That makes this endpoint one-time by
 * construction: it writes the phone in the same statement as the role, so the
 * second call finds a phone and is refused. No new column, and no window where
 * role is writable twice.
 *
 * It lives in its own file rather than in auth.ts because auth.ts carries an
 * invariant - exactly two 409 replies, so the web register page can read
 * CONFLICT as the phone duplicate - that a third one would silently break.
 */
export const onboardingRoute = new Hono<{ Variables: AuthVariables }>()

onboardingRoute.use('*', sessionMiddleware)

const VALID_ROLES = ['owner', 'talent']

// Same rule the email sign-up applies, so the two paths cannot disagree about
// what a phone number is.
const PHONE_PATTERN = /^\+62\d{9,13}$/

// POST /api/v1/auth/complete-onboarding
onboardingRoute.post('/complete-onboarding', async (c) => {
  const sessionUser = c.get('user')

  let body: Record<string, unknown>
  try {
    body = (await c.req.json()) as Record<string, unknown>
  } catch {
    return c.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON body' } },
      400,
    )
  }

  const role = body.role
  if (typeof role !== 'string' || !VALID_ROLES.includes(role)) {
    return c.json(
      {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid role. Must be owner or talent' },
      },
      400,
    )
  }

  const phone = body.phone
  if (typeof phone !== 'string' || !PHONE_PATTERN.test(phone)) {
    return c.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid phone format. Use +62 followed by 9-13 digits',
        },
      },
      400,
    )
  }

  const db = getDb()

  const [current] = await db
    .select({
      id: userTable.id,
      email: userTable.email,
      name: userTable.name,
      phone: userTable.phone,
      avatarUrl: userTable.avatarUrl,
      locale: userTable.locale,
    })
    .from(userTable)
    .where(eq(userTable.id, sessionUser.id))
    .limit(1)

  if (!current) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'User not found' } }, 404)
  }

  // Already onboarded. Every account that reaches here with a phone chose its
  // role once already, and role stays immutable after that.
  if (current.phone) {
    return c.json(
      {
        success: false,
        error: { code: 'AUTH_FORBIDDEN', message: 'Onboarding already completed' },
      },
      403,
    )
  }

  const [phoneOwner] = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.phone, phone))
    .limit(1)

  // One account per number, the same rule sign-up enforces. Without it OAuth
  // would be a way around it.
  if (phoneOwner) {
    return c.json(
      { success: false, error: { code: 'CONFLICT', message: 'Phone number already registered' } },
      409,
    )
  }

  await db
    .update(userTable)
    .set({ role, phone, phoneVerified: false, updatedAt: new Date() })
    .where(eq(userTable.id, sessionUser.id))

  /*
   * Reply with the row as it now stands.
   *
   * Better Auth caches the session in a cookie for five minutes, so its own
   * copy still carries the default role. The web client writes this straight
   * into its store rather than waiting the cache out on a stale role.
   */
  return c.json({
    success: true,
    data: {
      id: current.id,
      email: current.email,
      name: current.name,
      phone,
      phoneVerified: false,
      role,
      avatarUrl: current.avatarUrl,
      locale: current.locale,
    },
  })
})
