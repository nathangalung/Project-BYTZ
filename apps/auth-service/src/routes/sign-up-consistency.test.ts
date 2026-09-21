import { memoryAdapter } from 'better-auth/adapters/memory'
import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * What the account row says and what the reply says, held together.
 *
 * The bug this file exists for: a registration that committed an account and
 * answered with an error. The caller read "Gagal mendaftar", pressed Daftar
 * again, and was told the email was already registered - both replies were
 * produced by the same working request, one of them lying.
 *
 * Two things made it possible and both are covered here.
 *
 * The pre-check in auth.ts compared the address verbatim while Better Auth
 * lowercases before it looks for a duplicate and before it inserts, so
 * `Budi@Test.com` passed a guard that `budi@test.com` would have failed, and
 * Better Auth refused it afterwards - in its own `{ code, message }` body,
 * which apps/web cannot read, so the precise reason degraded to the generic
 * one. That is the sequence `signs the same address up twice` replays.
 *
 * And `transaction: true` on the drizzle adapter (see lib/auth.ts) is what
 * keeps a failure after the INSERT from leaving the row behind. The assertion
 * that ties both together is the last describe: a row appears if and only if
 * the caller was told so.
 *
 * Driven through the composed app rather than a copy of the handler, because
 * the normalisation has to happen on the same value the forwarded body
 * carries, and a mirrored validate() would assert its own spelling.
 */

vi.setConfig({ testTimeout: 30_000 })

// The memory adapter's whole store, which is also what the sign-up pre-check
// below reads: one source of truth, so the guard and the insert cannot be
// tested against two different pictures of the same table.
const store: Record<string, Record<string, unknown>[]> = {
  user: [],
  session: [],
  account: [],
  verification: [],
}

vi.mock('better-auth/adapters/drizzle', () => ({
  drizzleAdapter: () => memoryAdapter(store),
}))

/**
 * The column and the value a `eq(column, value)` condition carries.
 *
 * The route builds its uniqueness checks with drizzle, so reading the bound
 * parameter back is how this test can answer them from the store - and how it
 * can tell that the pre-check asked for the normalised address rather than the
 * one that was typed.
 */
function readCondition(condition: unknown): { column: string; value: unknown } {
  const chunks = (condition as { queryChunks?: unknown[] }).queryChunks ?? []
  let column = ''
  let value: unknown
  for (const chunk of chunks) {
    const ctor = (chunk as { constructor?: { name?: string } })?.constructor?.name
    if (ctor === 'Param') value = (chunk as { value: unknown }).value
    else if (typeof (chunk as { name?: unknown })?.name === 'string') {
      column = (chunk as { name: string }).name
    }
  }
  return { column, value }
}

/** Every value the sign-up pre-check looked for, in order. */
const lookups: Array<{ column: string; value: unknown }> = []

vi.mock('@kerjacus/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@kerjacus/db')>()),
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: (condition: unknown) => {
          const lookup = readCondition(condition)
          lookups.push(lookup)
          return {
            limit: async () => store.user.filter((row) => row[lookup.column] === lookup.value),
          }
        },
      }),
    }),
  }),
}))

for (const [key, value] of Object.entries({
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/kerjacus',
  REDIS_URL: 'redis://localhost:6379',
  NATS_URL: 'nats://localhost:4222',
  BETTER_AUTH_SECRET: 'a-secret-that-is-at-least-32-characters',
  BETTER_AUTH_URL: 'http://localhost:3001',
  CORS_ORIGIN: 'http://localhost:5173',
})) {
  process.env[key] = value
}

const { authRoute } = await import('./auth')

// Mounted where index.ts mounts it: Better Auth routes on the path it is
// handed, so a sub-app driven on its own answers 404 to every forward.
const app = new Hono().route('/api/v1/auth', authRoute)

type SignUpBody = {
  token?: string | null
  user?: { email?: string; role?: string }
  success?: boolean
  error?: { code?: string; message?: string }
  code?: string
}

async function signUp(overrides: Record<string, unknown> = {}) {
  const res = await app.request('http://localhost:3001/api/v1/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Budi',
      email: 'budi@test.com',
      password: 'password123',
      phone: '+628123456789',
      role: 'talent',
      ...overrides,
    }),
  })
  return { res, body: (await res.json()) as SignUpBody }
}

beforeEach(() => {
  for (const model of Object.keys(store)) store[model] = []
  lookups.length = 0
})

