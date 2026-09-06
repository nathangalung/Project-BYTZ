import { createLogger } from '@kerjacus/logger'
import { createRateLimitStore, resolveClientIp, UNRESOLVED_CLIENT_IP } from '@kerjacus/shared'
import type { Context, Next } from 'hono'

/**
 * Per-caller request limits, shared across replicas.
 *
 * Two failures made the previous version count the wrong thing. It keyed on
 * X-Real-IP, which three proxy hops had already rewritten to an internal
 * address, so every caller shared one bucket. And it counted in a per-process
 * Map, so the limit that actually applied was the configured number times
 * however many replicas happened to be running.
 *
 * Key selection and counting both moved to @kerjacus/shared so auth-service
 * and project-service cannot drift again, which they already had.
 */

const log = createLogger('auth-service')

type RateLimitConfig = {
  windowMs: number
  maxRequests: number
  prefix: string
}

// One store per limiter so windows do not collide across prefixes.
const stores = new Map<string, ReturnType<typeof createRateLimitStore>>()

function storeFor(prefix: string) {
  const existing = stores.get(prefix)
  if (existing) return existing
  const store = createRateLimitStore({
    redisUrl: process.env.REDIS_URL,
    prefix,
    onError: (error) => log.warn({ err: error }, 'rate limit store unavailable, counting locally'),
  })
  stores.set(prefix, store)
  return store
}

// A broken proxy chain is worth saying out loud, but not on every request.
let lastUnresolvedWarning = 0

function keyFor(c: Context): string {
  const ip = resolveClientIp((name) => c.req.header(name))
  if (ip === UNRESOLVED_CLIENT_IP) {
    const now = Date.now()
    if (now - lastUnresolvedWarning > 60_000) {
      lastUnresolvedWarning = now
      log.warn(
        {
          cfConnectingIp: c.req.header('cf-connecting-ip') ?? null,
          xRealIp: c.req.header('x-real-ip') ?? null,
          xForwardedFor: c.req.header('x-forwarded-for') ?? null,
        },
        'client IP unresolved; every caller now shares one rate limit bucket',
      )
    }
  }
  return ip
}

export function createRateLimiter(config: RateLimitConfig) {
  const store = storeFor(config.prefix)

  return async function rateLimitMiddleware(c: Context, next: Next) {
    const verdict = await store.hit(keyFor(c), config.windowMs, config.maxRequests)

    c.header('X-RateLimit-Limit', String(verdict.limit))
    c.header('X-RateLimit-Remaining', String(verdict.remaining))

    if (!verdict.allowed) {
      c.header('Retry-After', String(verdict.retryAfterSeconds))
      return c.json(
        {
          success: false,
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many requests, please try again later',
          },
        },
        429,
      )
    }

    await next()
  }
}

/** Resets counters between tests. */
export function resetRateLimiters(): void {
  for (const store of stores.values()) store.stop()
  stores.clear()
  lastUnresolvedWarning = 0
}

/** 100 requests/minute, general endpoints. */
export const generalRateLimit = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 100,
  prefix: 'rl:auth:general:',
})

/**
 * 10 requests/minute, credential endpoints only.
 *
 * This used to cover every /api/v1/auth path, which included get-session. The
 * frontend calls that on each page load, so ten shared requests a minute was
 * spent before anyone reached the login form.
 */
export const strictRateLimit = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 10,
  prefix: 'rl:auth:strict:',
})
