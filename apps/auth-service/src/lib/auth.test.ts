import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * auth.ts is one call to betterAuth, evaluated at import. Nothing in it can be
 * unit tested by calling a function, but the object it builds is the whole
 * security posture of the service: which fields sign-up may write, whether
 * cookies are Secure, which origins are trusted, whether email verification is
 * required. Capture the config at the module boundary and read it.
 */

type AdditionalField = {
  type: string
  required?: boolean
  defaultValue?: unknown
  input?: boolean
}

type MailArgs = { user: { email: string; name: string }; url: string }

type AuthConfig = {
  database: unknown
  baseURL: string
  basePath: string
  secret: string
  trustedOrigins: string[]
  emailAndPassword: {
    enabled: boolean
    minPasswordLength: number
    maxPasswordLength: number
    requireEmailVerification: boolean
    sendResetPassword: (args: MailArgs) => Promise<void>
  }
  emailVerification: {
    sendOnSignUp: boolean
    autoSignInAfterVerification: boolean
    sendVerificationEmail: (args: MailArgs) => Promise<void>
  }
  socialProviders: Record<string, { clientId: string; clientSecret: string }>
  session: {
    cookieCache: { enabled: boolean; maxAge: number }
    expiresIn: number
    updateAge: number
  }
  advanced: { cookiePrefix: string; generateId: boolean; useSecureCookies: boolean }
  user: { additionalFields: Record<string, AdditionalField> }
}

const betterAuth = vi.fn((config: unknown) => ({ config }))
const drizzleAdapter = vi.fn((db: unknown, options: unknown) => ({ db, options }))
const getDb = vi.fn(() => ({ marker: 'fake-db' }))
type SentMail = { to: string; subject: string; html: string; text?: string }

const sendEmail = vi.fn(async (_params: SentMail) => undefined)
const buildVerificationEmail = vi.fn((name: string, url: string) => ({
  subject: 'built subject',
  html: `built html for ${name} ${url}`,
  text: `built text ${url}`,
}))

vi.mock('better-auth', () => ({ betterAuth }))
vi.mock('better-auth/adapters/drizzle', () => ({ drizzleAdapter }))
vi.mock('@kerjacus/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@kerjacus/db')>()),
  getDb,
}))
vi.mock('./email', () => ({ sendEmail, buildVerificationEmail }))

const BASE_ENV: Record<string, string> = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/kerjacus',
  REDIS_URL: 'redis://localhost:6379',
  NATS_URL: 'nats://localhost:4222',
  BETTER_AUTH_SECRET: 'a-secret-that-is-at-least-32-characters',
  BETTER_AUTH_URL: 'http://localhost:3001',
  CORS_ORIGIN: 'http://localhost:5173',
  GOOGLE_CLIENT_ID: '',
  GOOGLE_CLIENT_SECRET: '',
}

