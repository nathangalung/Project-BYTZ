import type { Context, Next } from 'hono'

type RateLimitEntry = {
  count: number
  resetAt: number
}

type RateLimitConfig = {
  windowMs: number
  maxRequests: number
}

/** In-memory rate limiter keyed by client IP. Single-instance only; use Redis in production. */
export function createRateLimiter(config: RateLimitConfig) {
  const store = new Map<string, RateLimitEntry>()

  // Cleanup expired entries every 60s to prevent memory leak
  const cleanupInterval = setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of store) {
      if (now >= entry.resetAt) {
        store.delete(key)
      }
    }
  }, 60_000)

  // Allow cleanup timer to not block process exit
  if (cleanupInterval.unref) {
    cleanupInterval.unref()
  }

  return async function rateLimitMiddleware(c: Context, next: Next) {
    const ip =
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
      c.req.header('x-real-ip') ??
      'unknown'

    const now = Date.now()
    const entry = store.get(ip)

    if (!entry || now >= entry.resetAt) {
      store.set(ip, { count: 1, resetAt: now + config.windowMs })
      c.header('X-RateLimit-Limit', String(config.maxRequests))
      c.header('X-RateLimit-Remaining', String(config.maxRequests - 1))
      await next()
      return
    }

    entry.count++

    if (entry.count > config.maxRequests) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000)
      c.header('X-RateLimit-Limit', String(config.maxRequests))
      c.header('X-RateLimit-Remaining', '0')
      c.header('Retry-After', String(retryAfter))
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

    c.header('X-RateLimit-Limit', String(config.maxRequests))
    c.header('X-RateLimit-Remaining', String(config.maxRequests - entry.count))
    await next()
  }
}

/** 100 requests/minute — general endpoints */
export const generalRateLimit = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 100,
})

/** 10 requests/minute — sensitive endpoints (auth, AI) */
export const strictRateLimit = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 10,
})
