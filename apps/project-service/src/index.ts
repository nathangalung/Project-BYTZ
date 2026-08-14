import './otel'
import { honoLogger } from '@kerjacus/logger'
import { Scalar } from '@scalar/hono-api-reference'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { env } from './lib/env'
import { deriveOpenApiPaths } from './lib/openapi'
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
import { startSettlementConsumer, stopSettlementConsumer } from './services/settlement-consumer'

// Exported so openapi-parity.test.ts can read the mounted route table.
export const app = new Hono()

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

/**
 * Reachable with no session. Read by the middleware below and by the OpenAPI
 * document, so the contract cannot advertise auth the gate does not require.
 */
const PUBLIC_ROUTES = [
  { path: '/api/v1/projects/stats', method: 'GET' },
  { path: '/api/v1/projects/public', method: 'GET' },
  { path: '/api/v1/projects/available', method: 'GET' },
  { path: '/api/v1/reviews/public', method: 'GET' },
  { path: '/api/v1/projects/docs', method: 'GET' },
  { path: '/api/v1/projects/openapi.json', method: 'GET' },
] as const

/** Inter-service callers presenting X-Service-Auth; handlers verify the secret. */
const SERVICE_AUTH_ROUTES = [{ path: '/api/v1/matching/recommend', method: 'POST' }] as const

/** Prefix the session gate below is mounted on. /health sits outside it. */
const SESSION_PREFIX = '/api/v1/'

// Session middleware — skip public endpoints
app.use('/api/v1/*', async (c, next) => {
  const path = c.req.path
  const method = c.req.method

  if (PUBLIC_ROUTES.some((r) => path === r.path && method === r.method)) {
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
  if (
    c.req.header('X-Service-Auth') &&
    SERVICE_AUTH_ROUTES.some((r) => path === r.path && method === r.method)
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
/**
 * Built on first request, not here. This handler has to stay above the
 * app.route() calls: registration order decides, and moving it below the
 * /api/v1/projects mount resolves this URL to the project-detail :id handler
 * instead, so the spec becomes unreachable. That leaves app.routes nearly
 * empty at this point, so the document is derived on first read instead of
 * at registration, and memoised after.
 */
let openApiDocument: Record<string, unknown> | undefined

function buildOpenApiDocument(): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: {
      title: 'KerjaCUS Project Service',
      version: '1.0.0',
      description:
        'Project lifecycle, work packages, milestones, matching, chat, documents and invoices.\n\n' +
        'Paths are derived from the mounted Hono route table, so they cannot drift from the ' +
        'running service. A route table carries methods, paths and path parameters and nothing ' +
        'else, so this document does NOT describe request bodies, success payloads or success ' +
        'status codes. Only the error envelope is documented, because app.onError returns it ' +
        'uniformly. Read the route handler for the rest.',
    },
    servers: [{ url: '/', description: 'Same-origin via API Gateway' }],
    components: {
      securitySchemes: {
        sessionCookie: {
          type: 'apiKey',
          in: 'cookie',
          name: 'better-auth.session_token',
          description: 'httpOnly Secure SameSite=Lax session cookie, issued by auth-service',
        },
        serviceAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'X-Service-Auth',
          description: 'Shared inter-service secret; not accepted from the public gateway',
        },
      },
      responses: {
        Error: {
          description: 'Error envelope from the shared handler',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
      },
      schemas: {
        // packages/shared ApiResponse, as middleware/error-handler.ts returns it.
        Error: {
          type: 'object',
          properties: {
            success: { type: 'boolean', enum: [false] },
            error: {
              type: 'object',
              properties: {
                code: { type: 'string', description: 'Key into packages/shared/src/errors.ts' },
                message: { type: 'string' },
                details: { type: 'object', additionalProperties: true },
              },
              required: ['code', 'message'],
            },
          },
          required: ['success', 'error'],
        },
      },
    },
    paths: deriveOpenApiPaths(app.routes, {
      // These two serve the document; listing them inside it is circular.
      exclude: ['GET /api/v1/projects/docs', 'GET /api/v1/projects/openapi.json'],
      anonymous: PUBLIC_ROUTES.map((r) => `${r.method} ${r.path}`),
      // Readable anonymously, but the handler widens the payload for the owner.
      optionalSession: ['GET /api/v1/projects/:id'],
      serviceAuth: SERVICE_AUTH_ROUTES.map((r) => `${r.method} ${r.path}`),
    }),
  }
}

app.get('/api/v1/projects/openapi.json', (c) => {
  openApiDocument ??= buildOpenApiDocument()
  return c.json(openApiDocument)
})

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
startSettlementConsumer().catch(console.error)

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
    await stopSettlementConsumer()
  } catch (err) {
    console.error('[project-service] settlement consumer stop error:', err)
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
