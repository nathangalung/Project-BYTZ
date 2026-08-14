import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The connection singleton, which had no test script to run one under.
 *
 * getDb caches the first client it builds and every service holds that one
 * instance for its lifetime, so the cache is the behaviour: a second call with
 * a different URL silently keeps the first connection. Worth pinning, because
 * that is exactly the surprise waiting for anyone who tries to point a test at
 * a second database after the app has already touched the first.
 */

afterEach(() => {
  vi.resetModules()
  vi.unstubAllEnvs()
})

const URL_A = 'postgresql://a:a@localhost:5432/a'
const URL_B = 'postgresql://b:b@localhost:5432/b'

describe('getDb', () => {
  it('refuses to build a client with no URL anywhere', async () => {
    vi.stubEnv('DATABASE_URL', '')
    const { getDb } = await import('./client')

    expect(() => getDb()).toThrow('DATABASE_URL is required')
  })

  it('takes an explicit URL over the environment', async () => {
    vi.stubEnv('DATABASE_URL', URL_A)
    const { getDb } = await import('./client')

    expect(getDb(URL_B)).toBeDefined()
  })

  it('falls back to DATABASE_URL', async () => {
    vi.stubEnv('DATABASE_URL', URL_A)
    const { getDb } = await import('./client')

    expect(getDb()).toBeDefined()
  })

  /**
   * The cache ignores the argument once it is warm. A caller passing a second
   * URL gets the first connection back and no warning, which is the sharp edge.
   */
  it('returns the first client regardless of a later URL', async () => {
    vi.stubEnv('DATABASE_URL', URL_A)
    const { getDb } = await import('./client')

    const first = getDb(URL_A)
    const second = getDb(URL_B)

    expect(second).toBe(first)
  })

  it('hands the same instance to every caller', async () => {
    vi.stubEnv('DATABASE_URL', URL_A)
    const { getDb } = await import('./client')

    expect(getDb()).toBe(getDb())
  })
})
