// biome-ignore-all lint/style/noRestrictedImports: the rule keeps route HANDLERS
// off Drizzle. This is a test, and the readiness probe is what it asserts on.

import { getDb } from '@kerjacus/db'
import { hasTestDatabase } from '@kerjacus/db/testing'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { healthRoute } from './health'

/**
 * Liveness and readiness, which nothing tested.
 *
 * These two are what Docker and Traefik consult before routing traffic, so the
 * distinction between them is the whole point: `/` answers while the process is
 * alive, `/ready` answers only while the database is reachable. Getting that
 * backwards - a `/ready` that returns 200 with a dead database - sends live
 * traffic to an instance that cannot serve it, which is a worse failure than
 * the instance simply being absent.
 *
 * No advisory lock and no truncate here: the probe issues SELECT 1 and touches
 * no table, so this file neither serialises against the integration suites nor
 * disturbs their fixtures.
 */

const runIf = hasTestDatabase() ? describe : describe.skip

runIf('health probes', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reports liveness without consulting the database', async () => {
    const res = await healthRoute.request('/')

    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string; service: string; uptime: number }
    expect(body.status).toBe('ok')
    expect(body.service).toBe('project-service')
    expect(body.uptime).toBeGreaterThan(0)
  })

  /**
   * The body also carries the outbox publisher's connection state. No
   * processor is started in this file, so it reports disconnected - which is
   * the case worth pinning: an outbox that holds no NATS client is otherwise
   * invisible from outside the process, and that is exactly how a publisher
   * that failed its boot-time connect used to sit for the life of the service.
   *
   * It is reported, not failed on. The service serves every read and write
   * while the publisher is down and the queue drains on reconnect, so a 503
   * here would pull the instance out of rotation over a broker blip and
   * publish nothing by doing it. health-outbox.test.ts pins both branches.
   */
  it('reports ready when the database answers, and names the outbox state', async () => {
    getDb(process.env.TEST_DATABASE_URL)

    const res = await healthRoute.request('/ready')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ready', outbox: 'disconnected' })
  })

  /**
   * The branch that matters, and the only way to reach it against a database
   * that is up: fail the one statement the probe issues. The connection is
   * otherwise real - this forces the query to error, it does not replace the
   * database with a fake.
   */
  it('reports 503 rather than ok when the query fails', async () => {
    const db = getDb(process.env.TEST_DATABASE_URL)
    vi.spyOn(db, 'execute').mockRejectedValue(new Error('connection terminated unexpectedly'))

    const res = await healthRoute.request('/ready')

    expect(res.status).toBe(503)
    const body = (await res.json()) as { status: string; reason: string; error: string }
    expect(body.status).toBe('not ready')
    expect(body.reason).toBe('database unreachable')
    expect(body.error).toContain('connection terminated unexpectedly')
  })

  /** A recovered database must flip the probe back without a restart. */
  it('returns to ready once the database recovers', async () => {
    const db = getDb(process.env.TEST_DATABASE_URL)
    const spy = vi.spyOn(db, 'execute').mockRejectedValue(new Error('down'))
    expect((await healthRoute.request('/ready')).status).toBe(503)

    spy.mockRestore()

    expect((await healthRoute.request('/ready')).status).toBe(200)
  })
})
