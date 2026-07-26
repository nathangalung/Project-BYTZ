import './otel'
import { honoLogger } from '@kerjacus/logger'
import { Scalar } from '@scalar/hono-api-reference'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { env } from './lib/env'
import { correlationId } from './middleware/correlation-id'
import { errorHandler } from './middleware/error-handler'
import { generalRateLimit, strictRateLimit } from './middleware/rate-limit'
import { optionalSessionMiddleware, sessionMiddleware } from './middleware/session'
import { activityRoute } from './routes/activities'
import { applicationRoute } from './routes/applications'
import { chatRoute } from './routes/chat'
import { contractRoute } from './routes/contracts'
import { disputeRoute } from './routes/disputes'
import { healthRoute } from './routes/health'
import { invoicesRoute } from './routes/invoices'
import { matchingRoute } from './routes/matching'
import { milestonesRoute } from './routes/milestones'
import { projectsRoute } from './routes/projects'
import { realtimeRoute } from './routes/realtime'
import { reviewRoute } from './routes/reviews'
import { talentPlacementRoute } from './routes/talent-placement'
import { talentProfileRoute } from './routes/talent-profiles'
import { talentRoute } from './routes/talents'
import { timeLogRoute } from './routes/time-logs'
import { uploadRoute } from './routes/upload'
import { workPackageRoute } from './routes/work-packages'
import { startInvoiceConsumer, stopInvoiceConsumer } from './services/invoice-consumer'
import { startOutboxProcessor, stopOutboxProcessor } from './services/outbox-worker'
import { startScheduledJobs, stopScheduledJobs } from './services/scheduled-jobs'

const app = new Hono()

// Global middleware
app.use(
  '*',
  cors({
    origin: env.CORS_ORIGIN,
    credentials: true,
  }),
)
app.use('*', honoLogger('project-service'))
app.use('*', correlationId)

// Rate limiting: strict for AI-related endpoints, general for the rest
app.use('/api/v1/matching/*', strictRateLimit)

/**
 * The strict tier is for calls that reach the model. Path matching here is
 * exact, so /projects/:id/chat alone left the SSE stream and every
 * document-generation route on the general 100/min tier - and generating a
 * PRD is the most expensive call the platform makes.
 *
 * Owner-to-talent chat is platform messaging, not an AI call, and stays on
 * the general tier: throttling people talking to each other would be
 * throttling the wrong thing.
 */
app.use('/api/v1/projects/:id/chat', strictRateLimit)
app.use('/api/v1/projects/:id/chat/stream', strictRateLimit)
app.use('/api/v1/projects/:id/generate-brd', strictRateLimit)
app.use('/api/v1/projects/:id/generate-prd', strictRateLimit)
app.use('/api/v1/projects/:id/brd/revision', strictRateLimit)
app.use('/api/v1/projects/:id/prd/revision', strictRateLimit)
app.use('/api/v1/projects/:id/upload-spec', strictRateLimit)

app.use('/api/v1/*', generalRateLimit)

// Session middleware — skip public endpoints
app.use('/api/v1/*', async (c, next) => {
  const path = c.req.path
  const method = c.req.method

  const publicRoutes = [
    { path: '/api/v1/projects/stats', method: 'GET' },
    { path: '/api/v1/projects/public', method: 'GET' },
    { path: '/api/v1/projects/available', method: 'GET' },
    { path: '/api/v1/reviews/public', method: 'GET' },
    { path: '/api/v1/projects/docs', method: 'GET' },
    { path: '/api/v1/projects/openapi.json', method: 'GET' },
  ]

  if (publicRoutes.some((r) => path === r.path && method === r.method)) {
    return next()
  }

  // Public project detail viewing (GET /api/v1/projects/:id).
  // Resolve the session when one is present but never require it: the handler
  // applies the visibility gate and needs to know whether the caller is the
  // owner. Returning next() outright made every project world-readable.
  if (method === 'GET' && /^\/api\/v1\/projects\/[^/]+$/.test(path)) {
    return optionalSessionMiddleware(c, next)
  }

  // Inter-service routes that accept X-Service-Auth (route handlers verify the secret)
  const serviceAuthRoutes = [{ path: '/api/v1/matching/recommend', method: 'POST' }]
  if (
    c.req.header('X-Service-Auth') &&
    serviceAuthRoutes.some((r) => path === r.path && method === r.method)
  ) {
    return next()
  }

  return sessionMiddleware(c, next)
})

// Error handler
app.onError(errorHandler)

// OpenAPI documentation
app.get(
  '/api/v1/projects/docs',
  Scalar({
    url: '/api/v1/projects/openapi.json',
    pageTitle: 'Project Service API',
  }),
)
app.get('/api/v1/projects/openapi.json', (c) =>
  c.json({
    openapi: '3.1.0',
    info: { title: 'Project Service', version: '1.0.0' },
    paths: {},
  }),
)

// Routes
app.route('/health', healthRoute)
app.route('/api/v1/projects', projectsRoute)
app.route('/api/v1', milestonesRoute)
app.route('/api/v1/matching', matchingRoute)
app.route('/api/v1/work-packages', workPackageRoute)
app.route('/api/v1/time-logs', timeLogRoute)
app.route('/api/v1/talents', talentRoute)
app.route('/api/v1/reviews', reviewRoute)
app.route('/api/v1/disputes', disputeRoute)
app.route('/api/v1/contracts', contractRoute)
app.route('/api/v1/chat', chatRoute)
app.route('/api/v1/applications', applicationRoute)
app.route('/api/v1/talent-profiles', talentProfileRoute)
app.route('/api/v1/talent-placement', talentPlacementRoute)
app.route('/api/v1/upload', uploadRoute)
app.route('/api/v1/activities', activityRoute)
app.route('/api/v1/realtime', realtimeRoute)
app.route('/api/v1', invoicesRoute)

const port = env.PORT
console.log(`Project service running on port ${port}`)

// Start outbox worker, scheduled jobs, and invoice consumer
startOutboxProcessor().catch(console.error)
startScheduledJobs()
startInvoiceConsumer().catch(console.error)

// Graceful shutdown: drain the NATS connection and stop schedulers so in-flight
// outbox publishes are flushed instead of dropped when the orchestrator kills us.
let shuttingDown = false
const shutdown = async (signal: string) => {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[project-service] ${signal} received, shutting down`)
  stopScheduledJobs()
  try {
    await stopInvoiceConsumer()
  } catch (err) {
    console.error('[project-service] invoice consumer stop error:', err)
  }
  try {
    await stopOutboxProcessor()
  } catch (err) {
    console.error('[project-service] outbox stop error:', err)
  }
  process.exit(0)
}
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))

export default {
  port,
  fetch: app.fetch,
}
