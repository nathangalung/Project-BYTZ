import { honoLogger } from '@bytz/logger'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { correlationId } from './middleware/correlation-id'
import { errorHandler } from './middleware/error-handler'
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
import { timeLogRoute } from './routes/time-logs'
import { uploadRoute } from './routes/upload'
import { workPackageRoute } from './routes/work-packages'
import { workerProfileRoute } from './routes/worker-profiles'
import { workerRoute } from './routes/workers'

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

// Error handler
app.onError(errorHandler)

// Routes
app.route('/health', healthRoute)
app.route('/api/v1/projects', projectsRoute)
app.route('/api/v1', milestonesRoute)
app.route('/api/v1/matching', matchingRoute)
app.route('/api/v1/work-packages', workPackageRoute)
app.route('/api/v1/time-logs', timeLogRoute)
app.route('/api/v1/workers', workerRoute)
app.route('/api/v1/reviews', reviewRoute)
app.route('/api/v1/disputes', disputeRoute)
app.route('/api/v1/contracts', contractRoute)
app.route('/api/v1/chat', chatRoute)
app.route('/api/v1/applications', applicationRoute)
app.route('/api/v1/worker-profiles', workerProfileRoute)
app.route('/api/v1/upload', uploadRoute)
app.route('/api/v1/activities', activityRoute)

const port = Number(process.env.PORT) || 3002
console.log(`Project service running on port ${port}`)

export default {
  port,
  fetch: app.fetch,
}