/** Re-imports auth.ts under the given env and hands back the captured config. */
async function loadAuth(overrides: Record<string, string | undefined> = {}) {
  vi.resetModules()
  betterAuth.mockClear()
  drizzleAdapter.mockClear()
  getDb.mockClear()
  sendEmail.mockClear()
  vi.stubEnv('DATABASE_DIRECT_URL', undefined)
  for (const [key, value] of Object.entries({ ...BASE_ENV, ...overrides })) {
    vi.stubEnv(key, value)
  }
  await import('./auth')
  return betterAuth.mock.calls[0]?.[0] as AuthConfig
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('mounting', () => {
  it('serves under the versioned auth path the gateway routes to', async () => {
    const config = await loadAuth()

    expect(config.basePath).toBe('/api/v1/auth')
    expect(config.baseURL).toBe('http://localhost:3001')
  })

  it('signs sessions with the configured secret', async () => {
    const config = await loadAuth({ BETTER_AUTH_SECRET: 'b'.repeat(40) })

    expect(config.secret).toBe('b'.repeat(40))
  })

  it('refuses to start on a secret under 32 characters', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(loadAuth({ BETTER_AUTH_SECRET: 'too-short' })).rejects.toThrow(
      'Invalid environment variables',
    )

    spy.mockRestore()
  })

  it('adapts drizzle over the real schema, on postgres', async () => {
    await loadAuth()

    const [db, options] = drizzleAdapter.mock.calls[0] as [
      { marker: string },
      { provider: string; schema: Record<string, unknown> },
    ]
    expect(db.marker).toBe('fake-db')
    expect(options.provider).toBe('pg')
    // Naming the module rather than a hand-written subset is what keeps a new
    // table from being invisible to Better Auth.
    expect(options.schema).toHaveProperty('user')
    expect(options.schema).toHaveProperty('session')
  })

  /**
   * Better Auth writes through the pooler otherwise. PgBouncer runs in
   * transaction mode, where the prepared statements the adapter issues do not
   * survive between checkouts.
   */
  it('prefers the direct database URL when one is set', async () => {
    await loadAuth({ DATABASE_DIRECT_URL: 'postgresql://user:pass@localhost:5432/direct' })

    expect(getDb).toHaveBeenCalledWith('postgresql://user:pass@localhost:5432/direct')
  })

  it('falls back to the pooled URL when no direct one is set', async () => {
    await loadAuth()

    expect(getDb).toHaveBeenCalledWith(BASE_ENV.DATABASE_URL)
  })
})

describe('production hardening', () => {
  const prod = () => loadAuth({ NODE_ENV: 'production' })

  /** Without Secure, the session cookie rides a downgraded request in clear. */
  it('marks cookies Secure in production and not in development', async () => {
    expect((await prod()).advanced.useSecureCookies).toBe(true)
    expect((await loadAuth()).advanced.useSecureCookies).toBe(false)
  })

  it('requires a verified email in production and not in development', async () => {
    expect((await prod()).emailAndPassword.requireEmailVerification).toBe(true)
    expect((await loadAuth()).emailAndPassword.requireEmailVerification).toBe(false)
  })

  /**
   * trustedOrigins is the CSRF boundary. A localhost entry surviving into
   * production would let a page served from a developer's machine drive a live
   * session.
   */
  it('trusts only the three production hosts in production', async () => {
    const config = await prod()

    expect(config.trustedOrigins).toEqual([
      'https://kerjacus.id',
      'https://www.kerjacus.id',
      'https://admin.kerjacus.id',
    ])
    expect(config.trustedOrigins.every((origin) => origin.startsWith('https://'))).toBe(true)
  })

  it('trusts the configured CORS origin in development', async () => {
    const config = await loadAuth({ CORS_ORIGIN: 'http://localhost:5174' })

    expect(config.trustedOrigins).toEqual(['http://localhost:5174'])
  })
})

describe('sign-up fields', () => {
  /**
   * The mass-assignment guard. isVerified is what the session middleware reads
   * to lock a suspended account out, so a sign-up body that could set it would
   * hand every new account a verification it never earned - and hand a
   * suspended one its way back in.
   */
  it('closes every privileged field to caller input', async () => {
    const fields = (await loadAuth()).user.additionalFields

    for (const name of ['isVerified', 'phoneVerified', 'avatarUrl', 'deletedAt']) {
      expect(fields[name]?.input, `${name} must not be writable at sign-up`).toBe(false)
    }
  })

  it('starts an account unverified and unsuspended', async () => {
    const fields = (await loadAuth()).user.additionalFields

    expect(fields.isVerified?.defaultValue).toBe(false)
    expect(fields.phoneVerified?.defaultValue).toBe(false)
  })

  it('defaults role to owner, the least privileged of the two', async () => {
    const fields = (await loadAuth()).user.additionalFields

    expect(fields.role?.defaultValue).toBe('owner')
    expect(fields.role?.required).toBe(true)
  })

  /** Google supplies no phone, so a required one would break OAuth sign-up. */
  it('accepts a phone at sign-up without demanding one', async () => {
    const fields = (await loadAuth()).user.additionalFields

    expect(fields.phone?.required).toBe(false)
    expect(fields.phone?.input).toBe(true)
  })

  it('lets ids come from the application, not from Better Auth', async () => {
    const config = await loadAuth()

    // The rest of the schema is UUID v7 for index locality.
    expect(config.advanced.generateId).toBe(false)
    expect(config.advanced.cookiePrefix).toBe('kerjacus')
  })
})

