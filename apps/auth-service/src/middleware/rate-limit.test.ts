import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { createRateLimiter } from './rate-limit'

function createApp(maxRequests: number, windowMs = 60_000) {
  const app = new Hono()
  const limiter = createRateLimiter({ windowMs, maxRequests })
  app.use('*', limiter)
  app.get('/test', (c) => c.json({ ok: true }))
  return app
}

describe('rate limiter', () => {
  it('allows requests under the limit', async () => {
    const app = createApp(5)
    const res = await app.request('/test')

    expect(res.status).toBe(200)
    expect(res.headers.get('X-RateLimit-Limit')).toBe('5')
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('4')
  })

  it('returns 429 when limit is exceeded', async () => {
    const app = createApp(2)

    // First two requests should pass
    const res1 = await app.request('/test')
    expect(res1.status).toBe(200)

    const res2 = await app.request('/test')
    expect(res2.status).toBe(200)

    // Third request should be rate limited
    const res3 = await app.request('/test')
    expect(res3.status).toBe(429)

    const body = (await res3.json()) as Record<string, unknown>
    expect(body.success).toBe(false)
    expect((body.error as Record<string, unknown>).code).toBe('RATE_LIMIT_EXCEEDED')
  })

  it('sets Retry-After header on 429', async () => {
    const app = createApp(1)

    await app.request('/test')
    const res = await app.request('/test')

    expect(res.status).toBe(429)
    const retryAfter = res.headers.get('Retry-After')
    expect(retryAfter).toBeDefined()
    expect(Number(retryAfter)).toBeGreaterThan(0)
  })

  it('decrements remaining count with each request', async () => {
    const app = createApp(5)

    const res1 = await app.request('/test')
    expect(res1.headers.get('X-RateLimit-Remaining')).toBe('4')

    const res2 = await app.request('/test')
    expect(res2.headers.get('X-RateLimit-Remaining')).toBe('3')

    const res3 = await app.request('/test')
    expect(res3.headers.get('X-RateLimit-Remaining')).toBe('2')
  })

  it('shows 0 remaining on 429', async () => {
    const app = createApp(1)

    await app.request('/test')
    const res = await app.request('/test')

    expect(res.status).toBe(429)
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('0')
  })

  it('uses x-forwarded-for header for IP detection', async () => {
    const app = createApp(1)

    // Different IPs should have separate limits
    const res1 = await app.request('/test', {
      headers: { 'x-forwarded-for': '10.0.0.1' },
    })
    expect(res1.status).toBe(200)

    const res2 = await app.request('/test', {
      headers: { 'x-forwarded-for': '10.0.0.2' },
    })
    expect(res2.status).toBe(200)

    // Same IP exceeds limit
    const res3 = await app.request('/test', {
      headers: { 'x-forwarded-for': '10.0.0.1' },
    })
    expect(res3.status).toBe(429)
  })

  it('uses first IP from x-forwarded-for chain', async () => {
    const app = createApp(1)

    const res1 = await app.request('/test', {
      headers: { 'x-forwarded-for': '10.0.0.1, 10.0.0.2, 10.0.0.3' },
    })
    expect(res1.status).toBe(200)

    // Same first IP should be rate limited
    const res2 = await app.request('/test', {
      headers: { 'x-forwarded-for': '10.0.0.1, 10.0.0.99' },
    })
    expect(res2.status).toBe(429)
  })

  it('falls back to x-real-ip when x-forwarded-for not present', async () => {
    const app = createApp(1)

    const res1 = await app.request('/test', {
      headers: { 'x-real-ip': '192.168.1.1' },
    })
    expect(res1.status).toBe(200)

    const res2 = await app.request('/test', {
      headers: { 'x-real-ip': '192.168.1.1' },
    })
    expect(res2.status).toBe(429)
  })
})
