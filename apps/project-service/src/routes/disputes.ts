import { disputes, getDb } from '@bytz/db'
import { AppError } from '@bytz/shared'
import { desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { uuidv7 } from 'uuidv7'
import { z } from 'zod'

const disputeStatusValues = ['open', 'under_review', 'mediation', 'resolved', 'escalated'] as const

const resolutionTypeValues = ['funds_to_worker', 'funds_to_client', 'split'] as const

// Valid status transitions
const validTransitions: Record<string, string[]> = {
  open: ['under_review', 'resolved'],
  under_review: ['mediation', 'resolved'],
  mediation: ['escalated', 'resolved'],
  escalated: ['resolved'],
}

const createDisputeSchema = z.object({
  projectId: z.string(),
  workPackageId: z.string().optional(),
  againstUserId: z.string(),
  reason: z.string().min(10).max(5000),
  evidenceUrls: z.array(z.string().url()).optional(),
})

const updateStatusSchema = z.object({
  status: z.enum(disputeStatusValues),
})

const resolveDisputeSchema = z.object({
  resolution: z.string().min(10).max(5000),
  resolutionType: z.enum(resolutionTypeValues),
})

export const disputeRoute = new Hono()

// POST / - create dispute
disputeRoute.post('/', async (c) => {
  const body = await c.req.json()

  const parsed = createDisputeSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid dispute data', {
      issues: parsed.error.flatten().fieldErrors,
    })
  }

  const userId = c.req.header('X-User-ID')
  if (!userId) {
    throw new AppError('AUTH_UNAUTHORIZED', 'User ID is required')
  }

  const db = getDb()
  const id = uuidv7()
  const now = new Date()

  const [dispute] = await db
    .insert(disputes)
    .values({
      id,
      projectId: parsed.data.projectId,
      workPackageId: parsed.data.workPackageId ?? null,
      initiatedBy: userId,
      againstUserId: parsed.data.againstUserId,
      reason: parsed.data.reason,
      evidenceUrls: parsed.data.evidenceUrls ?? null,
      status: 'open',
      createdAt: now,
      updatedAt: now,
    })
    .returning()

  return c.json(
    {
      success: true,
      data: dispute,
    },
    201,
  )
})

// GET /:id - dispute detail
disputeRoute.get('/:id', async (c) => {
  const id = c.req.param('id')
  const db = getDb()

  const [dispute] = await db.select().from(disputes).where(eq(disputes.id, id)).limit(1)

  if (!dispute) {
    throw new AppError('DISPUTE_NOT_FOUND', 'Dispute not found')
  }

  return c.json({
    success: true,
    data: dispute,
  })
})

// GET /project/:projectId - disputes for project
disputeRoute.get('/project/:projectId', async (c) => {
  const projectId = c.req.param('projectId')
  const db = getDb()

  const projectDisputes = await db
    .select()
    .from(disputes)
    .where(eq(disputes.projectId, projectId))
    .orderBy(desc(disputes.createdAt))

  return c.json({
    success: true,
    data: projectDisputes,
  })
})

// PATCH /:id/status - update dispute status
disputeRoute.patch('/:id/status', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()

  const parsed = updateStatusSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid status data', {
      issues: parsed.error.flatten().fieldErrors,
    })
  }

  const db = getDb()

  const [existing] = await db.select().from(disputes).where(eq(disputes.id, id)).limit(1)

  if (!existing) {
    throw new AppError('DISPUTE_NOT_FOUND', 'Dispute not found')
  }

  if (existing.status === 'resolved') {
    throw new AppError('DISPUTE_ALREADY_RESOLVED', 'Dispute already resolved')
  }

  // Validate transition
  const allowed = validTransitions[existing.status]
  if (!allowed || !allowed.includes(parsed.data.status)) {
    throw new AppError(
      'DISPUTE_INVALID_STATUS',
      `Cannot transition from ${existing.status} to ${parsed.data.status}`,
    )
  }

  const [updated] = await db
    .update(disputes)
    .set({
      status: parsed.data.status,
      updatedAt: new Date(),
    })
    .where(eq(disputes.id, id))
    .returning()

  return c.json({
    success: true,
    data: updated,
  })
})

// PATCH /:id/resolve - resolve dispute
disputeRoute.patch('/:id/resolve', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()

  const parsed = resolveDisputeSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid resolution data', {
      issues: parsed.error.flatten().fieldErrors,
    })
  }

  const userId = c.req.header('X-User-ID')
  if (!userId) {
    throw new AppError('AUTH_UNAUTHORIZED', 'User ID is required')
  }

  const db = getDb()

  const [existing] = await db.select().from(disputes).where(eq(disputes.id, id)).limit(1)

  if (!existing) {
    throw new AppError('DISPUTE_NOT_FOUND', 'Dispute not found')
  }

  if (existing.status === 'resolved') {
    throw new AppError('DISPUTE_ALREADY_RESOLVED', 'Dispute already resolved')
  }

  const now = new Date()
  const [resolved] = await db
    .update(disputes)
    .set({
      status: 'resolved',
      resolution: parsed.data.resolution,
      resolutionType: parsed.data.resolutionType,
      resolvedBy: userId,
      resolvedAt: now,
      updatedAt: now,
    })
    .where(eq(disputes.id, id))
    .returning()

  return c.json({
    success: true,
    data: resolved,
  })
})
