import { getDb, projectAssignments, projects, talentProfiles, timeLogs } from '@kerjacus/db'
import { AppError } from '@kerjacus/shared'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { appendOutboxEvent } from '../lib/outbox'
import { getAuthUser } from '../middleware/session'
import { TimeLogRepository } from '../repositories/time-log.repository'
import { TimeLogService } from '../services/time-log.service'

const createTimeLogSchema = z.object({
  taskId: z.string(),
  talentId: z.string().optional(),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().optional(),
  durationMinutes: z.number().int().positive().optional(),
  description: z.string().max(500).optional(),
})

function getService(): TimeLogService {
  const db = getDb()
  const repo = new TimeLogRepository(db)
  return new TimeLogService(repo)
}

export const timeLogRoute = new Hono()

// GET /project/:projectId - list time logs for a project
timeLogRoute.get('/project/:projectId', async (c) => {
  const projectId = c.req.param('projectId')
  const service = getService()

  const logs = await service.getByProject(projectId)

  return c.json({
    success: true,
    data: logs,
  })
})

// POST / - create a time log entry
timeLogRoute.post('/', async (c) => {
  const body = await c.req.json()

  const parsed = createTimeLogSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid time log data', {
      issues: z.flattenError(parsed.error).fieldErrors,
    })
  }

  const user = getAuthUser(c)
  const db = getDb()

  // Resolve talent profile from session if not provided in payload
  const lookupClause = parsed.data.talentId
    ? eq(talentProfiles.id, parsed.data.talentId)
    : eq(talentProfiles.userId, user.id)
  const [profile] = await db
    .select({ id: talentProfiles.id, userId: talentProfiles.userId })
    .from(talentProfiles)
    .where(lookupClause)
    .limit(1)
  if (!profile || profile.userId !== user.id) {
    throw new AppError('AUTH_FORBIDDEN', 'Can only log time for your own talent profile')
  }

  const service = getService()
  const log = await service.createTimeLog({ ...parsed.data, talentId: profile.id })

  await appendOutboxEvent(db, {
    aggregateType: 'time_log',
    aggregateId: log.id,
    eventType: 'time_log.created',
    payload: { timeLogId: log.id, taskId: parsed.data.taskId, talentId: profile.id },
  })

  return c.json(
    {
      success: true,
      data: log,
    },
    201,
  )
})

// POST /:id/stop - stop an active timer
timeLogRoute.post('/:id/stop', async (c) => {
  const user = getAuthUser(c)
  const id = c.req.param('id')

  // Verify user owns the talent profile that started this timer
  const db = getDb()
  const [log] = await db
    .select({ talentId: timeLogs.talentId })
    .from(timeLogs)
    .where(eq(timeLogs.id, id))
    .limit(1)

  if (!log) {
    throw new AppError('NOT_FOUND', 'Time log not found')
  }

  const [profile] = await db
    .select({ userId: talentProfiles.userId })
    .from(talentProfiles)
    .where(eq(talentProfiles.id, log.talentId))
    .limit(1)

  if (!profile || profile.userId !== user.id) {
    throw new AppError('AUTH_FORBIDDEN', 'Can only stop your own timer')
  }

  const service = getService()
  const result = await service.stopTimer(id)

  await appendOutboxEvent(db, {
    aggregateType: 'time_log',
    aggregateId: id,
    eventType: 'time_log.stopped',
    payload: { timeLogId: id, talentId: log.talentId },
  })

  return c.json({
    success: true,
    data: result,
  })
})

// GET /task/:taskId - list time logs for a task
timeLogRoute.get('/task/:taskId', async (c) => {
  const taskId = c.req.param('taskId')
  const service = getService()

  const logs = await service.getByTask(taskId)

  return c.json({
    success: true,
    data: logs,
  })
})

// GET /talent/:talentId - list time logs for a talent
timeLogRoute.get('/talent/:talentId', async (c) => {
  const talentId = c.req.param('talentId')
  const service = getService()

  const logs = await service.getByTalent(talentId)

  return c.json({
    success: true,
    data: logs,
  })
})

// GET /project/:projectId/summary - aggregate time log summary per talent/milestone
timeLogRoute.get('/project/:projectId/summary', async (c) => {
  const user = getAuthUser(c)
  const projectId = c.req.param('projectId')
  const db = getDb()

  // Validate access: project owner OR assigned talent
  const [project] = await db
    .select({ ownerId: projects.ownerId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)

  if (!project) {
    throw new AppError('NOT_FOUND', 'Project not found')
  }

  if (project.ownerId !== user.id) {
    const [talentProfile] = await db
      .select({ id: talentProfiles.id })
      .from(talentProfiles)
      .where(eq(talentProfiles.userId, user.id))
      .limit(1)

    if (!talentProfile) {
      throw new AppError('AUTH_FORBIDDEN', 'Not authorized')
    }

    const [assignment] = await db
      .select({ id: projectAssignments.id })
      .from(projectAssignments)
      .where(
        and(
          eq(projectAssignments.projectId, projectId),
          eq(projectAssignments.talentId, talentProfile.id),
        ),
      )
      .limit(1)

    if (!assignment) {
      throw new AppError('AUTH_FORBIDDEN', 'Not authorized')
    }
  }

  const service = getService()
  const summary = await service.getProjectSummary(projectId)

  return c.json({
    success: true,
    data: summary,
  })
})
