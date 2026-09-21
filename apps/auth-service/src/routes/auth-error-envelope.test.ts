import { readFileSync } from 'node:fs'
import { ERROR_CODES } from '@kerjacus/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * These routes replied { message, code }. apps/web/src/lib/api.ts reads
 * errorBody.error.code, so the lookup resolved undefined and every auth failure
 * localised to the generic "unknown error" - which is why login and register
 * were the only two pages that abandoned the shared client.
 *
 * Drive the real route, not a copy of its logic: a mirrored validate() would
 * have passed throughout the bug, because the shape it asserts is its own.
 */

// Rows the next .limit() resolves to, in call order. Sign-up selects twice:
// phone first, then email.
let selectResults: unknown[][] = []

// Requests that reached Better Auth, so the catch-all can be checked for what
// it forwards rather than only for the status it returns.
const forwarded: Array<{ method: string; url: string }> = []

/**
 * Stands in for Better Auth, including the shape of its refusals: a top-level
 * `{ code, message }`, which is exactly what apps/web cannot read. A stub that
 * only ever answered 200 could not show that the route re-states it.
 */
const WRONG_PASSWORD = 'the-password-better-auth-rejects'

vi.mock('../lib/auth', () => ({
  auth: {
    handler: async (req: Request) => {
      forwarded.push({ method: req.method, url: req.url })
      const sent = await req
        .clone()
        .text()
        .catch(() => '')
      if (sent.includes(WRONG_PASSWORD)) {
        return new Response(
          JSON.stringify({
            code: 'INVALID_EMAIL_OR_PASSWORD',
            message: 'Invalid email or password',
          }),
          { status: 401, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response(JSON.stringify({ user: { role: 'owner' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    },
  },
}))

vi.mock('@kerjacus/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@kerjacus/db')>()),
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => selectResults.shift() ?? [] }),
      }),
    }),
  }),
}))

// The sign-in forward builds an absolute URL from this.
process.env.BETTER_AUTH_URL ??= 'http://localhost:3001'

const { authRoute } = await import('./auth')

const CATALOG: string[] = Object.values(ERROR_CODES)
const source = readFileSync(new URL('./auth.ts', import.meta.url), 'utf8')

const VALID_SIGN_UP = {
  name: 'Test User',
  email: 'user@test.com',
  password: 'password123',
  phone: '+6281234567890',
  role: 'owner',
}

type Body = Record<string, unknown> & { error?: { code?: string; message?: string } }

async function post(path: string, body: unknown, rows: readonly (readonly unknown[])[] = []) {
  // Copied, so a case declared `as const` can be replayed across its three assertions.
  selectResults = rows.map((row) => [...row])
  const res = await authRoute.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { res, body: (await res.json()) as Body }
}

const FAILURES = [
  {
    name: 'sign-in without credentials',
    path: '/sign-in/email-or-phone',
    body: {},
    rows: [],
    status: 400,
    code: 'VALIDATION_ERROR',
  },
  {
    name: 'sign-in for an account that does not exist',
    path: '/sign-in/email-or-phone',
    body: { identifier: 'nobody@test.com', password: 'password123' },
    rows: [[]],
    status: 401,
    code: 'AUTH_INVALID_CREDENTIALS',
  },
  {
    name: 'sign-up as admin',
    path: '/sign-up/email',
    body: { ...VALID_SIGN_UP, role: 'admin' },
    rows: [],
    status: 400,
    code: 'AUTH_INVALID_ROLE',
  },
  {
    name: 'sign-up with an unknown role',
    path: '/sign-up/email',
    body: { ...VALID_SIGN_UP, role: 'superuser' },
    rows: [],
    status: 400,
    code: 'AUTH_INVALID_ROLE',
  },
  {
    name: 'sign-up without a phone number',
    path: '/sign-up/email',
    body: { ...VALID_SIGN_UP, phone: undefined },
    rows: [],
    status: 400,
    code: 'AUTH_INVALID_PHONE',
  },
  {
    name: 'sign-up with a non-Indonesian phone number',
    path: '/sign-up/email',
    body: { ...VALID_SIGN_UP, phone: '+1234567890' },
    rows: [],
    status: 400,
    code: 'AUTH_INVALID_PHONE',
  },
  {
    name: 'sign-up with too few digits after +62',
    path: '/sign-up/email',
    body: { ...VALID_SIGN_UP, phone: '+6212345678' },
    rows: [],
    status: 400,
    code: 'AUTH_INVALID_PHONE',
  },
  {
    name: 'sign-up without an email',
    path: '/sign-up/email',
    body: { ...VALID_SIGN_UP, email: undefined },
    rows: [],
    status: 400,
    code: 'VALIDATION_ERROR',
  },
  {
    name: 'sign-up on a phone number already taken',
    path: '/sign-up/email',
    body: VALID_SIGN_UP,
    rows: [[{ id: 'existing' }]],
    status: 409,
    code: 'AUTH_PHONE_ALREADY_EXISTS',
  },
  {
    name: 'sign-up on an email already taken',
    path: '/sign-up/email',
    body: VALID_SIGN_UP,
    rows: [[], [{ id: 'existing' }]],
    status: 409,
    code: 'AUTH_EMAIL_ALREADY_EXISTS',
  },
  {
    name: 'update-user touching a protected field',
    path: '/update-user',
    body: { role: 'admin' },
    rows: [],
    status: 403,
    code: 'AUTH_FORBIDDEN',
  },
] as const

