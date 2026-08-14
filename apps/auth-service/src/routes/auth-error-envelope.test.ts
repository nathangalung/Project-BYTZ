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

vi.mock('../lib/auth', () => ({
  auth: {
    handler: async (req: Request) => {
      forwarded.push({ method: req.method, url: req.url })
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
    code: 'VALIDATION_ERROR',
  },
  {
    name: 'sign-up with an unknown role',
    path: '/sign-up/email',
    body: { ...VALID_SIGN_UP, role: 'superuser' },
    rows: [],
    status: 400,
    code: 'VALIDATION_ERROR',
  },
  {
    name: 'sign-up without a phone number',
    path: '/sign-up/email',
    body: { ...VALID_SIGN_UP, phone: undefined },
    rows: [],
    status: 400,
    code: 'VALIDATION_ERROR',
  },
  {
    name: 'sign-up with a non-Indonesian phone number',
    path: '/sign-up/email',
    body: { ...VALID_SIGN_UP, phone: '+1234567890' },
    rows: [],
    status: 400,
    code: 'VALIDATION_ERROR',
  },
  {
    name: 'sign-up with too few digits after +62',
    path: '/sign-up/email',
    body: { ...VALID_SIGN_UP, phone: '+6212345678' },
    rows: [],
    status: 400,
    code: 'VALIDATION_ERROR',
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
    code: 'CONFLICT',
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

describe('the 409 codes register.tsx reads', () => {
  /**
   * The catalog has no phone-specific code, so the phone duplicate replies
   * CONFLICT and apps/web/src/routes/_public/register.tsx renders it as
   * "nomor telepon sudah terdaftar". That copy is only correct while these are
   * the route's only two 409s. A third one silently mislabels itself.
   */
  it('stay at two, so CONFLICT can only mean the phone duplicate', () => {
    expect(source.match(/,\s*409,?\s*\)/g) ?? []).toHaveLength(2)
  })

  it('distinguishes the phone duplicate from the email duplicate', async () => {
    const phone = await post('/sign-up/email', VALID_SIGN_UP, [[{ id: 'existing' }]])
    const email = await post('/sign-up/email', VALID_SIGN_UP, [[], [{ id: 'existing' }]])

    expect(phone.body.error?.code).toBe('CONFLICT')
    expect(email.body.error?.code).toBe('AUTH_EMAIL_ALREADY_EXISTS')
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
