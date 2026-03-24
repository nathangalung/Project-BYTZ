import { authEnvSchema, validateEnv } from '@kerjacus/config'
import { honoLogger } from '@kerjacus/logger'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { uuidv7 } from 'uuidv7'
import { errorHandler } from './middleware/error-handler'
import { generalRateLimit, strictRateLimit } from './middleware/rate-limit'
import { authRoute } from './routes/auth'
import { healthRoute } from './routes/health'
import { meRoute } from './routes/me'
import { phoneVerificationRoute } from './routes/phone-verification'

// Validate env at startup - fail fast
const env = validateEnv(authEnvSchema)

const app = new Hono()

// Correlation ID middleware
app.use('*', async (c, next) => {
  const requestId = c.req.header('X-Request-ID') ?? uuidv7()
  c.header('X-Request-ID', requestId)
  await next()
})

// CORS
app.use(
  '*',
  cors({
    origin: env.CORS_ORIGIN,
    credentials: true,
  }),
)

// Structured logging
app.use('*', honoLogger('auth-service'))

// Rate limiting: strict for auth endpoints, general for the rest
app.use('/api/v1/auth/*', strictRateLimit)
app.use('/api/v1/*', generalRateLimit)

// Error handler
app.onError(errorHandler)

// Routes
app.route('/health', healthRoute)
app.route('/api/v1/auth', authRoute)
app.route('/api/v1/me', meRoute)
app.route('/api/v1/phone', phoneVerificationRoute)

const port = env.PORT
console.log(`Auth service running on port ${port}`)

export default {
  port,
  fetch: app.fetch,
}
