import { memoryAdapter } from 'better-auth/adapters/memory'
import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'

/**
 * A mail server that is down must not look like a registration that failed.
 *
 * With verification enforced, sign-up answers 200 and a null token - no
 * session yet - and apps/web reads the null token as "send them to
 * /check-email". If the send throws, the account is still made and the caller
 * still has to check their inbox; answering 500 instead would report a failure
 * over a committed account, which is the bug this whole branch is about, and
 * would send them back to a form that will now say the email is taken.
 *
 * Its own file because the enforcement branch is decided at import: lib/auth.ts
 * reads the environment once, when betterAuth() is called.
 */

vi.setConfig({ testTimeout: 30_000 })

const store: Record<string, Record<string, unknown>[]> = {
  user: [],
  session: [],
  account: [],
  verification: [],
}

vi.mock('better-auth/adapters/drizzle', () => ({
  drizzleAdapter: () => memoryAdapter(store),
}))

vi.mock('@kerjacus/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@kerjacus/db')>()),
  getDb: () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
  }),
}))

// Resend answers 403 for an unverified sender domain, which is what production
// has every time EMAIL_FROM and the configured domain drift apart.
const sendEmail = vi.fn(async () => {
  throw new Error('Resend send failed: 403')
})

vi.mock('../lib/email', () => ({
  sendEmail,
  buildVerificationEmail: () => ({ subject: 's', html: 'h', text: 't' }),
}))

for (const [key, value] of Object.entries({
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/kerjacus',
  REDIS_URL: 'redis://localhost:6379',
  NATS_URL: 'nats://localhost:4222',
  BETTER_AUTH_SECRET: 'a-secret-that-is-at-least-32-characters',
  BETTER_AUTH_URL: 'https://kerjacus.id',
  CORS_ORIGIN: 'https://kerjacus.id',
  RESEND_API_KEY: 're_test_key',
  REQUIRE_EMAIL_VERIFICATION: 'true',
  // Production refuses the localhost defaults these carry in development.
  S3_ENDPOINT: 'https://s3.kerjacus.id',
  S3_ACCESS_KEY: 'access-key',
  S3_SECRET_KEY: 'secret-key',
  AI_SERVICE_URL: 'https://ai.kerjacus.id',
  CENTRIFUGO_SECRET: 'a-centrifugo-secret-key',
})) {
  process.env[key] = value
}

const { authRoute } = await import('./auth')
const app = new Hono().route('/api/v1/auth', authRoute)

describe('sign-up when verification is required and the mail cannot be sent', () => {
  it('still answers 200 with a null token, which is the check-email path', async () => {
    const res = await app.request('https://kerjacus.id/api/v1/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Budi',
        email: 'budi@test.com',
        password: 'password123',
        phone: '+628123456789',
        role: 'talent',
      }),
    })
    const body = (await res.json()) as { token?: unknown; user?: { email?: string } }

    expect(sendEmail).toHaveBeenCalled()
    expect(res.status).toBe(200)
    // Null, not absent: apps/web branches on it to reach /check-email.
    expect(body.token).toBeNull()
    expect(body.user?.email).toBe('budi@test.com')
    expect(store.user).toHaveLength(1)
  })
})
