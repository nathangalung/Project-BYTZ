import { createLogger } from '@kerjacus/logger'
import { createRateLimitStore, resolveClientIp, UNRESOLVED_CLIENT_IP } from '@kerjacus/shared'
import type { Context, Next } from 'hono'

/**
 * Per-caller request limits, shared across replicas.
 *
 * Key selection and counting live in @kerjacus/shared. This file is the Hono
 * glue only, and it is duplicated in auth-service on purpose: packages/shared
 * is imported by the web bundle, so it must not depend on Hono. What used to
 * be duplicated was the logic itself, and the two copies had already drifted.
 */

const log = createLogger('project-service')

type RateLimitConfig = {
  windowMs: number
  maxRequests: number
  prefix: string
}

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
  prefix: 'rl:project:general:',
})

/** 10 requests/minute, model-backed endpoints that cost real money per call. */
export const strictRateLimit = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 10,
  prefix: 'rl:project:strict:',
})
