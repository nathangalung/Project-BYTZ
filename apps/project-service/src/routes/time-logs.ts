import { getDb } from '@bytz/db'
import { AppError } from '@bytz/shared'
import { Hono } from 'hono'
import { z } from 'zod'
import { TimeLogRepository } from '../repositories/time-log.repository'
import { TimeLogService } from '../services/time-log.service'

const createTimeLogSchema = z.object({
  taskId: z.string(),
  workerId: z.string(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().optional(),
  durationMinutes: z.number().int().positive().optional(),
  description: z.string().max(500).optional(),
})

function getService(): TimeLogService {
  const db = getDb()
  const repo = new TimeLogRepository(db)
  return new TimeLogService(repo)
}

export const timeLogRoute = new Hono()

// POST / - create a time log entry
timeLogRoute.post('/', async (c) => {
  const body = await c.req.json()

  const parsed = createTimeLogSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid time log data', {
      issues: parsed.error.flatten().fieldErrors,
    })
  }

  const service = getService()
  const log = await service.createTimeLog(parsed.data)

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
  const id = c.req.param('id')
  const service = getService()

  const log = await service.stopTimer(id)

  return c.json({
    success: true,
    data: log,
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

// GET /worker/:workerId - list time logs for a worker
timeLogRoute.get('/worker/:workerId', async (c) => {
  const workerId = c.req.param('workerId')
  const service = getService()

  const logs = await service.getByWorker(workerId)

  return c.json({
    success: true,
    data: logs,
  })
})