describe('a registration that succeeds', () => {
  it('answers 2xx with the account and a session token', async () => {
    const { res, body } = await signUp()

    expect(res.status).toBe(200)
    expect(body.user?.email).toBe('budi@test.com')
    expect(body.token).toBeTruthy()
    expect(store.user).toHaveLength(1)
  })

  it('stores the address lowercased, whichever way it was typed', async () => {
    const { res, body } = await signUp({ email: '  Budi@Test.com ' })

    expect(res.status).toBe(200)
    expect(body.user?.email).toBe('budi@test.com')
    expect(store.user[0]?.email).toBe('budi@test.com')
  })

  it('looks the duplicate up by the address it will store', async () => {
    await signUp({ email: 'Budi@Test.com' })

    expect(lookups.map((l) => l.value)).toContain('budi@test.com')
    expect(lookups.map((l) => l.value)).not.toContain('Budi@Test.com')
  })
})

describe('the same address registered twice', () => {
  /**
   * The reported sequence. The second attempt used to reach Better Auth,
   * which answered 422 `{"code":"USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL"}` -
   * no `error.code`, so apps/web read UNKNOWN_ERROR and rendered "Gagal
   * mendaftar" over an account that existed and could be signed into.
   */
  it('is refused on the first attempt, in words the client can read', async () => {
    const first = await signUp({ email: 'Budi@Test.com' })
    expect(first.res.status).toBe(200)

    const second = await signUp({ email: 'Budi@Test.com', phone: '+628123456700' })

    expect(second.res.status).toBe(409)
    expect(second.body.success).toBe(false)
    expect(second.body.error?.code).toBe('AUTH_EMAIL_ALREADY_EXISTS')
    // Better Auth's own shape, which is the shape the client cannot read.
    expect(second.body).not.toHaveProperty('code')
    expect(store.user).toHaveLength(1)
  })

  it('is refused the same way whichever case the second attempt uses', async () => {
    await signUp({ email: 'budi@test.com' })

    for (const email of ['BUDI@TEST.COM', 'Budi@Test.com', ' budi@test.com ']) {
      const { res, body } = await signUp({ email, phone: '+628123456700' })

      expect(res.status, email).toBe(409)
      expect(body.error?.code, email).toBe('AUTH_EMAIL_ALREADY_EXISTS')
    }
    expect(store.user).toHaveLength(1)
  })

  it('names the phone number when that is what is taken', async () => {
    await signUp()

    const { res, body } = await signUp({ email: 'lain@test.com' })

    expect(res.status).toBe(409)
    expect(body.error?.code).toBe('AUTH_PHONE_ALREADY_EXISTS')
    expect(store.user).toHaveLength(1)
  })
})

/**
 * The invariant, not a case: whatever the request was, the row and the reply
 * agree. A refusal that leaves an account behind is the bug; so is a success
 * that stored nothing.
 */
describe('the account row and the status code never disagree', () => {
  const REGISTRATIONS: Array<{ name: string; body: Record<string, unknown> }> = [
    { name: 'a valid owner', body: { role: 'owner', email: 'owner@test.com' } },
    { name: 'a valid talent', body: { role: 'talent', email: 'talent@test.com' } },
    { name: 'an address typed with capitals', body: { email: 'Mixed@Test.com' } },
    { name: 'an admin role', body: { role: 'admin' } },
    { name: 'an unknown role', body: { role: 'superuser' } },
    { name: 'no phone number', body: { phone: undefined } },
    { name: 'a foreign phone number', body: { phone: '+1234567890' } },
    { name: 'no email', body: { email: undefined } },
    { name: 'an email that is not a string', body: { email: 42 } },
    { name: 'a password Better Auth refuses as too short', body: { password: 'short' } },
    { name: 'an address Better Auth refuses as malformed', body: { email: 'not-an-email' } },
  ]

  for (const registration of REGISTRATIONS) {
    it(`holds for ${registration.name}`, async () => {
      const { res, body } = await signUp(registration.body)

      if (res.status < 400) {
        expect(store.user, 'a 2xx must have stored the account it reported').toHaveLength(1)
        expect(body).toHaveProperty('user')
        expect(body).toHaveProperty('token')
        return
      }

      expect(store.user, 'an error must not leave an account behind').toHaveLength(0)
      expect(body.success).toBe(false)
      expect(body.error?.code, 'the client reads error.code and nothing else').toBeTruthy()
      expect(body.error?.message).toBeTruthy()
    })
  }
})
