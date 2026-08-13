import { getDb, user as userTable } from '@kerjacus/db'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { auth } from '../lib/auth'

export const authRoute = new Hono()

/*
 * Error replies use the platform envelope { success, error: { code, message } }
 * with codes from the shared catalog, same as me.ts and phone-verification.ts.
 *
 * These handlers used to reply { message, code }. apps/web reads
 * errorBody.error.code and localises from that, so the lookup missed and every
 * auth failure rendered as the generic "unknown error" - which is why login and
 * register hand-rolled their own fetch instead of using the shared client.
 *
 * The message is a server-side diagnostic. It never reaches the user: the web
 * client builds its copy from the code so it can be translated.
 */

function getDirectDb() {
  return getDb(process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL)
}

// Custom sign-in: accepts email OR phone number
authRoute.post('/sign-in/email-or-phone', async (c) => {
  const body = await c.req.json()
  const { identifier, password } = body

  if (!identifier || !password) {
    return c.json(
      {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Identifier and password are required' },
      },
      400,
    )
  }

  const isPhone = identifier.startsWith('+62')
  const db = getDirectDb()

  const [foundUser] = await db
    .select({ email: userTable.email })
    .from(userTable)
    .where(isPhone ? eq(userTable.phone, identifier) : eq(userTable.email, identifier))
    .limit(1)

  // Same code and message a wrong password gets, so the reply cannot be used to
  // enumerate which emails and phone numbers hold an account.
  if (!foundUser) {
    return c.json(
      {
        success: false,
        error: { code: 'AUTH_INVALID_CREDENTIALS', message: 'Invalid credentials' },
      },
      401,
    )
  }

  // Create a NEW request for Better Auth (original body is consumed)
  const signInReq = new Request(`${process.env.BETTER_AUTH_URL}/api/v1/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: foundUser.email, password }),
  })

  return auth.handler(signInReq)
})

// Custom sign-up: validate phone+email uniqueness, then forward to Better Auth
authRoute.post('/sign-up/email', async (c) => {
  // Clone the body so Better Auth can read it too
  const bodyText = await c.req.text()
  const body = JSON.parse(bodyText)

  // Block admin registration and validate role
  const validRoles = ['owner', 'talent']
  if (body.role && !validRoles.includes(body.role)) {
    return c.json(
      {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid role. Must be owner or talent' },
      },
      400,
    )
  }

  // Validate phone presence and format
  if (!body.phone) {
    return c.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'Phone number is required' } },
      400,
    )
  }

  if (!/^\+62\d{9,13}$/.test(body.phone)) {
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

  if (!body.email) {
    return c.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'Email is required' } },
      400,
    )
  }

  const db = getDirectDb()

  // Check phone uniqueness
  const [existingPhone] = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.phone, body.phone))
    .limit(1)

  // Generic CONFLICT because the shared catalog has no phone-specific code.
  // These are the only two 409s this route emits and the email duplicate has
  // its own code, so the web register page reads CONFLICT as the phone
  // duplicate. Adding a third 409 here breaks that copy - give it its own code.
  if (existingPhone) {
    return c.json(
      { success: false, error: { code: 'CONFLICT', message: 'Phone number already registered' } },
      409,
    )
  }

  // Check email uniqueness
  const [existingEmail] = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.email, body.email))
    .limit(1)

  if (existingEmail) {
    return c.json(
      {
        success: false,
        error: { code: 'AUTH_EMAIL_ALREADY_EXISTS', message: 'Email already registered' },
      },
      409,
    )
  }

  // Create a NEW request for Better Auth (our body read consumed the original)
  const signUpReq = new Request(c.req.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: bodyText,
  })

  return auth.handler(signUpReq)
})

// Fields the account holder must not set.
//
// Better Auth's update-user takes an arbitrary body and writes through any
// additionalField declared input: true. role and phone both are, because sign-up
// needs them, and update-user reuses the same declaration with no guard of its
// own. So a signed-in owner could POST {"role":"admin"} and gain the admin
// panel, dispute decisions and the platform fee breakdown. phone is here too:
// changing it leaves phoneVerified true, which skips OTP and defeats the
// one-account-per-number rule.
const PROTECTED_USER_FIELDS = ['role', 'phone', 'phoneVerified', 'isVerified'] as const

authRoute.post('/update-user', async (c) => {
  const bodyText = await c.req.text()

  let body: Record<string, unknown>
  try {
    body = bodyText ? JSON.parse(bodyText) : {}
  } catch {
    return c.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON body' } },
      400,
    )
  }

  const attempted = PROTECTED_USER_FIELDS.filter((f) => f in body)
  if (attempted.length > 0) {
    return c.json(
      {
        success: false,
        error: { code: 'AUTH_FORBIDDEN', message: `Cannot update: ${attempted.join(', ')}` },
      },
      403,
    )
  }

  return auth.handler(
    new Request(c.req.url, {
      method: 'POST',
      headers: c.req.raw.headers,
      body: bodyText,
    }),
  )
})

// Better Auth catch-all for all other auth routes
authRoute.all('/*', async (c) => {
  return auth.handler(c.req.raw)
})
