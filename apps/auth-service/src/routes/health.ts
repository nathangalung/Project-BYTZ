import { getDb } from '@bytz/db'
import { sql } from 'drizzle-orm'
import { Hono } from 'hono'

export const healthRoute = new Hono()

const startTime = Date.now()

healthRoute.get('/', (c) => {
  return c.json({
    status: 'ok',
    service: 'auth-service',
    uptime: Math.floor((Date.now() - startTime) / 1000),
  })
})

healthRoute.get('/ready', async (c) => {
  try {
    const db = getDb()
    await db.execute(sql`SELECT 1`)
    return c.json({ status: 'ready' })
  } catch {
    return c.json({ status: 'not_ready', reason: 'database connection failed' }, 503)
  }
})
