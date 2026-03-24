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
  it('allows first request', async () => {
    const app = createApp(5)
    const res = await app.request('/test')

    expect(res.status).toBe(200)
    expect(res.headers.get('X-RateLimit-Limit')).toBe('5')
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('4')
  })

  it('returns 429 when limit exceeded', async () => {
    const app = createApp(2)

    await app.request('/test')
    await app.request('/test')
    const res = await app.request('/test')

    expect(res.status).toBe(429)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(body.error.code).toBe('RATE_LIMIT_EXCEEDED')
  })

  it('sets Retry-After header on 429', async () => {
    const app = createApp(1)

    await app.request('/test')
    const res = await app.request('/test')

    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBeDefined()
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0)
  })

  it('decrements remaining count per request', async () => {
    const app = createApp(3)

    const r1 = await app.request('/test')
    expect(r1.headers.get('X-RateLimit-Remaining')).toBe('2')

    const r2 = await app.request('/test')
    expect(r2.headers.get('X-RateLimit-Remaining')).toBe('1')

    const r3 = await app.request('/test')
    expect(r3.headers.get('X-RateLimit-Remaining')).toBe('0')
  })

  it('tracks different IPs separately', async () => {
    const app = createApp(1)

    const r1 = await app.request('/test', {
      headers: { 'x-forwarded-for': '10.0.0.1' },
    })
    expect(r1.status).toBe(200)

    const r2 = await app.request('/test', {
      headers: { 'x-forwarded-for': '10.0.0.2' },
    })
    expect(r2.status).toBe(200)

    // Same IP again
    const r3 = await app.request('/test', {
      headers: { 'x-forwarded-for': '10.0.0.1' },
    })
    expect(r3.status).toBe(429)
  })

  it('uses first IP from x-forwarded-for chain', async () => {
    const app = createApp(1)

    await app.request('/test', {
      headers: { 'x-forwarded-for': '10.0.0.1, 10.0.0.2' },
    })

    const res = await app.request('/test', {
      headers: { 'x-forwarded-for': '10.0.0.1, 10.0.0.99' },
    })
    expect(res.status).toBe(429)
  })

  it('falls back to x-real-ip header', async () => {
    const app = createApp(1)

    await app.request('/test', {
      headers: { 'x-real-ip': '192.168.1.1' },
    })

    const res = await app.request('/test', {
      headers: { 'x-real-ip': '192.168.1.1' },
    })
    expect(res.status).toBe(429)
  })

  it('shows remaining 0 on rate limit', async () => {
    const app = createApp(1)

    await app.request('/test')
    const res = await app.request('/test')

    expect(res.headers.get('X-RateLimit-Remaining')).toBe('0')
  })
})
