import { memoryAdapter } from 'better-auth/adapters/memory'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Registration, end to end, against a real Better Auth.
 *
 * auth.test.ts reads the configuration object; this drives the library with it.
 * The difference matters here: `role` is declared `input: false`, which on a
 * create does not refuse a submitted role but silently replaces it with the
 * `owner` default, and the create hook is what puts the registration's real
 * choice back. A test that called that hook directly would pass whether or not
 * Better Auth ever calls it, and every talent sign-up would land as an owner
 * with nothing in the response to say so. So the assertions below are on the
 * persisted row, after auth.handler has served the request.
 */

vi.setConfig({ testTimeout: 30_000 })

// The adapter's whole store. Reset per test, and read back as the database.
const store: Record<string, unknown[]> = { user: [], session: [], account: [], verification: [] }

vi.mock('better-auth/adapters/drizzle', () => ({
  drizzleAdapter: () => memoryAdapter(store),
}))
vi.mock('@kerjacus/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@kerjacus/db')>()),
  getDb: () => ({}),
}))
vi.mock('./email', () => ({
  sendEmail: vi.fn(async () => undefined),
  buildVerificationEmail: () => ({ subject: 's', html: 'h', text: 't' }),
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

const { auth } = await import('./auth')

type StoredUser = { email: string; role?: string; phone?: string }

function signUp(body: Record<string, unknown>, path = '/sign-up/email') {
  return auth.handler(
    new Request(`http://localhost:3001/api/v1/auth${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', origin: 'http://localhost:5173' },
      body: JSON.stringify(body),
    }),
  )
}

const REGISTRATION = {
  name: 'Budi',
  password: 'password123',
  phone: '+628123456789',
}

function users() {
  return store.user as StoredUser[]
}

beforeEach(() => {
  for (const model of Object.keys(store)) store[model] = []
})

describe('email sign-up still assigns the role it was asked for', () => {
  it('files a talent as a talent', async () => {
    const res = await signUp({ ...REGISTRATION, email: 'talent@test.com', role: 'talent' })

    expect(res.status).toBe(200)
    expect(users()).toHaveLength(1)
    expect(users()[0]?.role).toBe('talent')
  })

  it('files an owner as an owner', async () => {
    const res = await signUp({ ...REGISTRATION, email: 'owner@test.com', role: 'owner' })

    expect(res.status).toBe(200)
    expect(users()[0]?.role).toBe('owner')
  })

  /** Least privilege when the body names nothing, which is the OAuth shape. */
  it('falls back to owner when no role is named', async () => {
    const res = await signUp({ ...REGISTRATION, email: 'plain@test.com' })

    expect(res.status).toBe(200)
    expect(users()[0]?.role).toBe('owner')
  })

  /**
   * phone stays input: true precisely because of this: it has no defaultValue,
   * so closing it would make Better Auth reject every registration that sends
   * one - which is all of them.
   */
  it('still stores the phone number the registration sent', async () => {
    await signUp({ ...REGISTRATION, email: 'phone@test.com', role: 'talent' })

    expect(users()[0]?.phone).toBe('+628123456789')
  })
})

describe('no request body can register an admin', () => {
  /**
   * The unauthenticated half of the escalation. routes/auth.ts refuses this
   * body before forwarding it, but that guard is on one exact path; this is
   * Better Auth answering with no guard in front of it at all.
   */
  it('creates an owner, not an admin, when the body asks for admin', async () => {
    const res = await signUp({ ...REGISTRATION, email: 'admin@test.com', role: 'admin' })

    expect(res.status).toBe(200)
    expect(users()[0]?.role).toBe('owner')
  })

  it('ignores a role that is neither owner nor talent', async () => {
    await signUp({ ...REGISTRATION, email: 'nonsense@test.com', role: 42 })

    expect(users()[0]?.role).toBe('owner')
  })
})

describe('update-user cannot change the role at all', () => {
  async function signedIn(role: string) {
    const res = await signUp({ ...REGISTRATION, email: `${role}@test.com`, role })
    const cookie = res.headers.get('set-cookie')
    expect(cookie).toBeTruthy()
    return String(cookie).split(';')[0]
  }

  /**
   * Better Auth refuses the field itself now, so the 403 in routes/auth.ts is
   * no longer the only thing standing between a signed-in owner and the admin
   * panel. Any path that reaches this endpoint, guarded or not, is refused.
   */
  it('refuses a self-promotion to admin', async () => {
    const cookie = await signedIn('owner')

    const res = await auth.handler(
      new Request('http://localhost:3001/api/v1/auth/update-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie, origin: 'http://localhost:5173' },
        body: JSON.stringify({ role: 'admin' }),
      }),
    )

    expect(res.status).toBe(400)
    expect(users()[0]?.role).toBe('owner')
  })

  it('still allows an ordinary field through', async () => {
    const cookie = await signedIn('talent')

    const res = await auth.handler(
      new Request('http://localhost:3001/api/v1/auth/update-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie, origin: 'http://localhost:5173' },
        body: JSON.stringify({ name: 'Budi Baru' }),
      }),
    )

    expect(res.status).toBe(200)
    expect(users()[0]?.role).toBe('talent')
  })
})
