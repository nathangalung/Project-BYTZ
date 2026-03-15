import { Hono } from 'hono'

export const healthRoute = new Hono()

healthRoute.get('/', (c) => {
  return c.json({
    status: 'ok',
    service: 'admin-service',
    uptime: process.uptime(),
  })
})

healthRoute.get('/ready', (c) => {
  return c.json({ status: 'ready' })
})
