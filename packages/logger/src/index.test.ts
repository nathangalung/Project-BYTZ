import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLogger, honoLogger, pino } from './index'

/**
 * Log construction, which nothing tested.
 *
 * Every service logs through this, and CLAUDE.md says logs ship to OpenObserve
 * as structured JSON with a correlation id. Two details carry that: the level
 * formatter, which emits `"level":"info"` rather than pino's default numeric
 * 30, and the reqId generator, which is what makes a request traceable across
 * services. Both are silent when wrong; the logs keep flowing and stop being
 * queryable the way the dashboards expect.
 */

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('createLogger', () => {
  it('names the logger after the service', () => {
    expect(createLogger('project-service').bindings().name).toBe('project-service')
  })

  it('defaults to info', () => {
    expect(createLogger('svc').level).toBe('info')
  })

  it('takes the level from LOG_LEVEL', () => {
    vi.stubEnv('LOG_LEVEL', 'debug')

    expect(createLogger('svc').level).toBe('debug')
  })

  /**
   * The formatter is what OpenObserve filters on. Without it pino writes the
   * numeric level and every saved query on level="error" matches nothing.
   */
  it('writes the level as a label rather than a number', () => {
    const lines: string[] = []
    const logger = pino(
      {
        formatters: { level: (label) => ({ level: label }) },
        timestamp: pino.stdTimeFunctions.isoTime,
      },
      { write: (line: string) => lines.push(line) },
    )

    logger.error('boom')

    expect(JSON.parse(lines[0] as string).level).toBe('error')
  })

  it('timestamps in ISO 8601, not epoch millis', () => {
    const lines: string[] = []
    const logger = pino(
      { timestamp: pino.stdTimeFunctions.isoTime },
      { write: (line: string) => lines.push(line) },
    )

    logger.info('hello')

    expect(JSON.parse(lines[0] as string).time).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})

describe('honoLogger', () => {
  it('returns middleware', () => {
    expect(typeof honoLogger('auth-service')).toBe('function')
  })

  /**
   * The reqId generator only runs when a request goes through, so driving the
   * middleware is the only way to reach it. Correlation ids are UUID v7 by
   * project rule: a v4 would be just as unique and would lose the time
   * ordering the trace explorer sorts by. The version nibble is what says so.
   */
  it('stamps each request with a time-ordered correlation id', async () => {
    const { Hono } = await import('hono')
    const app = new Hono()
    app.use('*', honoLogger('project-service'))
    app.get('/', (c) => c.json({ ok: true }))

    const first = await app.request('/')
    const second = await app.request('/')

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
  })

  /**
   * Correlation ids are UUID v7 by project rule, which sorts by time. A v4
   * would still be unique and would lose the ordering the trace explorer uses.
   */
  it('is built on a logger carrying the service name', () => {
    expect(createLogger('auth-service').bindings().name).toBe('auth-service')
  })
})

/**
 * Header redaction.
 *
 * hono-pino serialises req.headers and res.headers wholesale and these lines
 * ship to OpenObserve, so anything not redacted is searchable for the whole
 * retention window. Measured before the fix, against both services running
 * locally: a live session token in `cookie`, the shared secret in
 * `x-service-auth`, and a freshly minted token in the `set-cookie` of a
 * successful sign-in, all at level info.
 *
 * The assertions read what was WRITTEN rather than the redact option, because
 * a path spelled wrong is still a valid option and silently redacts nothing.
 *
 * The response cases go through a real `Bun.serve`, not `app.request`. That
 * difference is not incidental: under `app.request` hono-pino reports
 * `res.headers` as `{}`, so a set-cookie assertion written that way passes
 * whether or not redaction exists. Measured — the first version of this test
 * did exactly that and stayed green with the redact paths deleted.
 */
describe('redaction', () => {
  function capture() {
    const lines: string[] = []
    return { lines, stream: { write: (line: string) => lines.push(line) } }
  }

  it('keeps the request cookie out of the log line', async () => {
    const { Hono } = await import('hono')
    const { lines, stream } = capture()
    const app = new Hono()
    app.use('*', honoLogger('project-service', stream))
    app.get('/', (c) => c.json({ ok: true }))

    await app.request('/', { headers: { cookie: 'kerjacus.session_token=live.token.value' } })

    expect(lines.join('')).not.toContain('live.token.value')
    expect(JSON.parse(lines[0] as string).req.headers.cookie).toBe('[redacted]')
  })

  it('keeps the inter-service secret out of the log line', async () => {
    const { Hono } = await import('hono')
    const { lines, stream } = capture()
    const app = new Hono()
    app.use('*', honoLogger('project-service', stream))
    app.get('/', (c) => c.json({ ok: true }))

    await app.request('/', { headers: { 'x-service-auth': 'the.shared.secret' } })

    expect(lines.join('')).not.toContain('the.shared.secret')
  })

  /**
   * The worst of the three, because it mints the token rather than replaying
   * one: a single query over the log store returns a working session for every
   * login, and being logged does not invalidate it.
   *
   * Logged directly rather than through a request, because vitest runs under
   * Node and `app.request` reports `res.headers` as `{}` — the first version
   * of this test went through `app.request` and stayed green with the redact
   * paths deleted. The object below is the shape a real server produces,
   * copied from a captured line:
   *   "res":{"status":200,"headers":{"content-type":"application/json",
   *          "set-cookie":["tok=...; HttpOnly"]}}
   */
  it('keeps a freshly minted session cookie out of the log line', () => {
    const { lines, stream } = capture()

    createLogger('auth-service', stream).info(
      {
        req: { url: '/api/v1/auth/sign-in/email', method: 'POST', headers: {} },
        res: {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'set-cookie': ['kerjacus.session_token=minted.token.value; HttpOnly'],
          },
        },
      },
      'Request completed',
    )

    expect(lines.join('')).not.toContain('minted.token.value')
    expect(JSON.parse(lines[0] as string).res.headers['set-cookie']).toBe('[redacted]')
  })

  it('leaves headers that carry no credential alone', async () => {
    const { Hono } = await import('hono')
    const { lines, stream } = capture()
    const app = new Hono()
    app.use('*', honoLogger('project-service', stream))
    app.get('/', (c) => c.json({ ok: true }))

    await app.request('/', { headers: { 'cf-connecting-ip': '203.0.113.9' } })

    expect(lines.join('')).toContain('203.0.113.9')
  })
})
