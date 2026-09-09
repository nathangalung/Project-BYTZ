import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveDatabaseUrl } from './database-url'

const DIRECT = 'postgresql://user:pass@postgres:5432/kerjacus'
const POOLED = 'postgresql://user:pass@pgbouncer:5432/kerjacus'

afterEach(() => {
  vi.unstubAllEnvs()
})

/**
 * Both env vars are stubbed in every case. Leaving either ambient is what put
 * this branch at the mercy of whoever ran the suite: CI sets
 * DATABASE_DIRECT_URL and a developer usually does not.
 */
describe('resolveDatabaseUrl', () => {
  it('prefers the direct connection Better Auth wants', () => {
    vi.stubEnv('DATABASE_DIRECT_URL', DIRECT)
    vi.stubEnv('DATABASE_URL', POOLED)

    expect(resolveDatabaseUrl()).toBe(DIRECT)
  })

  it('takes the direct connection over a caller fallback too', () => {
    vi.stubEnv('DATABASE_DIRECT_URL', DIRECT)
    vi.stubEnv('DATABASE_URL', '')

    expect(resolveDatabaseUrl(POOLED)).toBe(DIRECT)
  })

  it('falls back to the caller value when only the pooled address is published', () => {
    vi.stubEnv('DATABASE_DIRECT_URL', '')
    vi.stubEnv('DATABASE_URL', '')

    expect(resolveDatabaseUrl(POOLED)).toBe(POOLED)
  })

  it('falls back to the environment when the caller passes nothing', () => {
    vi.stubEnv('DATABASE_DIRECT_URL', '')
    vi.stubEnv('DATABASE_URL', POOLED)

    expect(resolveDatabaseUrl()).toBe(POOLED)
  })

  /** getDb treats undefined as "use whatever is already configured". */
  it('reports nothing when neither is configured', () => {
    vi.stubEnv('DATABASE_DIRECT_URL', '')
    vi.stubEnv('DATABASE_URL', '')

    expect(resolveDatabaseUrl()).toBeUndefined()
  })
})
