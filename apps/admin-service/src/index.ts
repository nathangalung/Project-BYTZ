import { honoLogger } from '@bytz/logger'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { adminAuth } from './middleware/admin-auth'
import { errorHandler } from './middleware/error-handler'
import { dashboardRoute } from './routes/dashboard'
import { healthRoute } from './routes/health'
import { usersRoute } from './routes/users'

const app = new Hono()

app.use(
  '*',
  cors({
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
    credentials: true,
  }),
)
app.use('*', honoLogger('admin-service'))
app.use('/api/v1/admin/*', adminAuth)

app.route('/health', healthRoute)
app.route('/api/v1/admin', dashboardRoute)
app.route('/api/v1/admin/users', usersRoute)

app.onError(errorHandler)

const port = Number(process.env.PORT) || 3006
console.log(`Admin service running on port ${port}`)

export default {
  port,
  fetch: app.fetch,
}
