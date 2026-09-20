import { randomInt } from 'node:crypto'
import { zValidator } from '@hono/zod-validator'
import { isProduction } from '@kerjacus/config'
import { getDb, phoneVerifications, user as userTable } from '@kerjacus/db'
import { createRateLimitStore, verifyPhoneSchema } from '@kerjacus/shared'
import { and, desc, eq, gt } from 'drizzle-orm'
import { type Context, Hono } from 'hono'
import { uuidv7 } from 'uuidv7'
import { sendOtp } from '../lib/sms'
import { type AuthVariables, sessionMiddleware } from '../middleware/session'

export const phoneVerificationRoute = new Hono<{
  Variables: AuthVariables
}>()

phoneVerificationRoute.use('*', sessionMiddleware)

/**
 * Per-user limits on issuing an OTP, on top of the per-IP limit in index.ts.
 *
 * `attempts` is a column on the OTP row, so the five-guess cap is per code, not
 * per account: requesting a new one starts the count again. The per-IP limit
 * allowed ten requests a minute, which is fifty guesses a minute at a six digit
 * code from one address and more from several - and every request is a billed
 * WhatsApp message, so the same call is also the cheapest way to spend the SMS
 * budget. The account is the thing being attacked, so the account is what has
 * to be counted.
 *
 * The cooldown is checked first and on its own key: a caller hammering resend
 * must not burn the hourly allowance the legitimate owner of that account needs
 * when a message genuinely fails to arrive.
 */
const OTP_RESEND_COOLDOWN_MS = 60_000
const OTP_WINDOW_MS = 60 * 60 * 1000
const OTP_REQUESTS_PER_WINDOW = 5

// Shared across replicas through Valkey, per process when it is unreachable,
// which is the same trade the middleware limiter makes.
const otpStore = createRateLimitStore({
  redisUrl: process.env.REDIS_URL,
  prefix: 'rl:auth:otp-user:',
})

function tooManyOtpRequests(c: Context, retryAfterSeconds: number) {
  c.header('Retry-After', String(retryAfterSeconds))
  return c.json(
    {
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many OTP requests. Wait before asking for another code.',
      },
    },
    429,
  )
}

// POST /api/v1/phone/request-otp - send OTP to user's phone
phoneVerificationRoute.post('/request-otp', async (c) => {
  const sessionUser = c.get('user')
  const db = getDb()

  // Generate 6-digit OTP. randomInt, not Math.random: this is a security token
  // and Math.random is a predictable PRNG.
  const code = String(randomInt(100000, 1000000))
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

  // Both counted only once the account is known to have a number to send to,
  // so a request that was never going to send anything spends no allowance.
  const cooldown = await otpStore.hit(`resend:${sessionUser.id}`, OTP_RESEND_COOLDOWN_MS, 1)
  if (!cooldown.allowed) return tooManyOtpRequests(c, cooldown.retryAfterSeconds)

  const quota = await otpStore.hit(
    `window:${sessionUser.id}`,
    OTP_WINDOW_MS,
    OTP_REQUESTS_PER_WINDOW,
  )
  if (!quota.allowed) return tooManyOtpRequests(c, quota.retryAfterSeconds)

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
  if (!smsResult.success && isProduction()) {
    console.error(`[OTP] SMS send failed for ${dbUser.phone}:`, smsResult.error)
  }

  return c.json({
    success: true,
    data: {
      message: 'OTP sent to your phone number',
      expiresInSeconds: 300,
      // Development only. Never let this reach a production response.
      ...(isProduction() ? {} : { devCode: code }),
    },
  })
})

// POST /api/v1/phone/verify - verify OTP code
phoneVerificationRoute.post('/verify', zValidator('json', verifyPhoneSchema), async (c) => {
  const sessionUser = c.get('user')
  const { code } = c.req.valid('json')
  const db = getDb()

  // Look the OTP up by user, NOT by the submitted code. Matching on the code
  // meant a wrong guess matched no row and returned early, so `attempts` never
  // advanced and the 5-attempt cap could never fire - the 6-digit space was
  // brute-forceable for the whole 5-minute window. Newest OTP wins, so
  // requesting a fresh code retires the previous one.
  const [verification] = await db
    .select()
    .from(phoneVerifications)
    .where(
      and(
        eq(phoneVerifications.userId, sessionUser.id),
        eq(phoneVerifications.verified, false),
        gt(phoneVerifications.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(phoneVerifications.createdAt))
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

  // Wrong code: charge an attempt, then refuse. Same message as "no pending OTP"
  // so the response does not reveal whether a code is outstanding.
  if (verification.code !== code) {
    await db
      .update(phoneVerifications)
      .set({ attempts: verification.attempts + 1 })
      .where(eq(phoneVerifications.id, verification.id))

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
