import { honoLogger } from '@kerjacus/logger'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { correlationId } from './middleware/correlation-id'
import { errorHandler } from './middleware/error-handler'
import { generalRateLimit, strictRateLimit } from './middleware/rate-limit'
import { sessionMiddleware } from './middleware/session'
import { activityRoute } from './routes/activities'
import { applicationRoute } from './routes/applications'
import { chatRoute } from './routes/chat'
import { contractRoute } from './routes/contracts'
import { disputeRoute } from './routes/disputes'
import { healthRoute } from './routes/health'
import { matchingRoute } from './routes/matching'
import { milestonesRoute } from './routes/milestones'
import { projectsRoute } from './routes/projects'
import { reviewRoute } from './routes/reviews'
import { talentProfileRoute } from './routes/talent-profiles'
import { talentRoute } from './routes/talents'
import { timeLogRoute } from './routes/time-logs'
import { uploadRoute } from './routes/upload'
import { workPackageRoute } from './routes/work-packages'
import { startOutboxProcessor } from './services/outbox-worker'
import { startScheduledJobs } from './services/scheduled-jobs'

const app = new Hono()

// Global middleware
app.use(
  '*',
  cors({
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
    credentials: true,
  }),
)
app.use('*', honoLogger('project-service'))
app.use('*', correlationId)

// Rate limiting: strict for AI-related endpoints, general for the rest
app.use('/api/v1/matching/*', strictRateLimit)
app.use('/api/v1/projects/:id/chat', strictRateLimit)
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
  ]

  if (publicRoutes.some((r) => path === r.path && method === r.method)) {
    return next()
  }

  // Public project detail viewing (GET /api/v1/projects/:id)
  if (method === 'GET' && /^\/api\/v1\/projects\/[^/]+$/.test(path)) {
    return next()
  }

  return sessionMiddleware(c, next)
})

// Error handler
app.onError(errorHandler)

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
app.route('/api/v1/upload', uploadRoute)
app.route('/api/v1/activities', activityRoute)

const port = Number(process.env.PORT) || 3002
console.log(`Project service running on port ${port}`)

// Start outbox worker and scheduled jobs
startOutboxProcessor().catch(console.error)
startScheduledJobs()

export default {
  port,
  fetch: app.fetch,
}
