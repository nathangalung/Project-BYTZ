import { getDb, user as userTable } from '@kerjacus/db'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { auth } from '../lib/auth'
import { toPlatformEnvelope } from '../lib/better-auth-errors'
import { resolveDatabaseUrl } from '../lib/database-url'

export const authRoute = new Hono()

/**
 * Everything this file forwards goes through here.
 *
 * Better Auth answers a failure in its own `{ code, message }` shape, which
 * the web client cannot read, so every refusal it produced - a duplicate
 * email, an unverified address, a spent reset token - reached the user as the
 * generic "something went wrong". Rewriting the reply at the one place that
 * calls Better Auth is what keeps the codes the client maps and the codes the
 * server sends from drifting again.
 */
async function forward(request: Request): Promise<Response> {
  return toPlatformEnvelope(await auth.handler(request))
}

/**
 * The address as it will be stored.
 *
 * Better Auth lowercases before it looks for a duplicate and before it
 * inserts, and the uniqueness pre-check below did not. `Budi@Test.com` and
 * `budi@test.com` are one account to Postgres' unique index and to Better
 * Auth, but were two different strings to the pre-check: the check passed, the
 * request reached Better Auth, and Better Auth refused it in a body nothing
 * downstream could read. Normalising here makes the guard and the insert agree
 * on what the same address is.
 */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

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
  return getDb(resolveDatabaseUrl())
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

  // Same normalisation the sign-up applies, for the same reason: an address
  // typed with a capital letter is the same account, and looking it up
  // verbatim answered "invalid credentials" for a password that was correct.
  const [foundUser] = await db
    .select({ email: userTable.email, deletedAt: userTable.deletedAt })
    .from(userTable)
    .where(
      isPhone ? eq(userTable.phone, identifier) : eq(userTable.email, normalizeEmail(identifier)),
    )
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

  const signedIn = await forward(signInReq)

  /*
   * A suspended account is told so, and only once the password was right.
   *
   * Checking deletedAt before the forward would answer "suspended" to anyone
   * who guessed the address, which is an enumeration oracle with a bonus fact
   * attached. Checking it after means the reply is only reachable by the
   * account holder, who is owed a reason that is not "wrong password" - that
   * sends them through password recovery for a lock recovery cannot lift.
   *
   * The session row Better Auth just wrote is abandoned rather than handed
   * over: its cookie is on the response being discarded, so nothing can
   * present it, and sessionMiddleware refuses a soft-deleted account anyway.
   */
  if (signedIn.status < 400 && foundUser.deletedAt) {
    return c.json(
      {
        success: false,
        error: { code: 'AUTH_ACCOUNT_SUSPENDED', message: 'Account suspended' },
      },
      403,
    )
  }

  return signedIn
})

// Custom sign-up: validate phone+email uniqueness, then forward to Better Auth
authRoute.post('/sign-up/email', async (c) => {
  // Clone the body so Better Auth can read it too
  const bodyText = await c.req.text()
  const body = JSON.parse(bodyText)

  // Block admin registration and validate role.
  //
  // Its own code, not the shared VALIDATION_ERROR: the register page has one
  // error line and three ways to fill it, so the reason has to travel with the
  // refusal or the caller is told to check a form that looks correct.
  const validRoles = ['owner', 'talent']
  if (body.role && !validRoles.includes(body.role)) {
    return c.json(
      {
        success: false,
        error: { code: 'AUTH_INVALID_ROLE', message: 'Invalid role. Must be owner or talent' },
      },
      400,
    )
  }

  // Validate phone presence and format
  if (!body.phone) {
    return c.json(
      {
        success: false,
        error: { code: 'AUTH_INVALID_PHONE', message: 'Phone number is required' },
      },
      400,
    )
  }

  if (!/^\+62\d{9,13}$/.test(body.phone)) {
    return c.json(
      {
        success: false,
        error: {
          code: 'AUTH_INVALID_PHONE',
          message: 'Invalid phone format. Use +62 followed by 9-13 digits',
        },
      },
      400,
    )
  }

  if (typeof body.email !== 'string' || !body.email) {
    return c.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'Email is required' } },
      400,
    )
  }

  const email = normalizeEmail(body.email)

  const db = getDirectDb()

  // Check phone uniqueness
  const [existingPhone] = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.phone, body.phone))
    .limit(1)

  if (existingPhone) {
    return c.json(
      {
        success: false,
        error: { code: 'AUTH_PHONE_ALREADY_EXISTS', message: 'Phone number already registered' },
      },
      409,
    )
  }

  // Check email uniqueness, on the normalised address, because that is the one
  // the unique index and Better Auth both compare.
  const [existingEmail] = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.email, email))
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

  // Create a NEW request for Better Auth (our body read consumed the original).
  // It carries the normalised address, so the row Better Auth writes is the row
  // the next registration's pre-check will find.
  const signUpReq = new Request(c.req.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, email }),
  })

  return forward(signUpReq)
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

  return forward(
    new Request(c.req.url, {
      method: 'POST',
      headers: c.req.raw.headers,
      body: bodyText,
    }),
  )
})

// Better Auth catch-all for all other auth routes.
//
// Every guard above is attached to an exact path, and Hono matches paths
// literally: it normalises neither a trailing slash nor a doubled one. So
// POST /update-user/ and POST /sign-up/email/ miss their guarded handler, fall
// through to here, and used to be forwarded to Better Auth with the body
// untouched - which is the whole bypass. Better Auth declares its own routes
// without either spelling, so a path that differs only by a slash is never one
// of them: refusing is the same answer it would give, reached before the body
// is handed over.
authRoute.all('/*', async (c) => {
  const { pathname } = new URL(c.req.url)
  if (pathname.endsWith('/') || pathname.includes('//')) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Not found' } }, 404)
  }

  return forward(c.req.raw)
})
