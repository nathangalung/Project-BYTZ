import { honoLogger } from '@bytz/logger'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { errorHandler } from './middleware/error-handler'
import { healthRoute } from './routes/health'
import { paymentsRoute } from './routes/payments'
import { webhookRoute } from './routes/webhook'

const app = new Hono()

app.use(
  '*',
  cors({
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
    credentials: true,
  }),
)
app.use('*', honoLogger('payment-service'))

app.route('/health', healthRoute)
app.route('/api/v1/payments', paymentsRoute)
app.route('/api/v1/payments/webhook', webhookRoute)

app.onError(errorHandler)

const port = Number(process.env.PORT) || 3004
console.log(`Payment service running on port ${port}`)

export default {
  port,
  fetch: app.fetch,
}
