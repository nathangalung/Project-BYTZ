import {
  getDb,
  milestones as milestonesTable,
  outboxEvents,
  projects,
  talentProfiles,
} from '@kerjacus/db'
import { AppError, type MilestoneStatus } from '@kerjacus/shared'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { uuidv7 } from 'uuidv7'
import { z } from 'zod'
import { getAuthUser } from '../middleware/session'
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
  assignedTalentId: z.string().uuid().optional(),
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

  // Verify project ownership
  const user = getAuthUser(c)
  const db = getDb()
  const [project] = await db
    .select({ ownerId: projects.ownerId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)
  if (!project || project.ownerId !== user.id) {
    throw new AppError('AUTH_FORBIDDEN', 'Only the project owner can create milestones')
  }

  const service = getService()
  const milestone = await service.createMilestone({
    projectId,
    workPackageId: parsed.data.workPackageId ?? null,
    assignedTalentId: parsed.data.assignedTalentId ?? null,
    title: parsed.data.title,
    description: parsed.data.description,
    milestoneType: parsed.data.milestoneType,
    orderIndex: parsed.data.orderIndex,
    amount: parsed.data.amount,
    dueDate: parsed.data.dueDate,
    metadata: parsed.data.metadata ?? null,
  })

  // Emit outbox event
  await db.insert(outboxEvents).values({
    id: uuidv7(),
    aggregateType: 'milestone',
    aggregateId: milestone.id,
    eventType: 'milestone.created',
    payload: { milestoneId: milestone.id, projectId, title: parsed.data.title },
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
  const user = getAuthUser(c)
  const id = c.req.param('id')
  const body = await c.req.json()

  const parsed = updateStatusSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid status data', {
      issues: parsed.error.flatten().fieldErrors,
    })
  }

  // Fetch milestone to get projectId
  const db = getDb()
  const [ms] = await db
    .select({
      projectId: milestonesTable.projectId,
      assignedTalentId: milestonesTable.assignedTalentId,
    })
    .from(milestonesTable)
    .where(eq(milestonesTable.id, id))
    .limit(1)
  if (!ms) {
    throw new AppError('NOT_FOUND', 'Milestone not found')
  }

  // Owner can approve, reject, request revision
  const [project] = await db
    .select({ ownerId: projects.ownerId })
    .from(projects)
    .where(eq(projects.id, ms.projectId))
    .limit(1)
  const isOwner = project?.ownerId === user.id

  // Assigned talent can submit, move to in_progress
  let isTalent = false
  if (!isOwner && ms.assignedTalentId) {
    const [profile] = await db
      .select({ userId: talentProfiles.userId })
      .from(talentProfiles)
      .where(eq(talentProfiles.id, ms.assignedTalentId))
      .limit(1)
    isTalent = !!profile && profile.userId === user.id
  }

  if (!isOwner && !isTalent) {
    throw new AppError('AUTH_FORBIDDEN', 'Not authorized to update this milestone')
  }

  // Role-based status validation
  const talentStatuses = ['in_progress', 'submitted']
  const ownerStatuses = ['approved', 'rejected', 'revision_requested']
  if (isTalent && !isOwner && ownerStatuses.includes(parsed.data.status)) {
    throw new AppError(
      'AUTH_FORBIDDEN',
      'Only the project owner can approve, reject, or request revision',
    )
  }
  if (isOwner && !isTalent && talentStatuses.includes(parsed.data.status)) {
    throw new AppError('AUTH_FORBIDDEN', 'Only the assigned talent can submit or start milestones')
  }

  const service = getService()
  const milestone = await service.updateMilestoneStatus(id, parsed.data.status as MilestoneStatus)

  return c.json({
    success: true,
    data: milestone,
  })
})
