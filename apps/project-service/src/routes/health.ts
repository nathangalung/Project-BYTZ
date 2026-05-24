import { getDb } from '@kerjacus/db'
import { sql } from 'drizzle-orm'
import { Hono } from 'hono'

export const healthRoute = new Hono()

healthRoute.get('/', (c) => {
  return c.json({
    status: 'ok',
    service: 'project-service',
    uptime: process.uptime(),
  })
})

healthRoute.get('/ready', async (c) => {
  try {
    await getDb().execute(sql`SELECT 1`)
    return c.json({ status: 'ready' })
  } catch (err) {
    return c.json({ status: 'not ready', reason: 'database unreachable', error: String(err) }, 503)
  }
})
