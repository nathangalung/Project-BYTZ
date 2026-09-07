import { describe, expect, it, vi } from 'vitest'

/**
 * What auth-service hands the shared store to do when the store fails.
 *
 * The store degrades to per-process counting on its own; the only thing this
 * service contributes is the report. That report is the whole point: the
 * production failure this limiter came from ran for weeks because a broken
 * dependency looked identical to a healthy one, so a callback that swallowed
 * the error would rebuild the same blind spot.
 *
 * It lives in its own file because covering it means replacing the store
 * factory, and the rest of the limiter suite needs the real one. The Valkey
 * branch cannot be reached under vitest at all, since it is chosen on
 * globalThis.Bun, which the node test runner does not define.
 */

const warn = vi.fn()
vi.mock('@kerjacus/logger', () => ({
  createLogger: () => ({ warn, info: vi.fn(), error: vi.fn() }),
}))

const captured: { onError?: (error: unknown) => void } = {}
vi.mock('@kerjacus/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@kerjacus/shared')>()
  return {
    ...actual,
    createRateLimitStore: (options: { onError?: (error: unknown) => void }) => {
      captured.onError = options.onError
      return {
        hit: async () => ({ allowed: true, limit: 1, remaining: 1, retryAfterSeconds: 1 }),
        stop: () => {},
      }
    },
  }
})

const { createRateLimiter, resetRateLimiters } = await import('./rate-limit')

describe('what the limiter does when its store fails', () => {
  it('reports the outage instead of counting quietly on one process', async () => {
    createRateLimiter({ windowMs: 1000, maxRequests: 1, prefix: 'outage:' })
    expect(captured.onError).toBeTypeOf('function')

    const failure = new Error('valkey unreachable')
    captured.onError?.(failure)

    expect(warn).toHaveBeenCalledWith(
      { err: failure },
      'rate limit store unavailable, counting locally',
    )
    resetRateLimiters()
  })
})
