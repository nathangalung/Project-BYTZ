import { getDb, projects } from '@kerjacus/db'
import { AppError, paginationSchema } from '@kerjacus/shared'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { uuidv7 } from 'uuidv7'
import { z } from 'zod'
import { getEscrowBalance, refundEscrow } from '../lib/payment-client'
import {
  assertDisputableWorkPackage,
  assertProjectAccess,
  assertProjectParty,
} from '../lib/project-access'
import { isValidTransition } from '../lib/state-machine'
import {
  disputeResolutionWorkflowId,
  getTemporalClient,
  TEMPORAL_TASK_QUEUE,
} from '../lib/temporal-client'
import { getAuthUser } from '../middleware/session'
import { DisputeRepository } from '../repositories/dispute.repository'
import { DisputeService } from '../services/dispute.service'
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

  // Only a party to the project may open a dispute.
  await assertProjectAccess(parsed.data.projectId, userId)

  /**
   * Both remaining ids came from the body on trust, and each decides something
   * the caller should not get to decide.
   *
   * The work package decides whose escrow a resolution refunds, so a talent
   * could scope a dispute to a teammate's package and aim a funds_to_owner
   * outcome at that teammate's money.
   *
   * The respondent decides who counts as a party: DisputeService.changeStatus
   * treats againstUserId as standing, so any user id in the system could be
   * made the respondent on a case they have no connection to.
   */
  if (parsed.data.againstUserId === userId) {
    throw new AppError('VALIDATION_ERROR', 'Cannot open a dispute against yourself')
  }

  await assertProjectParty(
    parsed.data.projectId,
    parsed.data.againstUserId,
    'The user disputed is not a party to this project',
  )

  if (parsed.data.workPackageId) {
    await assertDisputableWorkPackage(parsed.data.projectId, parsed.data.workPackageId, userId)
  }

  // A dispute freezes the project, so it is valid only from a live state
  // (in_progress, partially_active, review, on_hold). The same guard also
  // rejects opening a second dispute on an already-disputed project.
  const [project] = await db
    .select({ status: projects.status })
    .from(projects)
    .where(eq(projects.id, parsed.data.projectId))
    .limit(1)
  if (!project) {
    throw new AppError('NOT_FOUND', 'Project not found')
  }
  const fromStatus = project.status
  if (!isValidTransition(fromStatus, 'disputed')) {
    throw new AppError('CONFLICT', `Cannot open a dispute from status ${fromStatus}`)
  }

  const id = uuidv7()
  const dispute = await new DisputeRepository(db).create({
    id,
    projectId: parsed.data.projectId,
    workPackageId: parsed.data.workPackageId ?? null,
    initiatedBy: userId,
    againstUserId: parsed.data.againstUserId,
    reason: parsed.data.reason,
    evidenceUrls: parsed.data.evidenceUrls ?? null,
    fromStatus,
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
  // Every dispute on the platform, with evidence links and both parties.
  if (getAuthUser(c).role !== 'admin') {
    throw new AppError('AUTH_FORBIDDEN', 'Only platform admin can list all disputes')
  }
  // Math.min clamped the size but nothing clamped the page, and neither
  // rejected a word: Number('abc') is NaN and NaN reached the offset.
  const parsedQuery = paginationSchema.safeParse(c.req.query())
  if (!parsedQuery.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid query parameters', {
      issues: z.flattenError(parsedQuery.error).fieldErrors,
    })
  }
  const { page, pageSize } = parsedQuery.data
  const statusFilter = c.req.query('status')

  const { items, total } = await new DisputeRepository(getDb()).list(statusFilter, {
    page,
    pageSize,
  })

  return c.json({ success: true, data: { items, total, page, pageSize } })
})

// GET /:id - dispute detail
disputeRoute.get('/:id', async (c) => {
  const id = c.req.param('id')
  const user = getAuthUser(c)

  const dispute = await new DisputeRepository(getDb()).findById(id)

  if (!dispute) {
    throw new AppError('DISPUTE_NOT_FOUND', 'Dispute not found')
  }

  // Either party, anyone on the project, or an admin mediating it.
  const isParty = dispute.initiatedBy === user.id || dispute.againstUserId === user.id
  if (!isParty && user.role !== 'admin') {
    await assertProjectAccess(dispute.projectId, user.id)
  }

  return c.json({
    success: true,
    data: dispute,
  })
})

// GET /project/:projectId - disputes for project
disputeRoute.get('/project/:projectId', async (c) => {
  const projectId = c.req.param('projectId')
  const user = getAuthUser(c)
  if (user.role !== 'admin') {
    await assertProjectAccess(projectId, user.id)
  }

  const projectDisputes = await new DisputeRepository(getDb()).findByProject(projectId)

  return c.json({
    success: true,
    data: projectDisputes,
  })
})

// PATCH /:id/status - update dispute status (admin only for escalation)
disputeRoute.patch('/:id/status', async (c) => {
  const user = getAuthUser(c)
  const id = c.req.param('id')
  const body = await c.req.json()

  const parsed = updateStatusSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid status data', {
      issues: z.flattenError(parsed.error).fieldErrors,
    })
  }

  // The transition rules, who may ask, and the admin-only steps live in the
  // service; this handler's job is to say who is asking and with what.
  const service = new DisputeService(new DisputeRepository(getDb()), refundEscrow, getEscrowBalance)
  const updated = await service.changeStatus(
    id,
    { id: user.id, role: user.role },
    parsed.data.status,
    validTransitions,
  )

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

  // Resolving moves money, so it lives in a service where the ordering rule
  // - refund first, mark resolved second - is asserted rather than implied.
  const service = new DisputeService(new DisputeRepository(getDb()), refundEscrow, getEscrowBalance)
  const resolved = await service.resolve(id, userId, {
    resolution: parsed.data.resolution,
    resolutionType: parsed.data.resolutionType,
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
