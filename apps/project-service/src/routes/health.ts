import { getDb } from '@kerjacus/db'
import { sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { isOutboxConnected } from '../services/outbox-worker'

export const healthRoute = new Hono()

healthRoute.get('/', (c) => {
  return c.json({
    status: 'ok',
    service: 'project-service',
    uptime: process.uptime(),
  })
})

/**
 * Readiness, plus whether the outbox publisher holds a broker connection.
 *
 * A publisher that lost NATS is invisible from outside the process: the rows
 * are durable and pile up silently. It is reported rather than failing the
 * probe, because the service still serves every read and write while it is
 * disconnected and the queue drains on reconnect - taking the pod out of
 * rotation over a broker blip costs availability and publishes nothing.
 */
healthRoute.get('/ready', async (c) => {
  try {
    await getDb().execute(sql`SELECT 1`)
    return c.json({ status: 'ready', outbox: isOutboxConnected() ? 'connected' : 'disconnected' })
  } catch (err) {
    return c.json({ status: 'not ready', reason: 'database unreachable', error: String(err) }, 503)
  }
})
