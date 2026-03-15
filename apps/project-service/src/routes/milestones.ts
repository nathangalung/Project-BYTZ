import { getDb } from '@bytz/db'
import { AppError, type MilestoneStatus } from '@bytz/shared'
import { Hono } from 'hono'
import { z } from 'zod'
import { MilestoneRepository } from '../repositories/milestone.repository'
import { ProjectRepository } from '../repositories/project.repository'
import { MilestoneService } from '../services/milestone.service'

const milestoneStatusValues = [
  'pending',
  'in_progress',
  'submitted',
  'revision_requested',
  'approved',
  'rejected',
] as const

const createMilestoneSchema = z.object({
  workPackageId: z.string().uuid().optional(),
  assignedWorkerId: z.string().uuid().optional(),
  title: z.string().min(3).max(255),
  description: z.string().min(5).max(5000),
  milestoneType: z.enum(['individual', 'integration']).default('individual'),
  orderIndex: z.number().int().nonnegative(),
  amount: z.number().int().nonnegative(),
  dueDate: z.string().datetime(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

const updateStatusSchema = z.object({
  status: z.enum(milestoneStatusValues),
})

function getService(): MilestoneService {
  const db = getDb()
  const milestoneRepo = new MilestoneRepository(db)
  const projectRepo = new ProjectRepository(db)
  return new MilestoneService(milestoneRepo, projectRepo)
}

export const milestonesRoute = new Hono()

// GET /projects/:projectId/milestones - list milestones for project
milestonesRoute.get('/projects/:projectId/milestones', async (c) => {
  const projectId = c.req.param('projectId')
  const service = getService()

  const milestones = await service.listByProject(projectId)

  return c.json({
    success: true,
    data: milestones,
  })
})

// POST /projects/:projectId/milestones - create milestone
milestonesRoute.post('/projects/:projectId/milestones', async (c) => {
  const projectId = c.req.param('projectId')
  const body = await c.req.json()

  const parsed = createMilestoneSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid milestone data', {
      issues: parsed.error.flatten().fieldErrors,
    })
  }

  const service = getService()
  const milestone = await service.createMilestone({
    projectId,
    workPackageId: parsed.data.workPackageId ?? null,
    assignedWorkerId: parsed.data.assignedWorkerId ?? null,
    title: parsed.data.title,
    description: parsed.data.description,
    milestoneType: parsed.data.milestoneType,
    orderIndex: parsed.data.orderIndex,
    amount: parsed.data.amount,
    dueDate: parsed.data.dueDate,
    metadata: parsed.data.metadata ?? null,
  })

  return c.json(
    {
      success: true,
      data: milestone,
    },
    201,
  )
})

// PATCH /milestones/:id/status - update milestone status
milestonesRoute.patch('/milestones/:id/status', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()

  const parsed = updateStatusSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid status data', {
      issues: parsed.error.flatten().fieldErrors,
    })
  }

  const service = getService()
  const milestone = await service.updateMilestoneStatus(id, parsed.data.status as MilestoneStatus)

  return c.json({
    success: true,
    data: milestone,
  })
})
