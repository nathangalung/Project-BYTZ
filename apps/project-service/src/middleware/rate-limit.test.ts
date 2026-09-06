import { Hono } from 'hono'
import { afterEach, describe, expect, it } from 'vitest'
import { createRateLimiter, resetRateLimiters } from './rate-limit'

/**
 * The limiter is exercised through a real Hono app because its whole job is
 * the interaction between header parsing, the shared counter, and the 429.
 *
 * The previous suite passed while production was broken: it asserted that the
 * limit triggers after N requests, which it did, using an IP header that three
 * proxy hops had already replaced with an internal address. Every caller
 * shared one bucket and the tests could not see it. The cases below are about
 * who gets counted together, which is the part that was wrong.
 */

let seq = 0
function createApp(maxRequests: number, windowMs = 60_000) {
  seq += 1
  const app = new Hono()
  app.use('*', createRateLimiter({ windowMs, maxRequests, prefix: `test:${seq}:` }))
  app.get('/test', (c) => c.json({ ok: true }))
  return app
}

const from = (headers: Record<string, string>) => new Request('http://x/test', { headers })

afterEach(() => resetRateLimiters())

describe('rate limiter', () => {
  it('allows requests under the limit', async () => {
    const app = createApp(3)
    const res = await app.fetch(from({ 'cf-connecting-ip': '203.0.113.1' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('2')
  })

  it('refuses once the allowance is spent', async () => {
    const app = createApp(2)
    const ip = { 'cf-connecting-ip': '203.0.113.2' }
    await app.fetch(from(ip))
    await app.fetch(from(ip))
    const res = await app.fetch(from(ip))
    expect(res.status).toBe(429)
    expect(await res.json()).toMatchObject({
      success: false,
      error: { code: 'RATE_LIMIT_EXCEEDED' },
    })
  })

  it('advertises when to come back', async () => {
    const app = createApp(1)
    const ip = { 'cf-connecting-ip': '203.0.113.3' }
    await app.fetch(from(ip))
    const res = await app.fetch(from(ip))
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0)
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('0')
  })

  /**
   * This is the production failure. Both callers arrive through the same proxy
   * chain, so X-Real-IP is identical and internal; only CF-Connecting-IP tells
   * them apart. Keying on the proxy merged the entire platform into one bucket.
   */
  it('does not merge two callers behind the same proxy', async () => {
    const app = createApp(1)
    const proxy = { 'x-real-ip': '10.0.1.224', 'x-forwarded-for': '10.0.1.224' }
    const first = await app.fetch(from({ ...proxy, 'cf-connecting-ip': '203.0.113.10' }))
    const second = await app.fetch(from({ ...proxy, 'cf-connecting-ip': '203.0.113.11' }))
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
  })

  it('still counts repeat callers together', async () => {
    const app = createApp(1)
    const ip = { 'x-real-ip': '10.0.1.224', 'cf-connecting-ip': '203.0.113.12' }
    await app.fetch(from(ip))
    expect((await app.fetch(from(ip))).status).toBe(429)
  })

  /**
   * A client can put anything in the leftmost X-Forwarded-For entry, so keying
   * on it hands out a fresh bucket per request and the limit stops existing.
   */
  it('ignores a client-supplied forwarded prefix', async () => {
    const app = createApp(1)
    const real = '198.51.100.50'
    await app.fetch(from({ 'x-forwarded-for': `1.1.1.1, ${real}` }))
    const res = await app.fetch(from({ 'x-forwarded-for': `2.2.2.2, ${real}` }))
    expect(res.status).toBe(429)
  })

  it('keeps separate limiters independent', async () => {
    const a = createApp(1)
    const b = createApp(1)
    const ip = { 'cf-connecting-ip': '203.0.113.20' }
    await a.fetch(from(ip))
    expect((await b.fetch(from(ip))).status).toBe(200)
  })

  it('counts callers it cannot identify together, rather than not at all', async () => {
    const app = createApp(1)
    await app.fetch(from({ 'x-real-ip': '10.0.1.224' }))
    const res = await app.fetch(from({ 'x-real-ip': '10.0.1.65' }))
    expect(res.status).toBe(429)
  })
})
