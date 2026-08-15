import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

  /**
   * This used to assert the leftmost entry was the key, which is what made
   * the limiter bypassable: nginx appends the real client to whatever the
   * caller sent, so the left end is attacker input and a varying prefix gave
   * a fresh bucket every request. The rightmost hop is the one the proxy
   * added.
   */
  it('keys on the rightmost forwarded-for hop, not the client-supplied left', async () => {
    const app = createApp(1)

    await app.request('/test', {
      headers: { 'x-forwarded-for': '10.0.0.1, 10.0.0.2' },
    })

    // Same real client, different spoofed prefix: still the same bucket.
    const res = await app.request('/test', {
      headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.2' },
    })
    expect(res.status).toBe(429)
  })

  it('does not let a varying forwarded-for prefix mint new buckets', async () => {
    const app = createApp(1)
    await app.request('/test', { headers: { 'x-forwarded-for': 'a, 10.0.0.5' } })
    const res = await app.request('/test', { headers: { 'x-forwarded-for': 'b, 10.0.0.5' } })
    expect(res.status).toBe(429)
  })

  it('prefers x-real-ip over anything forwarded', async () => {
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

/**
 * The middleware already replaces an expired bucket on the next request from
 * that IP, so the sweep changes nothing for a returning client. What it is for
 * is the IP that never comes back: without it the map holds one entry per IP
 * ever seen, for the life of the process.
 *
 * The risk in a sweep is over-deletion - dropping a live bucket resets its
 * count and makes the limit advisory for anyone whose window happens to span
 * one, which is the assertion below.
 */
describe('rate limiter bucket sweep', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('drops expired buckets without resetting a window still in progress', async () => {
    vi.useFakeTimers()
    const app = createApp(5, 30_000)

    await app.request('/test', { headers: { 'x-real-ip': '10.0.0.1' } })

    // Just before the sweep, so this window is still open when it runs.
    vi.advanceTimersByTime(59_000)
    const live = await app.request('/test', { headers: { 'x-real-ip': '10.0.0.2' } })
    expect(live.headers.get('X-RateLimit-Remaining')).toBe('4')

    // Sixtieth second: the cleanup interval fires. 10.0.0.1 expired at 30s,
    // 10.0.0.2 does not expire until 89s.
    vi.advanceTimersByTime(1_000)

    const after = await app.request('/test', { headers: { 'x-real-ip': '10.0.0.2' } })
    // 3, not 4: the surviving bucket kept its count. A sweep that deleted it
    // would hand back a fresh window here.
    expect(after.headers.get('X-RateLimit-Remaining')).toBe('3')
  })

  /**
   * unref is a Node timer method. Browser and edge runtimes return a plain
   * number from setInterval, and the guard is what keeps the limiter usable
   * there rather than throwing at construction.
   */
  it('constructs on a runtime whose timer handle has no unref', () => {
    const spy = vi
      .spyOn(globalThis, 'setInterval')
      .mockReturnValue(0 as unknown as ReturnType<typeof setInterval>)

    expect(() => createRateLimiter({ windowMs: 1_000, maxRequests: 1 })).not.toThrow()

    spy.mockRestore()
  })
})
