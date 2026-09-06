import { describe, expect, it, vi } from 'vitest'

/**
 * Better Auth's built-in limiter was returning 429 for correct credentials in
 * production. It keys on its own IP resolution, which behind Cloudflare, the
 * Dokploy proxy and the service gateway reads an internal address, and it
 * counts in a per-process Map while more than one replica serves auth. Three
 * sign-in attempts per ten seconds, shared by everyone, is what users hit.
 *
 * Ours replaces it: Valkey-backed so the window is shared, keyed on
 * CF-Connecting-IP, and refusing to key on a private address. These assertions
 * exist so re-enabling the built-in one is a deliberate act rather than an
 * upgrade side effect.
 */

process.env.DATABASE_URL = 'postgresql://x:x@localhost:5432/x'
process.env.REDIS_URL = 'redis://localhost:6379'
process.env.NATS_URL = 'nats://localhost:4222'
process.env.BETTER_AUTH_SECRET = 'x'.repeat(32)
process.env.BETTER_AUTH_URL = 'http://localhost:3001'
process.env.CORS_ORIGIN = 'http://localhost:5173'

vi.mock('@kerjacus/db', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@kerjacus/db')
  return { ...actual, getDb: () => ({}) }
})

const { auth } = await import('./auth')

describe('auth rate limiting', () => {
  it('leaves the limiter to the shared middleware', () => {
    expect(auth.options.rateLimit?.enabled).toBe(false)
  })

  /**
   * The default is X-Forwarded-For, whose leftmost entry the client supplies.
   * session.ipAddress was landing empty because of it, so the audit trail
   * recorded nothing about where a session was created.
   */
  it('reads the caller from the header Cloudflare writes', () => {
    const headers = auth.options.advanced?.ipAddress?.ipAddressHeaders
    expect(headers).toContain('cf-connecting-ip')
    expect(headers?.[0]).toBe('cf-connecting-ip')
  })

  it('keeps credential sign-in enabled', () => {
    expect(auth.options.emailAndPassword?.enabled).toBe(true)
  })
})
