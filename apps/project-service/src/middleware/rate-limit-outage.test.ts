import { describe, expect, it, vi } from 'vitest'

/**
 * What this service hands the shared store to do when the store fails.
 *
 * The store degrades to per-process counting by itself; the only thing the
 * service contributes is the report, and the report is the point. The
 * production incident behind this limiter ran for weeks because a broken
 * dependency was indistinguishable from a healthy one, so a callback that
 * swallowed the error would rebuild exactly that blind spot.
 *
 * auth-service carries the same test against its own copy. The two limiters
 * had already drifted apart once, which is why the counting moved to
 * packages/shared and why both sides assert their half of it.
 *
 * Its own file because covering this means replacing the store factory, and
 * the rest of the limiter suite needs the real one. The Valkey branch is
 * unreachable under vitest regardless: it is selected on globalThis.Bun, which
 * the node test runner does not define.
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
