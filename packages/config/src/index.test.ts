import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { authEnvSchema, baseEnvSchema, projectEnvSchema, validateEnv } from './index'

/**
 * Startup validation, and it had no tests at all.
 *
 * Every TypeScript service calls validateEnv before it serves anything, so a
 * schema that is wrong here is a service that either refuses to boot or, worse,
 * boots with a default nobody meant. The defaults are the part worth pinning:
 * they decide where project-service looks for the AI service and what bucket
 * uploads land in, and none of them fail loudly if they drift.
 */

const base = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  NATS_URL: 'nats://localhost:4222',
}

describe('baseEnvSchema', () => {
  it('defaults NODE_ENV to development', () => {
    expect(baseEnvSchema.parse(base).NODE_ENV).toBe('development')
  })

  it('accepts the three declared environments and refuses others', () => {
    for (const NODE_ENV of ['development', 'production', 'test']) {
      expect(baseEnvSchema.safeParse({ ...base, NODE_ENV }).success).toBe(true)
    }
    expect(baseEnvSchema.safeParse({ ...base, NODE_ENV: 'staging' }).success).toBe(false)
  })

  /** A bare hostname reaching a driver is a connection failure at first query. */
  it('rejects a bare hostname with no scheme', () => {
    expect(baseEnvSchema.safeParse({ ...base, DATABASE_URL: 'localhost' }).success).toBe(false)
    expect(baseEnvSchema.safeParse({ ...base, REDIS_URL: '' }).success).toBe(false)
  })

  /**
   * z.url() is a weaker guard than it reads as, and this pins how weak.
   *
   * It defers to the URL constructor, and `new URL('localhost:6379')` succeeds
   * with `localhost:` taken as the scheme and `6379` as the path. So the
   * commonest way of mistyping a connection string, host and port with the
   * scheme forgotten, passes startup validation and fails later at the first
   * query instead. Worth knowing before trusting this check to catch it.
   */
  it('accepts host:port because the host reads as a scheme', () => {
    expect(baseEnvSchema.safeParse({ ...base, REDIS_URL: 'localhost:6379' }).success).toBe(true)
  })

  /** NATS is a plain string on purpose: nats:// is not a registered scheme. */
  it('takes NATS_URL as a plain string', () => {
    expect(baseEnvSchema.parse({ ...base, NATS_URL: 'localhost:4222' }).NATS_URL).toBe(
      'localhost:4222',
    )
  })

  it('refuses a missing required variable', () => {
    const { DATABASE_URL, ...withoutDb } = base
    expect(baseEnvSchema.safeParse(withoutDb).success).toBe(false)
  })
})

describe('authEnvSchema', () => {
  const auth = {
    ...base,
    BETTER_AUTH_SECRET: 'a'.repeat(32),
    BETTER_AUTH_URL: 'http://localhost:3001',
  }

  it('defaults the port and the CORS origin', () => {
    const parsed = authEnvSchema.parse(auth)
    expect(parsed.PORT).toBe(3001)
    expect(parsed.CORS_ORIGIN).toBe('http://localhost:5173')
  })

  /**
   * The 32 character floor is the session signing key. A short secret is a
   * forgeable cookie, so this is the one length check worth asserting exactly.
   */
  it('refuses a session secret under 32 characters', () => {
    expect(authEnvSchema.safeParse({ ...auth, BETTER_AUTH_SECRET: 'a'.repeat(31) }).success).toBe(
      false,
    )
    expect(authEnvSchema.safeParse({ ...auth, BETTER_AUTH_SECRET: 'a'.repeat(32) }).success).toBe(
      true,
    )
  })

  it('coerces a port given as a string, which is how env arrives', () => {
    expect(authEnvSchema.parse({ ...auth, PORT: '4000' }).PORT).toBe(4000)
  })

  it('leaves the OAuth and email credentials optional', () => {
    expect(authEnvSchema.parse(auth).GOOGLE_CLIENT_ID).toBeUndefined()
    expect(authEnvSchema.parse(auth).RESEND_API_KEY).toBeUndefined()
  })
})

describe('projectEnvSchema', () => {
  const project = { ...base, SERVICE_AUTH_SECRET: 'shared-secret' }

  it('refuses a missing inter-service secret', () => {
    const { SERVICE_AUTH_SECRET, ...without } = project
    expect(projectEnvSchema.safeParse(without).success).toBe(false)
    expect(projectEnvSchema.safeParse({ ...project, SERVICE_AUTH_SECRET: '' }).success).toBe(false)
  })

  it('defaults every downstream service URL', () => {
    const parsed = projectEnvSchema.parse(project)
    expect(parsed.PORT).toBe(3002)
    expect(parsed.AI_SERVICE_URL).toBe('http://localhost:3003')
    expect(parsed.PAYMENT_SERVICE_URL).toBe('http://localhost:3004')
    expect(parsed.S3_BUCKET).toBe('kerjacus-uploads')
    expect(parsed.TEMPORAL_NAMESPACE).toBe('kerjacus')
  })

  /**
   * The transform exists so a deployment that only sets BETTER_AUTH_URL still
   * reaches auth-service. All three branches decide where session checks go.
   */
  it('prefers AUTH_SERVICE_URL when both are set', () => {
    const parsed = projectEnvSchema.parse({
      ...project,
      AUTH_SERVICE_URL: 'http://auth:3001',
      BETTER_AUTH_URL: 'http://better:3001',
    })
    expect(parsed.AUTH_SERVICE_URL).toBe('http://auth:3001')
  })

  it('falls back to BETTER_AUTH_URL when the explicit one is absent', () => {
    const parsed = projectEnvSchema.parse({ ...project, BETTER_AUTH_URL: 'http://better:3001' })
    expect(parsed.AUTH_SERVICE_URL).toBe('http://better:3001')
  })

  it('falls back to localhost when neither is set', () => {
    expect(projectEnvSchema.parse(project).AUTH_SERVICE_URL).toBe('http://localhost:3001')
  })
})

describe('validateEnv', () => {
  const schema = z.object({ FOO: z.string() })

  it('returns the parsed value', () => {
    expect(validateEnv(schema, { FOO: 'bar' })).toEqual({ FOO: 'bar' })
  })

  /**
   * Fail fast is the whole point: a service that boots without its config
   * fails later, somewhere unrelated, on a request from a real user.
   */
  it('throws rather than returning a partial config', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => validateEnv(schema, {})).toThrow('Invalid environment variables')
    expect(error).toHaveBeenCalled()

    error.mockRestore()
  })

  it('reads process.env when no source is given', () => {
    vi.stubEnv('FOO', 'from-process')

    expect(validateEnv(schema).FOO).toBe('from-process')

    vi.unstubAllEnvs()
  })
})
