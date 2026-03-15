import { honoLogger } from '@bytz/logger'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { errorHandler } from './middleware/error-handler'
import { healthRoute } from './routes/health'
import { notificationsRoute } from './routes/notifications'

const app = new Hono()

app.use(
  '*',
  cors({
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
    credentials: true,
  }),
)
app.use('*', honoLogger('notification-service'))

app.route('/health', healthRoute)
app.route('/api/v1/notifications', notificationsRoute)

app.onError(errorHandler)

const port = Number(process.env.PORT) || 3005
console.log(`Notification service running on port ${port}`)

export default {
  port,
  fetch: app.fetch,
}
