import { zValidator } from '@hono/zod-validator'
import { getDb, phoneVerifications, user as userTable } from '@kerjacus/db'
import { verifyPhoneSchema } from '@kerjacus/shared'
import { and, eq, gt } from 'drizzle-orm'
import { Hono } from 'hono'
import { uuidv7 } from 'uuidv7'
import { sendOtp } from '../lib/sms'
import { type AuthVariables, sessionMiddleware } from '../middleware/session'

export const phoneVerificationRoute = new Hono<{
  Variables: AuthVariables
}>()

phoneVerificationRoute.use('*', sessionMiddleware)

// POST /api/v1/phone/request-otp - send OTP to user's phone
phoneVerificationRoute.post('/request-otp', async (c) => {
  const sessionUser = c.get('user')
  const db = getDb()

  // Generate 6-digit OTP
  const code = String(Math.floor(100000 + Math.random() * 900000))
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000) // 5 minutes

  // Get user's phone
  const [dbUser] = await db
    .select({ phone: userTable.phone })
    .from(userTable)
    .where(eq(userTable.id, sessionUser.id))
    .limit(1)

  if (!dbUser?.phone) {
    return c.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'No phone number on account',
        },
      },
      400,
    )
  }

  // Create verification record
  await db.insert(phoneVerifications).values({
    id: uuidv7(),
    userId: sessionUser.id,
    phone: dbUser.phone,
    code,
    expiresAt,
  })

  // Send OTP via SMS gateway (falls back to console.log in dev)
  const smsResult = await sendOtp(dbUser.phone, code)
  if (!smsResult.success && process.env.NODE_ENV === 'production') {
    console.error(`[OTP] SMS send failed for ${dbUser.phone}:`, smsResult.error)
  }

  return c.json({
    success: true,
    data: {
      message: 'OTP sent to your phone number',
      expiresInSeconds: 300,
      // Only in development:
      ...(process.env.NODE_ENV !== 'production' ? { devCode: code } : {}),
    },
  })
})

// POST /api/v1/phone/verify - verify OTP code
phoneVerificationRoute.post('/verify', zValidator('json', verifyPhoneSchema), async (c) => {
  const sessionUser = c.get('user')
  const { code } = c.req.valid('json')
  const db = getDb()

  // Find valid OTP
  const [verification] = await db
    .select()
    .from(phoneVerifications)
    .where(
      and(
        eq(phoneVerifications.userId, sessionUser.id),
        eq(phoneVerifications.code, code),
        eq(phoneVerifications.verified, false),
        gt(phoneVerifications.expiresAt, new Date()),
      ),
    )
    .orderBy(phoneVerifications.createdAt)
    .limit(1)

  if (!verification) {
    return c.json(
      {
        success: false,
        error: {
          code: 'AUTH_INVALID_TOKEN',
          message: 'Invalid or expired OTP code',
        },
      },
      400,
    )
  }

  // Check max attempts (5)
  if (verification.attempts >= 5) {
    return c.json(
      {
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many attempts. Request a new OTP.',
        },
      },
      429,
    )
  }

  // Atomic: increment attempts, mark verified, update user
  await db.transaction(async (tx) => {
    await tx
      .update(phoneVerifications)
      .set({ attempts: verification.attempts + 1, verified: true })
      .where(eq(phoneVerifications.id, verification.id))

    await tx
      .update(userTable)
      .set({ phoneVerified: true, updatedAt: new Date() })
      .where(eq(userTable.id, sessionUser.id))
  })

  return c.json({
    success: true,
    data: { message: 'Phone number verified successfully' },
  })
})

// GET /api/v1/phone/status - check verification status
phoneVerificationRoute.get('/status', async (c) => {
  const sessionUser = c.get('user')
  const db = getDb()

  const [dbUser] = await db
    .select({ phone: userTable.phone, phoneVerified: userTable.phoneVerified })
    .from(userTable)
    .where(eq(userTable.id, sessionUser.id))
    .limit(1)

  return c.json({
    success: true,
    data: {
      phone: dbUser?.phone ?? null,
      phoneVerified: dbUser?.phoneVerified ?? false,
    },
  })
})
