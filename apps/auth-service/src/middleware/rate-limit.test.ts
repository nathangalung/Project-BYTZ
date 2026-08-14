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

  // This asserted the first element, which is the half the client writes:
  // nginx appends the real peer to whatever arrives, so rotating that prefix
  // gave every request its own bucket and the limiter never fired.
  it('keys on the last hop, which the proxy appended', async () => {
    const app = createApp(1)

    const res1 = await app.request('/test', {
      headers: { 'x-forwarded-for': '1.2.3.4, 10.0.0.5' },
    })
    expect(res1.status).toBe(200)

    // Same caller, different claimed prefix.
    const res2 = await app.request('/test', {
      headers: { 'x-forwarded-for': '9.9.9.9, 10.0.0.5' },
    })
    expect(res2.status).toBe(429)
  })

  it('cannot be reset by rotating the claimed prefix', async () => {
    const app = createApp(2)

    for (let i = 0; i < 2; i++) {
      await app.request('/test', { headers: { 'x-forwarded-for': `${i}.0.0.1, 10.0.0.5` } })
    }
    const res = await app.request('/test', {
      headers: { 'x-forwarded-for': '77.0.0.1, 10.0.0.5' },
    })
    expect(res.status).toBe(429)
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

  /** The last request the limit allows still passes, and reports nothing left. */
  it('allows exactly maxRequests, then refuses', async () => {
    const app = createApp(3)

    const allowed = [await app.request('/test'), await app.request('/test')]
    const last = await app.request('/test')
    const refused = await app.request('/test')

    expect(allowed.map((r) => r.status)).toEqual([200, 200])
    expect(last.status).toBe(200)
    expect(last.headers.get('X-RateLimit-Remaining')).toBe('0')
    expect(refused.status).toBe(429)
  })
})

/**
 * The window is a wall-clock comparison, so these need a clock we control.
 * useFakeTimers has to come first: the limiter registers its cleanup interval
 * when it is constructed, and one registered against the real clock never
 * fires inside a test.
 */
describe('the window, on a controlled clock', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('still refuses one millisecond before the window ends', async () => {
    vi.useFakeTimers()
    const app = createApp(1, 60_000)

    expect((await app.request('/test')).status).toBe(200)
    vi.advanceTimersByTime(59_999)

    expect((await app.request('/test')).status).toBe(429)
  })

  it('starts a fresh allowance at the exact moment the window ends', async () => {
    vi.useFakeTimers()
    const app = createApp(1, 60_000)

    await app.request('/test')
    expect((await app.request('/test')).status).toBe(429)

    vi.advanceTimersByTime(60_000)
    const rolled = await app.request('/test')

    expect(rolled.status).toBe(200)
    expect(rolled.headers.get('X-RateLimit-Remaining')).toBe('0')
  })

  it('counts Retry-After down as the window runs out', async () => {
    vi.useFakeTimers()
    const app = createApp(1, 60_000)

    await app.request('/test')
    vi.advanceTimersByTime(30_000)
    const res = await app.request('/test')

    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('30')
  })

  /**
   * The 60s sweep exists to stop the Map growing without bound, and it deletes
   * by resetAt. A sweep that dropped live entries would hand every caller a
   * fresh allowance every minute regardless of their window - so this uses a
   * five-minute window, lets the sweep run once at 60s, and requires the entry
   * to have survived it.
   */
  it('sweeps without disturbing a caller whose window is still open', async () => {
    vi.useFakeTimers()
    const app = createApp(1, 300_000)

    expect((await app.request('/test')).status).toBe(200)
    vi.advanceTimersByTime(60_000)

    expect((await app.request('/test')).status).toBe(429)
  })

  it('sweeps an expired entry, and the next caller starts clean', async () => {
    vi.useFakeTimers()
    const app = createApp(2, 60_000)

    await app.request('/test')
    await app.request('/test')
    // Two sweeps: the first at 60s finds the entry expired and drops it.
    vi.advanceTimersByTime(120_000)
    const res = await app.request('/test')

    expect(res.status).toBe(200)
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('1')
  })

  /**
   * Bun and the browser hand back a plain id from setInterval, with no unref
   * on it. Constructing the limiter there must not throw.
   */
  it('constructs where setInterval returns a bare id', async () => {
    vi.stubGlobal('setInterval', () => 1)
    const app = createApp(1)

    expect((await app.request('/test')).status).toBe(200)
    expect((await app.request('/test')).status).toBe(429)
  })
})
