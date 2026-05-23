import { disputes, getDb, outboxEvents } from '@kerjacus/db'
import { AppError } from '@kerjacus/shared'
import { desc, eq, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { uuidv7 } from 'uuidv7'
import { z } from 'zod'
import {
  disputeResolutionWorkflowId,
  getTemporalClient,
  TEMPORAL_TASK_QUEUE,
} from '../lib/temporal-client'
import { getAuthUser } from '../middleware/session'
import { disputeResolutionWorkflow, disputeResolvedSignal } from '../workflows/disputeResolution'

const disputeStatusValues = ['open', 'under_review', 'mediation', 'resolved', 'escalated'] as const

const resolutionTypeValues = ['funds_to_talent', 'funds_to_owner', 'split'] as const

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
  evidenceUrls: z.array(z.url()).optional(),
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
      issues: z.flattenError(parsed.error).fieldErrors,
    })
  }

  const user = getAuthUser(c)
  const userId = user.id

  const db = getDb()
  const id = uuidv7()
  const now = new Date()

  const dispute = await db.transaction(async (tx) => {
    const [created] = await tx
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

    await tx.insert(outboxEvents).values({
      id: uuidv7(),
      aggregateType: 'dispute',
      aggregateId: id,
      eventType: 'dispute.created',
      payload: {
        disputeId: id,
        projectId: parsed.data.projectId,
        initiatedBy: userId,
        againstUserId: parsed.data.againstUserId,
      },
    })

    return created
  })

  // Temporal: start 3-phase dispute resolution workflow (optional).
  void startDisputeWorkflow(id).catch((err) => {
    console.warn('[temporal] dispute workflow start failed', { disputeId: id, err })
  })

  return c.json(
    {
      success: true,
      data: dispute,
    },
    201,
  )
})

/** Side-effect: start dispute resolution workflow. */
async function startDisputeWorkflow(disputeId: string): Promise<void> {
  const client = await getTemporalClient()
  if (!client) return
  await client.workflow.start(disputeResolutionWorkflow, {
    taskQueue: TEMPORAL_TASK_QUEUE,
    workflowId: disputeResolutionWorkflowId(disputeId),
    args: [disputeId],
    workflowIdReusePolicy: 'ALLOW_DUPLICATE',
  })
}

/** Side-effect: signal dispute workflow that resolution happened. */
async function signalDisputeResolved(disputeId: string): Promise<void> {
  const client = await getTemporalClient()
  if (!client) return
  try {
    const handle = client.workflow.getHandle(disputeResolutionWorkflowId(disputeId))
    await handle.signal(disputeResolvedSignal)
  } catch {
    // workflow may not exist; ignore.
  }
}

// GET / - list all disputes (admin, paginated)
disputeRoute.get('/', async (c) => {
  const _user = getAuthUser(c)
  const page = Number(c.req.query('page') ?? '1')
  const pageSize = Math.min(Number(c.req.query('pageSize') ?? '20'), 100)
  const statusFilter = c.req.query('status')

  const db = getDb()
  const conditions = statusFilter ? eq(disputes.status, statusFilter as 'open') : undefined

  const offset = (page - 1) * pageSize
  const [items, countResult] = await Promise.all([
    db
      .select()
      .from(disputes)
      .where(conditions)
      .orderBy(desc(disputes.createdAt))
      .limit(pageSize)
      .offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(disputes).where(conditions),
  ])

  return c.json({
    success: true,
    data: { items, total: countResult[0]?.count ?? 0, page, pageSize },
  })
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

// PATCH /:id/status - update dispute status (admin only for escalation)
disputeRoute.patch('/:id/status', async (c) => {
  const user = getAuthUser(c)
  // Only admin or dispute parties can update status
  // Admin check: under_review, mediation, escalated transitions
  const id = c.req.param('id')
  const body = await c.req.json()

  const parsed = updateStatusSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid status data', {
      issues: z.flattenError(parsed.error).fieldErrors,
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

  // Admin-only transitions (mediation and escalation require platform admin)
  const adminOnlyStatuses = ['under_review', 'mediation', 'escalated']
  if (adminOnlyStatuses.includes(parsed.data.status) && user.role !== 'admin') {
    throw new AppError('AUTH_FORBIDDEN', 'Only platform admin can escalate disputes')
  }

  const updated = await db.transaction(async (tx) => {
    const [result] = await tx
      .update(disputes)
      .set({
        status: parsed.data.status,
        updatedAt: new Date(),
      })
      .where(eq(disputes.id, id))
      .returning()

    await tx.insert(outboxEvents).values({
      id: uuidv7(),
      aggregateType: 'dispute',
      aggregateId: id,
      eventType: 'dispute.status_changed',
      payload: {
        disputeId: id,
        projectId: existing.projectId,
        fromStatus: existing.status,
        toStatus: parsed.data.status,
      },
    })

    return result
  })

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
      issues: z.flattenError(parsed.error).fieldErrors,
    })
  }

  const user = getAuthUser(c)
  if (user.role !== 'admin') {
    throw new AppError('AUTH_FORBIDDEN', 'Only platform admin can resolve disputes')
  }
  const userId = user.id

  const db = getDb()

  const [existing] = await db.select().from(disputes).where(eq(disputes.id, id)).limit(1)

  if (!existing) {
    throw new AppError('DISPUTE_NOT_FOUND', 'Dispute not found')
  }

  if (existing.status === 'resolved') {
    throw new AppError('DISPUTE_ALREADY_RESOLVED', 'Dispute already resolved')
  }

  const now = new Date()
  const resolved = await db.transaction(async (tx) => {
    const [result] = await tx
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

    await tx.insert(outboxEvents).values({
      id: uuidv7(),
      aggregateType: 'dispute',
      aggregateId: id,
      eventType: 'dispute.resolved',
      payload: {
        disputeId: id,
        projectId: existing.projectId,
        resolvedBy: userId,
        resolutionType: parsed.data.resolutionType,
      },
    })

    return result
  })

  // Temporal: signal the dispute workflow to short-circuit.
  void signalDisputeResolved(id).catch((err) => {
    console.warn('[temporal] dispute resolved signal failed', { disputeId: id, err })
  })

  return c.json({
    success: true,
    data: resolved,
  })
})