beforeEach(() => {
  selectResults = []
})

describe('every hand-written error reply', () => {
  for (const testCase of FAILURES) {
    it(`${testCase.name} carries error.code, the field api.ts reads`, async () => {
      const { res, body } = await post(testCase.path, testCase.body, testCase.rows)

      expect(res.status).toBe(testCase.status)
      expect(body.success).toBe(false)
      expect(body.error?.code).toBe(testCase.code)
      expect(body.error?.message, 'a code with no message tells the operator nothing').toBeTruthy()
    })

    it(`${testCase.name} uses a code the shared catalog defines`, async () => {
      const { body } = await post(testCase.path, testCase.body, testCase.rows)

      // An invented code has no i18n key, so the web client falls back to the
      // generic message and the user learns nothing about what went wrong.
      expect(CATALOG).toContain(body.error?.code)
    })

    it(`${testCase.name} does not reply in the old top-level shape`, async () => {
      const { body } = await post(testCase.path, testCase.body, testCase.rows)

      expect(body).not.toHaveProperty('code')
      expect(body).not.toHaveProperty('message')
    })
  }

  it('rejects a malformed body without forwarding it', async () => {
    const res = await authRoute.request('/update-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    })
    const body = (await res.json()) as Body

    expect(res.status).toBe(400)
    expect(body.error?.code).toBe('VALIDATION_ERROR')
  })
})

describe('the codes register.tsx reads', () => {
  /**
   * The phone duplicate used to reply with the generic CONFLICT, and
   * apps/web/src/routes/_public/register.tsx rendered CONFLICT as "nomor
   * telepon sudah terdaftar". That copy held only while sign-up emitted
   * exactly two 409s - a rule nothing enforced, shared with the thirty other
   * handlers in this repo that raise CONFLICT. Each reason now carries a code
   * of its own, so the page cannot mislabel one.
   */
  it('never answers a sign-up with the generic CONFLICT', () => {
    expect(source).not.toContain("'CONFLICT'")
  })

  it('gives each rejected field a code of its own', async () => {
    const phone = await post('/sign-up/email', VALID_SIGN_UP, [[{ id: 'existing' }]])
    const email = await post('/sign-up/email', VALID_SIGN_UP, [[], [{ id: 'existing' }]])
    const role = await post('/sign-up/email', { ...VALID_SIGN_UP, role: 'admin' })
    const badPhone = await post('/sign-up/email', { ...VALID_SIGN_UP, phone: '+1234567890' })

    expect(phone.body.error?.code).toBe('AUTH_PHONE_ALREADY_EXISTS')
    expect(email.body.error?.code).toBe('AUTH_EMAIL_ALREADY_EXISTS')
    expect(role.body.error?.code).toBe('AUTH_INVALID_ROLE')
    expect(badPhone.body.error?.code).toBe('AUTH_INVALID_PHONE')

    const codes = [phone, email, role, badPhone].map((r) => r.body.error?.code)
    expect(new Set(codes).size, 'two reasons sharing a code is the bug').toBe(codes.length)
  })
})

describe('sign-in account enumeration', () => {
  // A distinct "account not found" reply told an attacker which emails and
  // phone numbers are registered, one request at a time.
  it('gives an unknown account the same code a wrong password gets', async () => {
    const { body } = await post(
      '/sign-in/email-or-phone',
      { identifier: '+6281234567890', password: 'password123' },
      [[]],
    )

    expect(body.error?.code).toBe('AUTH_INVALID_CREDENTIALS')
    expect(JSON.stringify(body).toLowerCase()).not.toContain('not found')
  })
})

describe('the successful paths still reach Better Auth', () => {
  it('forwards a valid sign-up', async () => {
    const { res } = await post('/sign-up/email', VALID_SIGN_UP, [[], []])
    expect(res.status).toBe(200)
  })

  it('forwards a valid talent sign-up', async () => {
    const { res } = await post('/sign-up/email', { ...VALID_SIGN_UP, role: 'talent' }, [[], []])
    expect(res.status).toBe(200)
  })

  it('forwards a sign-in once the identifier resolves', async () => {
    const { res } = await post(
      '/sign-in/email-or-phone',
      { identifier: 'user@test.com', password: 'password123' },
      [[{ email: 'user@test.com' }]],
    )
    expect(res.status).toBe(200)
  })
})

/**
 * A suspension is not a typo.
 *
 * Told "invalid credentials", the account holder retypes the password, then
 * walks the whole reset flow for a lock no new password lifts. The reason is
 * only given once Better Auth has accepted the password, so the reply stays
 * unreachable for anyone who merely guessed the address.
 */
describe('a sign-in by a suspended account', () => {
  const SUSPENDED = { email: 'user@test.com', deletedAt: '2026-01-01T00:00:00.000Z' }

  it('is refused with the reason, not with invalid credentials', async () => {
    const { res, body } = await post(
      '/sign-in/email-or-phone',
      { identifier: 'user@test.com', password: 'password123' },
      [[SUSPENDED]],
    )

    expect(res.status).toBe(403)
    expect(body.error?.code).toBe('AUTH_ACCOUNT_SUSPENDED')
  })

  it('hands over no session for the account it just refused', async () => {
    const { res } = await post(
      '/sign-in/email-or-phone',
      { identifier: 'user@test.com', password: 'password123' },
      [[SUSPENDED]],
    )

    expect(res.headers.get('set-cookie')).toBeNull()
  })

  /**
   * Still nothing to say when the password was wrong: Better Auth's own
   * refusal comes first, and it arrives re-stated in the envelope rather than
   * in the `{ code, message }` shape the client reads as UNKNOWN_ERROR.
   */
  it('is indistinguishable from a wrong password when the password is wrong', async () => {
    const { res, body } = await post(
      '/sign-in/email-or-phone',
      { identifier: 'user@test.com', password: WRONG_PASSWORD },
      [[SUSPENDED]],
    )

    expect(res.status).toBe(401)
    expect(body.success).toBe(false)
    expect(body.error?.code).toBe('AUTH_INVALID_CREDENTIALS')
    expect(body).not.toHaveProperty('code')
  })
})

/**
 * Three routes are hand-written; every other Better Auth endpoint - sign-out,
 * get-session, the OAuth callback - reaches the library through the catch-all.
 * A rule that rewrote the method or the path would break them all at once and
 * none of them has a test of its own here.
 */
describe('the catch-all that carries the rest of Better Auth', () => {
  beforeEach(() => {
    forwarded.length = 0
  })

  const UNMATCHED = [
    { method: 'GET', path: '/get-session' },
    { method: 'POST', path: '/sign-out' },
    { method: 'GET', path: '/callback/google' },
    { method: 'POST', path: '/forget-password' },
  ] as const

  for (const testCase of UNMATCHED) {
    it(`hands ${testCase.method} ${testCase.path} over unchanged`, async () => {
      const res = await authRoute.request(testCase.path, { method: testCase.method })

      expect(res.status).toBe(200)
      expect(forwarded).toHaveLength(1)
      expect(forwarded[0]?.method).toBe(testCase.method)
      expect(new URL(String(forwarded[0]?.url)).pathname).toBe(testCase.path)
    })
  }

  it('does not intercept a route it has a rule for', async () => {
    await post('/update-user', { role: 'admin' })

    // The guard replied 403 itself; nothing reached Better Auth.
    expect(forwarded).toHaveLength(0)
  })
})