describe('google sign-in', () => {
  it('is configured when both halves of the credential are present', async () => {
    const config = await loadAuth({
      GOOGLE_CLIENT_ID: 'client-id.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: 'client-secret',
    })

    expect(config.socialProviders.google).toEqual({
      clientId: 'client-id.apps.googleusercontent.com',
      clientSecret: 'client-secret',
    })
  })

  /**
   * A half-configured provider registers a button that always fails at the
   * callback. Better absent than broken.
   */
  it('is absent when either half is missing', async () => {
    const noSecret = await loadAuth({ GOOGLE_CLIENT_ID: 'client-id' })
    const noId = await loadAuth({ GOOGLE_CLIENT_SECRET: 'client-secret' })
    const neither = await loadAuth()

    expect(noSecret.socialProviders).toEqual({})
    expect(noId.socialProviders).toEqual({})
    expect(neither.socialProviders).toEqual({})
  })
})

describe('session lifetime', () => {
  it('caches the session cookie for five minutes to spare a lookup per request', async () => {
    const config = await loadAuth()

    expect(config.session.cookieCache).toEqual({ enabled: true, maxAge: 5 * 60 })
  })

  it('expires a session after a week and refreshes it daily', async () => {
    const config = await loadAuth()

    expect(config.session.expiresIn).toBe(60 * 60 * 24 * 7)
    expect(config.session.updateAge).toBe(60 * 60 * 24)
  })
})

describe('the mail Better Auth sends', () => {
  const USER = { email: 'user@test.com', name: 'Budi' }

  it('sends a reset link to the account address, carrying the url', async () => {
    const config = await loadAuth()

    await config.emailAndPassword.sendResetPassword({
      user: USER,
      url: 'https://kerjacus.id/reset?token=abc',
    })

    expect(sendEmail).toHaveBeenCalledTimes(1)
    const sent = sendEmail.mock.calls[0][0]
    expect(sent.to).toBe(USER.email)
    expect(sent.subject).toBeTruthy()
    // A reset mail with no link is a support ticket.
    expect(sent.html).toContain('https://kerjacus.id/reset?token=abc')
  })

  it('sends verification through the shared template rather than a second copy', async () => {
    const config = await loadAuth()

    await config.emailVerification.sendVerificationEmail({
      user: USER,
      url: 'https://kerjacus.id/verify?token=xyz',
    })

    expect(buildVerificationEmail).toHaveBeenCalledWith(
      'Budi',
      'https://kerjacus.id/verify?token=xyz',
    )
    const sent = sendEmail.mock.calls[0][0]
    expect(sent.to).toBe(USER.email)
    expect(sent.html).toBe('built html for Budi https://kerjacus.id/verify?token=xyz')
  })

  it('sends verification on sign-up and signs the user in once they click', async () => {
    const config = await loadAuth()

    expect(config.emailVerification.sendOnSignUp).toBe(true)
    expect(config.emailVerification.autoSignInAfterVerification).toBe(true)
  })

  it('accepts passwords between 8 and 128 characters', async () => {
    const config = await loadAuth()

    expect(config.emailAndPassword.enabled).toBe(true)
    expect(config.emailAndPassword.minPasswordLength).toBe(8)
    expect(config.emailAndPassword.maxPasswordLength).toBe(128)
  })
})
