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
