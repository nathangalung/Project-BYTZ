import {
  brdDocuments,
  chatConversations,
  chatMessages,
  getDb,
  prdDocuments,
  projectAssignments,
  projects as projectsTable,
  talentProfiles,
  transactions,
} from '@kerjacus/db'
import {
  AppError,
  createProjectSchema,
  FREE_BRD_GENERATIONS,
  FREE_PRD_GENERATIONS,
  MAX_TEAM_SIZE,
  normalizePrdContent,
  type ProjectCategory,
  type ProjectStatus,
} from '@kerjacus/shared'
import { and, desc, eq, inArray, isNull, type SQL, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { uuidv7 } from 'uuidv7'
import { z } from 'zod'
import { brdLanguage, normalizeBrdContent, renderBrdPdf } from '../lib/brd-pdf'
import { isDocumentPaid } from '../lib/document-entitlement'
import {
  generateBrdContent,
  generatePrdContent,
  priceBrd,
  pricePrd,
} from '../lib/document-generation'
import { env } from '../lib/env'
import { appendOutboxEvent } from '../lib/outbox'
import { prdLanguage, renderPrdPdf } from '../lib/prd-pdf'
import { isAssignedTalent } from '../lib/project-access'
import { buildScopingSystemPrompt, computeFormCompletenessFloor } from '../lib/scoping-context'
import { withServiceAuth } from '../lib/service-auth'
import {
  getTemporalClient,
  TEMPORAL_TASK_QUEUE,
  teamFormationWorkflowId,
} from '../lib/temporal-client'
import { applyProjectVisibility, gateProjectPrd, redactBrd } from '../lib/visibility'
import { getAuthUser, getOptionalUser } from '../middleware/session'
import { ProjectRepository } from '../repositories/project.repository'
import { ProjectService } from '../services/project.service'
import { teamCompleteSignal, teamFormationWorkflow } from '../workflows/teamFormation'

const projectStatusValues = [
  'draft',
  'scoping',
  'brd_generated',
  'brd_approved',
  'brd_purchased',
  'prd_generated',
  'prd_approved',
  'prd_purchased',
  'matching',
  'team_forming',
  'matched',
  'in_progress',
  'partially_active',
  'review',
  'completed',
  'cancelled',
  'disputed',
  'on_hold',
] as const

const projectCategoryValues = [
  'web_app',
  'mobile_app',
  'ui_ux_design',
  'data_ai',
  'other_digital',
] as const

// Query schemas
const listQuerySchema = z.object({
  status: z.enum(projectStatusValues).optional(),
  category: z.enum(projectCategoryValues).optional(),
  ownerId: z.uuid().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
})

const transitionBodySchema = z.object({
  status: z.enum(projectStatusValues),
  reason: z.string().max(1000).optional(),
})

const updateProjectSchema = z.object({
  title: z.string().min(3).max(200).optional(),
  description: z.string().min(10).max(5000).optional(),
  category: z.enum(projectCategoryValues).optional(),
  budgetMin: z.number().int().nonnegative().optional(),
  budgetMax: z.number().int().nonnegative().optional(),
  estimatedTimelineDays: z.number().int().positive().optional(),
  preferences: z
    .object({
      almamater: z.string().optional(),
      minExperience: z.number().int().nonnegative().optional(),
      requiredSkills: z.array(z.string()).optional(),
    })
    .optional(),
  // Owners must be able to change visibility after creation, otherwise a project
  // is stuck on whatever it was created with.
  visibility: z.enum(['private', 'public_summary', 'public_detail']).optional(),
})

function getService(): ProjectService {
  const db = getDb()
  const repo = new ProjectRepository(db)
  return new ProjectService(repo)
}

// The owner picks the document language at generation; default Indonesian.
function pickDocLanguage(body: unknown): 'id' | 'en' {
  return (body as { language?: string } | null)?.language === 'en' ? 'en' : 'id'
}

export const projectsRoute = new Hono()

// GET /projects/stats — public platform stats
projectsRoute.get('/stats', async (c) => {
  const db = getDb()
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(projectsTable)
  const [{ completed }] = await db
    .select({ completed: sql<number>`count(*)::int` })
    .from(projectsTable)
    .where(eq(projectsTable.status, 'completed'))
  const [{ active }] = await db
    .select({ active: sql<number>`count(*)::int` })
    .from(projectsTable)
    .where(inArray(projectsTable.status, ['in_progress', 'review']))

  return c.json({ success: true, data: { total, completed, active } })
})

// GET /projects/public — unauthenticated browsing
projectsRoute.get('/public', async (c) => {
  const page = Number(c.req.query('page') ?? 1)
  const pageSize = Number(c.req.query('pageSize') ?? 12)
  const category = c.req.query('category')
  const db = getDb()

  // Show projects that owner marked as public (summary or detail)
  const conditions: SQL[] = [
    inArray(projectsTable.visibility, ['public_summary', 'public_detail']),
    isNull(projectsTable.deletedAt),
  ]
  if (category) {
    conditions.push(
      eq(projectsTable.category, category as (typeof projectsTable.category.enumValues)[number]),
    )
  }

  const where = and(...conditions)
  const items = await db
    .select({
      id: projectsTable.id,
      title: projectsTable.title,
      description: projectsTable.description,
      category: projectsTable.category,
      status: projectsTable.status,
      budgetMin: projectsTable.budgetMin,
      budgetMax: projectsTable.budgetMax,
      estimatedTimelineDays: projectsTable.estimatedTimelineDays,
      teamSize: projectsTable.teamSize,
      visibility: projectsTable.visibility,
      preferences: projectsTable.preferences,
      createdAt: projectsTable.createdAt,
    })
    .from(projectsTable)
    .where(where)
    .orderBy(desc(projectsTable.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize)

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(projectsTable)
    .where(where)

  // Shared gate, so this route and /:id cannot drift apart.
  const publicItems = items.map((item) => applyProjectVisibility(item, null))

  return c.json({ success: true, data: { items: publicItems, total: count, page, pageSize } })
})

// GET /projects/available — talent discovery
projectsRoute.get('/available', async (c) => {
  const querySchema = z.object({
    category: z.enum(projectCategoryValues).optional(),
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().positive().max(100).default(20),
  })

  const parsed = querySchema.safeParse(c.req.query())
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid query parameters', {
      issues: z.flattenError(parsed.error).fieldErrors,
    })
  }

  const { category, page, pageSize } = parsed.data
  const offset = (page - 1) * pageSize
  const db = getDb()

  // This route answers without a session, so a project the owner
  // marked private must not appear here either.
  const conditions: SQL[] = [
    isNull(projectsTable.deletedAt),
    inArray(projectsTable.status, ['matching', 'team_forming']),
    inArray(projectsTable.visibility, ['public_summary', 'public_detail']),
  ]

  if (category) {
    conditions.push(eq(projectsTable.category, category))
  }

  const whereClause = and(...conditions)

  const [items, countResult] = await Promise.all([
    db
      .select({
        id: projectsTable.id,
        title: projectsTable.title,
        description: projectsTable.description,
        category: projectsTable.category,
        status: projectsTable.status,
        budgetMin: projectsTable.budgetMin,
        budgetMax: projectsTable.budgetMax,
        estimatedTimelineDays: projectsTable.estimatedTimelineDays,
        teamSize: projectsTable.teamSize,
        visibility: projectsTable.visibility,
        preferences: projectsTable.preferences,
        createdAt: projectsTable.createdAt,
      })
      .from(projectsTable)
      .where(whereClause)
      .orderBy(desc(projectsTable.createdAt))
      .limit(pageSize)
      .offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(projectsTable).where(whereClause),
  ])

  return c.json({
    success: true,
    data: {
      items: items.map((item) => applyProjectVisibility(item, null)),
      total: countResult[0]?.count ?? 0,
      page,
      pageSize,
    },
  })
})

// GET /projects - list with filters
projectsRoute.get('/', async (c) => {
  const parsed = listQuerySchema.safeParse(c.req.query())
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid query parameters', {
      issues: z.flattenError(parsed.error).fieldErrors,
    })
  }

  const { status, category, ownerId, page, pageSize } = parsed.data
  const service = getService()

  const viewerId = getAuthUser(c).id

  const result = await service.listProjects(
    {
      status: status as ProjectStatus | undefined,
      category: category as ProjectCategory | undefined,
      ownerId,
      viewerId,
    },
    { page, pageSize },
  )

  return c.json({
    success: true,
    data: {
      // Redacts money columns, private already filtered
      items: result.items.map((p) => applyProjectVisibility(p, viewerId)),
      total: result.total,
      page,
      pageSize,
    },
  })
})

// GET /projects/:id - get by ID
projectsRoute.get('/:id', async (c) => {
  const id = c.req.param('id')
  const service = getService()

  const project = await service.getProject(id)

  // Throws NOT_FOUND for a private project the caller neither owns nor works
  // on, and strips the internal money columns for every non-owner.
  const viewerId = getOptionalUser(c)?.id ?? null
  const participant =
    viewerId !== null && viewerId !== project.ownerId && (await isAssignedTalent(id, viewerId))
  const visible = applyProjectVisibility(project, viewerId, participant)

  // Redact BRD content if not paid/approved
  const db = getDb()
  const [brd] = await db.select().from(brdDocuments).where(eq(brdDocuments.projectId, id)).limit(1)
  const brdData = brd ? redactBrd(brd) : null

  // Owner and assigned talents only; the PRD carries pricing.
  const [prd] = await db.select().from(prdDocuments).where(eq(prdDocuments.projectId, id)).limit(1)
  const prdData = gateProjectPrd(prd, viewerId, project.ownerId, participant)

  return c.json({ success: true, data: { ...visible, brd: brdData, prd: prdData } })
})

// GET /projects/:id/brd
projectsRoute.get('/:id/brd', async (c) => {
  const projectId = c.req.param('id')
  const user = getAuthUser(c)
  const db = getDb()

  // Verify ownership
  const [project] = await db
    .select({ ownerId: projectsTable.ownerId })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1)
  if (!project || project.ownerId !== user.id) {
    throw new AppError('AUTH_FORBIDDEN', 'Only the project owner can view BRD')
  }

  const [brd] = await db
    .select()
    .from(brdDocuments)
    .where(eq(brdDocuments.projectId, projectId))
    .limit(1)

  if (!brd) {
    return c.json({ success: true, data: null })
  }

  // Owner-only, but still gated: unpaid BRD is a preview, not the deliverable.
  return c.json({ success: true, data: redactBrd(brd) })
})

// GET /projects/:id/brd/pdf - clean PDF, owner only, once paid or approved.
projectsRoute.get('/:id/brd/pdf', async (c) => {
  const projectId = c.req.param('id')
  const user = getAuthUser(c)
  const db = getDb()

  const [project] = await db
    .select({ ownerId: projectsTable.ownerId, title: projectsTable.title })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1)
  if (!project || project.ownerId !== user.id) {
    throw new AppError('AUTH_FORBIDDEN', 'Only the project owner can download the BRD')
  }

  const [brd] = await db
    .select()
    .from(brdDocuments)
    .where(eq(brdDocuments.projectId, projectId))
    .limit(1)
  if (!brd) {
    throw new AppError('NOT_FOUND', 'BRD not found')
  }

  // The clean PDF is the paid deliverable; the app preview is watermarked.
  if (!(await isDocumentPaid(projectId, 'brd', brd.paidAt))) {
    throw new AppError('DOCUMENT_NOT_PAID', 'Pay for the BRD to download it')
  }

  const raw = (brd.content ?? {}) as Record<string, unknown>
  const language = brdLanguage(raw)
  const generatedAt = new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(brd.updatedAt)

  const pdf = await renderBrdPdf({
    projectTitle: project.title,
    content: normalizeBrdContent(raw),
    language,
    generatedAt,
    version: brd.version,
  })

  c.header('Content-Type', 'application/pdf')
  c.header('Content-Disposition', `attachment; filename="BRD-${projectId}.pdf"`)
  return c.body(pdf as unknown as ArrayBuffer)
})

// GET /projects/:id/prd
projectsRoute.get('/:id/prd', async (c) => {
  const projectId = c.req.param('id')
  const user = getAuthUser(c)
  const db = getDb()

  const [project] = await db
    .select({ ownerId: projectsTable.ownerId })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1)
  if (!project) {
    throw new AppError('NOT_FOUND', 'Project not found')
  }

  // The PRD is the talent's brief once assigned, so an assigned talent reads it
  // too, matching the participant gate on GET /:id.
  const isOwner = project.ownerId === user.id
  if (!isOwner && !(await isAssignedTalent(projectId, user.id))) {
    throw new AppError('AUTH_FORBIDDEN', 'Only the owner or an assigned talent can view PRD')
  }

  const [prd] = await db
    .select()
    .from(prdDocuments)
    .where(eq(prdDocuments.projectId, projectId))
    .limit(1)

  return c.json({ success: true, data: prd ?? null })
})

// GET /projects/:id/prd/pdf - clean PDF, owner only, once paid or approved.
projectsRoute.get('/:id/prd/pdf', async (c) => {
  const projectId = c.req.param('id')
  const user = getAuthUser(c)
  const db = getDb()

  const [project] = await db
    .select({ ownerId: projectsTable.ownerId, title: projectsTable.title })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1)
  if (!project || project.ownerId !== user.id) {
    throw new AppError('AUTH_FORBIDDEN', 'Only the project owner can download the PRD')
  }

  const [prd] = await db
    .select()
    .from(prdDocuments)
    .where(eq(prdDocuments.projectId, projectId))
    .limit(1)
  if (!prd) {
    throw new AppError('NOT_FOUND', 'PRD not found')
  }

  // The clean PDF is the paid deliverable; the app preview is watermarked.
  if (!(await isDocumentPaid(projectId, 'prd', prd.paidAt))) {
    throw new AppError('DOCUMENT_NOT_PAID', 'Pay for the PRD to download it')
  }

  const raw = (prd.content ?? {}) as Record<string, unknown>
  const language = prdLanguage(raw)
  const generatedAt = new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(prd.updatedAt)

  const pdf = await renderPrdPdf({
    projectTitle: project.title,
    content: normalizePrdContent(raw),
    language,
    generatedAt,
    version: prd.version,
  })

  c.header('Content-Type', 'application/pdf')
  c.header('Content-Disposition', `attachment; filename="PRD-${projectId}.pdf"`)
  return c.body(pdf as unknown as ArrayBuffer)
})

// GET /projects/:id/tasks — Gantt chart data (tasks + dependencies)
projectsRoute.get('/:id/tasks', async (c) => {
  const projectId = c.req.param('id')
  const user = getAuthUser(c)
  const db = getDb()

  // Verify access: owner OR assigned talent on this project
  const [project] = await db
    .select({ ownerId: projectsTable.ownerId })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1)

  if (!project) {
    throw new AppError('NOT_FOUND', 'Project not found')
  }

  let allowed = project.ownerId === user.id
  if (!allowed) {
    // Check if user is an assigned talent
    const [talent] = await db
      .select({ talentProfileId: talentProfiles.id })
      .from(talentProfiles)
      .where(eq(talentProfiles.userId, user.id))
      .limit(1)

    if (talent) {
      const [assignment] = await db
        .select({ id: projectAssignments.id })
        .from(projectAssignments)
        .where(
          and(
            eq(projectAssignments.projectId, projectId),
            eq(projectAssignments.talentId, talent.talentProfileId),
          ),
        )
        .limit(1)
      allowed = !!assignment
    }
  }

  if (!allowed) {
    throw new AppError('AUTH_FORBIDDEN', 'Not authorized to view project tasks')
  }

  const repo = new ProjectRepository(db)
  const { tasks: taskRows, dependencies } = await repo.getProjectTasksWithDependencies(projectId)

  return c.json({ success: true, data: { tasks: taskRows, dependencies } })
})

// POST /projects - create
projectsRoute.post('/', async (c) => {
  const body = await c.req.json()

  const parsed = createProjectSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid project data', {
      issues: z.flattenError(parsed.error).fieldErrors,
    })
  }

  const user = getAuthUser(c)
  const ownerId = user.id

  const service = getService()
  const project = await service.createProject(ownerId, parsed.data)

  return c.json(
    {
      success: true,
      data: project,
    },
    201,
  )
})

// PATCH /projects/:id - update
projectsRoute.patch('/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()

  const parsed = updateProjectSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid update data', {
      issues: z.flattenError(parsed.error).fieldErrors,
    })
  }

  const user = getAuthUser(c)
  const userId = user.id

  // Verify project ownership
  const db = getDb()
  const [ownedProject] = await db
    .select({ ownerId: projectsTable.ownerId })
    .from(projectsTable)
    .where(eq(projectsTable.id, id))
    .limit(1)
  if (!ownedProject || ownedProject.ownerId !== user.id) {
    throw new AppError('AUTH_FORBIDDEN', 'Only the project owner can update this project')
  }

  const service = getService()
  const project = await service.updateProject(id, userId, parsed.data)

  return c.json({
    success: true,
    data: project,
  })
})

// POST /projects/:id/transition - transition status
projectsRoute.post('/:id/transition', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()

  const parsed = transitionBodySchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid transition data', {
      issues: z.flattenError(parsed.error).fieldErrors,
    })
  }

  const user = getAuthUser(c)
  const userId = user.id

  // Verify project ownership for non-system transitions
  const db = getDb()
  const [ownedProject] = await db
    .select({
      ownerId: projectsTable.ownerId,
      status: projectsTable.status,
      teamSize: projectsTable.teamSize,
    })
    .from(projectsTable)
    .where(eq(projectsTable.id, id))
    .limit(1)
  if (!ownedProject || ownedProject.ownerId !== user.id) {
    throw new AppError('AUTH_FORBIDDEN', 'Only the project owner can transition this project')
  }

  // Team projects must go through team_forming before matched
  if (
    parsed.data.status === 'matched' &&
    ownedProject.status === 'matching' &&
    (ownedProject.teamSize ?? 1) > 1
  ) {
    throw new AppError(
      'VALIDATION_ERROR',
      'Team projects must go through team_forming before matched',
    )
  }

  const service = getService()
  const project = await service.transitionStatus(
    id,
    parsed.data.status as ProjectStatus,
    userId,
    parsed.data.reason,
  )

  // Embedding request via outbox. ai-service consumes ai.{brd,prd}.embed_requested
  // and writes vectors back. Outbox guarantees the event survives a crash here.
  if (parsed.data.status === 'brd_approved' || parsed.data.status === 'prd_approved') {
    const docType = parsed.data.status === 'brd_approved' ? 'brd' : 'prd'
    await enqueueEmbeddingRequest(id, docType)
  }

  // Temporal: start team formation workflow when entering team_forming.
  if (parsed.data.status === 'team_forming' && (ownedProject.teamSize ?? 1) > 1) {
    void startTeamFormationWorkflow(id).catch((err) => {
      console.warn('[temporal] team formation workflow start failed', { projectId: id, err })
    })
  }

  // Temporal: signal team completion when entering matched.
  if (parsed.data.status === 'matched' && (ownedProject.teamSize ?? 1) > 1) {
    void signalTeamComplete(id).catch((err) => {
      console.warn('[temporal] team complete signal failed', { projectId: id, err })
    })
  }

  return c.json({
    success: true,
    data: project,
  })
})

/** Side-effect: start team formation workflow. */
async function startTeamFormationWorkflow(projectId: string): Promise<void> {
  const client = await getTemporalClient()
  if (!client) return
  await client.workflow.start(teamFormationWorkflow, {
    taskQueue: TEMPORAL_TASK_QUEUE,
    workflowId: teamFormationWorkflowId(projectId),
    args: [projectId],
    workflowIdReusePolicy: 'ALLOW_DUPLICATE',
  })
}

/** Side-effect: signal team formation workflow that team is complete. */
async function signalTeamComplete(projectId: string): Promise<void> {
  const client = await getTemporalClient()
  if (!client) return
  try {
    const handle = client.workflow.getHandle(teamFormationWorkflowId(projectId))
    await handle.signal(teamCompleteSignal)
  } catch {
    // workflow may not exist; ignore.
  }
}

/**
 * Enqueue an embedding request for the latest BRD/PRD revision. Resolves once
 * the outbox row commits, so callers can rely on it being durable before they
 * respond. The actual embedding work is done by ai-service when it consumes
 * `ai.{brd,prd}.embed_requested`.
 */
async function enqueueEmbeddingRequest(projectId: string, docType: 'brd' | 'prd'): Promise<void> {
  const db = getDb()
  const docsTable = docType === 'brd' ? brdDocuments : prdDocuments
  const [doc] = await db
    .select({ id: docsTable.id, content: docsTable.content })
    .from(docsTable)
    .where(eq(docsTable.projectId, projectId))
    .orderBy(desc(docsTable.version))
    .limit(1)
  if (!doc) return

  await appendOutboxEvent(db, {
    aggregateType: docType === 'brd' ? 'brd_document' : 'prd_document',
    aggregateId: doc.id,
    eventType: docType === 'brd' ? 'ai.brd.embed_requested' : 'ai.prd.embed_requested',
    payload: {
      projectId,
      documentId: doc.id,
      documentType: docType,
      content: doc.content,
    },
  })
}

// GET /projects/:id/scoping-status - initial completeness from form data
projectsRoute.get('/:id/scoping-status', async (c) => {
  const projectId = c.req.param('id')
  const user = getAuthUser(c)
  const db = getDb()

  const [project] = await db
    .select({
      ownerId: projectsTable.ownerId,
      title: projectsTable.title,
      description: projectsTable.description,
      category: projectsTable.category,
      budgetMin: projectsTable.budgetMin,
      budgetMax: projectsTable.budgetMax,
      estimatedTimelineDays: projectsTable.estimatedTimelineDays,
      preferences: projectsTable.preferences,
    })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1)

  if (!project) {
    throw new AppError('PROJECT_NOT_FOUND', 'Project not found')
  }
  if (project.ownerId !== user.id) {
    throw new AppError('AUTH_FORBIDDEN', 'Only the project owner can view scoping status')
  }

  const formFloor = computeFormCompletenessFloor(project)
  return c.json({
    success: true,
    data: { formFloor, suggestGenerateBrd: formFloor >= 80 },
  })
})

// POST /projects/:id/chat - scoping chat with AI
projectsRoute.post('/:id/chat', async (c) => {
  const projectId = c.req.param('id')

  const user = getAuthUser(c)
  const userId = user.id

  const db = getDb()
  const [project] = await db
    .select({
      ownerId: projectsTable.ownerId,
      title: projectsTable.title,
      description: projectsTable.description,
      category: projectsTable.category,
      budgetMin: projectsTable.budgetMin,
      budgetMax: projectsTable.budgetMax,
      estimatedTimelineDays: projectsTable.estimatedTimelineDays,
      preferences: projectsTable.preferences,
    })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1)
  if (!project) {
    throw new AppError('PROJECT_NOT_FOUND', 'Project not found')
  }
  if (project.ownerId !== userId) {
    throw new AppError('AUTH_FORBIDDEN', 'Only the project owner can use scoping chat')
  }

  const body = await c.req.json()
  const content = body?.content ?? ''

  if (!content.trim()) {
    throw new AppError('VALIDATION_ERROR', 'Message content is required')
  }

  let [conversation] = await db
    .select()
    .from(chatConversations)
    .where(
      and(eq(chatConversations.projectId, projectId), eq(chatConversations.type, 'ai_scoping')),
    )
    .limit(1)

  if (!conversation) {
    ;[conversation] = await db
      .insert(chatConversations)
      .values({ id: uuidv7(), projectId, type: 'ai_scoping', createdAt: new Date() })
      .returning()
  }

  await db.insert(chatMessages).values({
    id: uuidv7(),
    conversationId: conversation.id,
    senderType: 'user',
    content: content.trim(),
    createdAt: new Date(),
  })

  const allMessages = await db
    .select({ senderType: chatMessages.senderType, content: chatMessages.content })
    .from(chatMessages)
    .where(eq(chatMessages.conversationId, conversation.id))
    .orderBy(chatMessages.createdAt)

  const formFloor = computeFormCompletenessFloor(project)
  const systemPrompt = buildScopingSystemPrompt(project)
  const payloadMessages = [
    { role: 'system' as const, content: systemPrompt },
    ...allMessages.map((m) => ({
      role: (m.senderType === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: m.content,
    })),
  ]

  const aiUrl = env.AI_SERVICE_URL
  const aiRes = await fetch(`${aiUrl}/api/v1/ai/chat`, {
    method: 'POST',
    headers: withServiceAuth({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ project_id: projectId, messages: payloadMessages }),
  })

  if (!aiRes.ok) {
    const detail = await aiRes.text().catch(() => '')
    throw new AppError(
      'AI_SERVICE_UNAVAILABLE',
      `AI service responded ${aiRes.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`,
    )
  }

  const aiData = (await aiRes.json()) as Record<string, unknown>
  const aiContent =
    ((aiData.message as Record<string, string>)?.content ??
      ((aiData.data as Record<string, unknown>)?.message as Record<string, string>)?.content) ||
    ''
  const aiScore =
    (aiData as Record<string, number>).completeness_score ??
    (aiData.data as Record<string, number>)?.completeness_score ??
    0
  const completeness = Math.max(formFloor, typeof aiScore === 'number' ? aiScore : 0)

  if (!aiContent) {
    throw new AppError('AI_INVALID_RESPONSE', 'AI service returned empty content')
  }

  await db.insert(chatMessages).values({
    id: uuidv7(),
    conversationId: conversation.id,
    senderType: 'ai',
    content: aiContent,
    createdAt: new Date(),
  })

  return c.json({
    success: true,
    data: {
      message: aiContent,
      completeness,
      suggestGenerateBrd: completeness >= 80,
    },
  })
})

// POST /projects/:id/chat/stream - SSE streaming scoping chat
projectsRoute.post('/:id/chat/stream', async (c) => {
  const projectId = c.req.param('id')
  const user = getAuthUser(c)
  const userId = user.id

  const db = getDb()
  const [project] = await db
    .select({
      ownerId: projectsTable.ownerId,
      title: projectsTable.title,
      description: projectsTable.description,
      category: projectsTable.category,
      budgetMin: projectsTable.budgetMin,
      budgetMax: projectsTable.budgetMax,
      estimatedTimelineDays: projectsTable.estimatedTimelineDays,
      preferences: projectsTable.preferences,
    })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1)
  if (!project) {
    throw new AppError('PROJECT_NOT_FOUND', 'Project not found')
  }
  if (project.ownerId !== userId) {
    throw new AppError('AUTH_FORBIDDEN', 'Only the project owner can use scoping chat')
  }

  const body = await c.req.json()
  const content = String(body?.content ?? '').trim()
  if (!content) {
    throw new AppError('VALIDATION_ERROR', 'Message content is required')
  }

  let [conversation] = await db
    .select()
    .from(chatConversations)
    .where(
      and(eq(chatConversations.projectId, projectId), eq(chatConversations.type, 'ai_scoping')),
    )
    .limit(1)

  if (!conversation) {
    ;[conversation] = await db
      .insert(chatConversations)
      .values({ id: uuidv7(), projectId, type: 'ai_scoping', createdAt: new Date() })
      .returning()
  }

  await db.insert(chatMessages).values({
    id: uuidv7(),
    conversationId: conversation.id,
    senderType: 'user',
    content,
    createdAt: new Date(),
  })

  const allMessages = await db
    .select({ senderType: chatMessages.senderType, content: chatMessages.content })
    .from(chatMessages)
    .where(eq(chatMessages.conversationId, conversation.id))
    .orderBy(chatMessages.createdAt)

  const formFloor = computeFormCompletenessFloor(project)
  const systemPrompt = buildScopingSystemPrompt(project)
  const payloadMessages = [
    { role: 'system' as const, content: systemPrompt },
    ...allMessages.map((m) => ({
      role: (m.senderType === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: m.content,
    })),
  ]

  const aiUrl = env.AI_SERVICE_URL
  const conversationId = conversation.id

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder()
      const decoder = new TextDecoder()
      const emit = (obj: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`))

      let fullText = ''
      let aiScore = 0
      let upstreamFailed = false

      try {
        const upstream = await fetch(`${aiUrl}/api/v1/ai/chat/stream`, {
          method: 'POST',
          headers: withServiceAuth({
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
          }),
          body: JSON.stringify({
            project_id: projectId,
            messages: payloadMessages,
          }),
        })

        if (!upstream.ok || !upstream.body) {
          upstreamFailed = true
          const detail = await upstream.text().catch(() => '')
          emit({
            type: 'error',
            message: `AI service ${upstream.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`,
          })
        } else {
          const reader = upstream.body.getReader()
          let buffer = ''
          while (true) {
            const { value, done } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            const frames = buffer.split('\n\n')
            buffer = frames.pop() ?? ''
            for (const frame of frames) {
              const line = frame.trim()
              if (!line.startsWith('data:')) continue
              const payload = line.slice(5).trim()
              if (!payload) continue
              try {
                const event = JSON.parse(payload) as {
                  type: string
                  delta?: string
                  full_text?: string
                  completeness_score?: number
                  suggest_generate_brd?: boolean
                  message?: string
                }
                if (event.type === 'token' && event.delta) {
                  fullText += event.delta
                  emit({ type: 'token', delta: event.delta })
                } else if (event.type === 'done') {
                  if (typeof event.full_text === 'string' && event.full_text) {
                    fullText = event.full_text
                  }
                  if (typeof event.completeness_score === 'number') {
                    aiScore = event.completeness_score
                  }
                } else if (event.type === 'error') {
                  upstreamFailed = true
                  emit({ type: 'error', message: event.message ?? 'upstream error' })
                }
              } catch {
                // ignore malformed frame
              }
            }
          }
        }
      } catch (err) {
        upstreamFailed = true
        emit({ type: 'error', message: err instanceof Error ? err.message : 'stream failed' })
      }

      if (fullText) {
        try {
          await db.insert(chatMessages).values({
            id: uuidv7(),
            conversationId,
            senderType: 'ai',
            content: fullText,
            createdAt: new Date(),
          })
        } catch (err) {
          emit({ type: 'error', message: err instanceof Error ? err.message : 'persist failed' })
        }
        const completeness = Math.max(formFloor, aiScore)
        emit({
          type: 'done',
          message: fullText,
          completeness,
          suggestGenerateBrd: completeness >= 80,
        })
      } else if (!upstreamFailed) {
        emit({ type: 'error', message: 'AI service returned empty content' })
      }
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
})

// POST /projects/:id/upload-spec - upload existing specification for BRD generation
const uploadSpecSchema = z.object({
  fileUrl: z.url(),
  fileType: z.enum(['pdf', 'docx', 'pptx', 'txt']),
  notes: z.string().max(2000).optional(),
})

projectsRoute.post('/:id/upload-spec', async (c) => {
  const user = getAuthUser(c)
  const projectId = c.req.param('id')
  const body = await c.req.json()

  const parsed = uploadSpecSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid upload data', {
      issues: z.flattenError(parsed.error).fieldErrors,
    })
  }

  // Verify ownership
  const db = getDb()
  const [project] = await db
    .select({ ownerId: projectsTable.ownerId, status: projectsTable.status })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1)
  if (!project || project.ownerId !== user.id) {
    throw new AppError('AUTH_FORBIDDEN', 'Only the project owner can upload specs')
  }

  // Only allow in draft or scoping status
  if (!['draft', 'scoping'].includes(project.status)) {
    throw new AppError('VALIDATION_ERROR', 'Can only upload spec in draft or scoping status')
  }

  // Send to AI service for parsing
  const aiUrl = env.AI_SERVICE_URL
  try {
    const aiRes = await fetch(`${aiUrl}/api/v1/ai/parse-spec`, {
      method: 'POST',
      headers: withServiceAuth({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        file_url: parsed.data.fileUrl,
        file_type: parsed.data.fileType,
        notes: parsed.data.notes,
      }),
      signal: AbortSignal.timeout(60000),
    })

    if (aiRes.ok) {
      const aiData = (await aiRes.json()) as Record<string, unknown>
      const data = (aiData.data ?? {}) as Record<string, unknown>

      // Create or find scoping conversation
      let conversationId: string
      const [existing] = await db
        .select({ id: chatConversations.id })
        .from(chatConversations)
        .where(
          and(eq(chatConversations.projectId, projectId), eq(chatConversations.type, 'ai_scoping')),
        )
        .limit(1)

      if (existing) {
        conversationId = existing.id
      } else {
        conversationId = uuidv7()
        await db.insert(chatConversations).values({
          id: conversationId,
          projectId,
          type: 'ai_scoping',
          createdAt: new Date(),
        })
      }

      // Add system message with extracted spec content
      const specSummary = (data.summary as string) ?? 'Specification document uploaded and parsed.'
      await db.insert(chatMessages).values({
        id: uuidv7(),
        conversationId,
        senderType: 'system',
        content: `[Uploaded specification: ${parsed.data.fileType.toUpperCase()}]\n\n${specSummary}`,
        metadata: {
          fileUrl: parsed.data.fileUrl,
          fileType: parsed.data.fileType,
          parsedData: data,
        },
        createdAt: new Date(),
      })

      // Transition to scoping if still draft
      if (project.status === 'draft') {
        const service = getService()
        await service.transitionStatus(
          projectId,
          'scoping' as ProjectStatus,
          user.id,
          'Spec uploaded',
        )
      }

      return c.json({
        success: true,
        data: {
          message: 'Specification uploaded and parsed',
          summary: specSummary,
          completeness: (data.completeness as number) ?? 80,
        },
      })
    }
  } catch {
    // AI service unavailable, store file reference anyway
  }

  return c.json({
    success: true,
    data: {
      message: 'Specification uploaded. AI parsing will process shortly.',
      completeness: 0,
    },
  })
})

// POST /projects/:id/generate-brd
projectsRoute.post('/:id/generate-brd', async (c) => {
  const projectId = c.req.param('id')
  const user = getAuthUser(c)
  const db = getDb()
  const service = getService()

  // Verify project ownership
  const [ownedProject] = await db
    .select({ ownerId: projectsTable.ownerId })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1)
  if (!ownedProject || ownedProject.ownerId !== user.id) {
    throw new AppError('AUTH_FORBIDDEN', 'Only the project owner can generate BRD')
  }

  // Check BRD generation limit
  const [existingBrdCheck] = await db
    .select({ version: brdDocuments.version })
    .from(brdDocuments)
    .where(eq(brdDocuments.projectId, projectId))
    .limit(1)

  if (existingBrdCheck && (existingBrdCheck.version ?? 0) >= FREE_BRD_GENERATIONS) {
    throw new AppError(
      'DOCUMENT_GENERATION_LIMIT',
      `Batas generasi BRD gratis (${FREE_BRD_GENERATIONS}x) sudah tercapai. Generasi tambahan memerlukan biaya.`,
    )
  }

  const language = pickDocLanguage(await c.req.json().catch(() => ({})))

  // Get project
  const project = await service.getProject(projectId)
  if (!project) throw new AppError('PROJECT_NOT_FOUND', 'Proyek tidak ditemukan')

  // Get conversation history
  const [conversation] = await db
    .select()
    .from(chatConversations)
    .where(
      and(eq(chatConversations.projectId, projectId), eq(chatConversations.type, 'ai_scoping')),
    )
    .limit(1)

  let conversationHistory: Array<{ role: string; content: string }> = []
  if (conversation) {
    const messages = await db
      .select({ senderType: chatMessages.senderType, content: chatMessages.content })
      .from(chatMessages)
      .where(eq(chatMessages.conversationId, conversation.id))
      .orderBy(chatMessages.createdAt)
    conversationHistory = messages.map((m) => ({
      role: m.senderType === 'user' ? 'user' : 'assistant',
      content: m.content ?? '',
    }))
  }

  // B1: Enforce minimum scoping completeness before BRD generation
  const userMessageCount = conversationHistory.filter((m) => m.role === 'user').length
  if (userMessageCount < 4) {
    throw new AppError('VALIDATION_ERROR', 'Scoping belum lengkap. Minimal 4 pesan diperlukan.')
  }

  const brdData = await generateBrdContent({
    projectId,
    project: {
      title: project.title,
      description: project.description ?? null,
      category: project.category,
      budgetMin: project.budgetMin ?? null,
      budgetMax: project.budgetMax ?? null,
      estimatedTimelineDays: project.estimatedTimelineDays ?? null,
    },
    conversationHistory,
    language,
  })
  const brdPrice = priceBrd(brdData)

  // Save BRD to database
  const [existingBrd] = await db
    .select()
    .from(brdDocuments)
    .where(eq(brdDocuments.projectId, projectId))
    .limit(1)

  if (existingBrd) {
    await db
      .update(brdDocuments)
      .set({
        content: brdData,
        version: (existingBrd.version ?? 0) + 1,
        status: 'review',
        price: brdPrice,
        updatedAt: new Date(),
      })
      .where(eq(brdDocuments.id, existingBrd.id))
  } else {
    await db.insert(brdDocuments).values({
      id: uuidv7(),
      projectId,
      content: brdData,
      version: 1,
      status: 'review',
      price: brdPrice,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  }

  // Transition status to brd_generated
  try {
    await service.transitionStatus(
      projectId,
      'brd_generated' as ProjectStatus,
      'system',
      'BRD generated by AI',
    )
  } catch {
    // May already be in brd_generated state
  }

  return c.json({ success: true, data: brdData })
})

// POST /projects/:id/generate-prd
projectsRoute.post('/:id/generate-prd', async (c) => {
  const projectId = c.req.param('id')
  const user = getAuthUser(c)
  const db = getDb()
  const service = getService()

  // Verify project ownership
  const [ownedProject] = await db
    .select({ ownerId: projectsTable.ownerId })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1)
  if (!ownedProject || ownedProject.ownerId !== user.id) {
    throw new AppError('AUTH_FORBIDDEN', 'Only the project owner can generate PRD')
  }

  const language = pickDocLanguage(await c.req.json().catch(() => ({})))

  // Check PRD generation limit
  const [existingPrdCheck] = await db
    .select({ version: prdDocuments.version })
    .from(prdDocuments)
    .where(eq(prdDocuments.projectId, projectId))
    .limit(1)

  if (existingPrdCheck && (existingPrdCheck.version ?? 0) >= FREE_PRD_GENERATIONS) {
    throw new AppError(
      'DOCUMENT_GENERATION_LIMIT',
      `Batas generasi PRD gratis (${FREE_PRD_GENERATIONS}x) sudah tercapai. Generasi tambahan memerlukan biaya.`,
    )
  }

  const project = await service.getProject(projectId)
  if (!project) throw new AppError('PROJECT_NOT_FOUND', 'Proyek tidak ditemukan')

  // Get BRD content
  const [brd] = await db
    .select()
    .from(brdDocuments)
    .where(eq(brdDocuments.projectId, projectId))
    .limit(1)

  const prdData = await generatePrdContent({
    projectId,
    project: {
      title: project.title,
      description: project.description ?? null,
      category: project.category,
      budgetMin: project.budgetMin ?? null,
      budgetMax: project.budgetMax ?? null,
      estimatedTimelineDays: project.estimatedTimelineDays ?? null,
    },
    brdContent: (brd?.content ?? {}) as Record<string, unknown>,
    language,
  })
  const prdPrice = pricePrd(prdData)

  // Save PRD
  const [existingPrd] = await db
    .select()
    .from(prdDocuments)
    .where(eq(prdDocuments.projectId, projectId))
    .limit(1)

  if (existingPrd) {
    await db
      .update(prdDocuments)
      .set({
        content: prdData,
        version: (existingPrd.version ?? 0) + 1,
        status: 'review',
        price: prdPrice,
        updatedAt: new Date(),
      })
      .where(eq(prdDocuments.id, existingPrd.id))
  } else {
    await db.insert(prdDocuments).values({
      id: uuidv7(),
      projectId,
      content: prdData,
      version: 1,
      status: 'review',
      price: prdPrice,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  }

  // Team branch stays unreachable while teamSize is 1.
  const composition = prdData.team_composition as { team_size?: number } | undefined
  const teamSize = composition?.team_size ?? (prdData.estimated_team_size as number | undefined)
  if (typeof teamSize === 'number' && teamSize >= 1) {
    await db
      .update(projectsTable)
      .set({ teamSize: Math.min(teamSize, MAX_TEAM_SIZE), updatedAt: new Date() })
      .where(eq(projectsTable.id, projectId))
  }

  try {
    await service.transitionStatus(
      projectId,
      'prd_generated' as ProjectStatus,
      'system',
      'PRD generated by AI',
    )
  } catch {}

  return c.json({ success: true, data: prdData })
})

// GET /projects/:id/status-logs - get status change history
projectsRoute.get('/:id/status-logs', async (c) => {
  const id = c.req.param('id')
  const service = getService()

  const logs = await service.getStatusLogs(id)

  return c.json({
    success: true,
    data: logs,
  })
})

// POST /projects/:id/payment-callback - internal callback from payment-service
const paymentCallbackSchema = z.object({
  orderId: z.string().min(1),
  status: z.string().min(1),
  amount: z.number().optional(),
})

projectsRoute.post('/:id/payment-callback', async (c) => {
  // Validate X-Service-Auth header for internal service-to-service calls
  const serviceAuth = c.req.header('X-Service-Auth')
  const secret = env.SERVICE_AUTH_SECRET
  if (!secret || serviceAuth !== secret) {
    throw new AppError('AUTH_UNAUTHORIZED', 'Invalid service authentication')
  }

  const projectId = c.req.param('id')
  const body = await c.req.json()

  const parsed = paymentCallbackSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid payment callback data', {
      issues: z.flattenError(parsed.error).fieldErrors,
    })
  }

  const { orderId, status } = parsed.data

  // Only process completed payments
  if (status !== 'completed') {
    return c.json({ success: true, data: { processed: false, reason: 'non-completed status' } })
  }

  const db = getDb()

  if (orderId.startsWith('BRD-')) {
    // Update BRD document status to 'paid'
    const [brd] = await db
      .select()
      .from(brdDocuments)
      .where(eq(brdDocuments.projectId, projectId))
      .limit(1)

    if (!brd) {
      throw new AppError('NOT_FOUND', 'BRD document not found for this project')
    }

    // Idempotency: paidAt persists even when a later revision resets status.
    if (brd.paidAt) {
      return c.json({ success: true, data: { processed: false, reason: 'already processed' } })
    }

    await db
      .update(brdDocuments)
      .set({ status: 'paid', paidAt: new Date(), updatedAt: new Date() })
      .where(eq(brdDocuments.projectId, projectId))

    // Transition project to brd_purchased
    const service = getService()
    try {
      await service.transitionStatus(
        projectId,
        'brd_purchased' as ProjectStatus,
        'system',
        'BRD payment completed',
      )
    } catch {
      // Project may not be in the right state for this transition, log but don't fail
    }

    return c.json({ success: true, data: { processed: true, type: 'brd' } })
  }

  if (orderId.startsWith('PRD-')) {
    // Update PRD document status to 'paid'
    const [prd] = await db
      .select()
      .from(prdDocuments)
      .where(eq(prdDocuments.projectId, projectId))
      .limit(1)

    if (!prd) {
      throw new AppError('NOT_FOUND', 'PRD document not found for this project')
    }

    // Idempotency: paidAt persists even when a later revision resets status.
    if (prd.paidAt) {
      return c.json({ success: true, data: { processed: false, reason: 'already processed' } })
    }

    await db
      .update(prdDocuments)
      .set({ status: 'paid', paidAt: new Date(), updatedAt: new Date() })
      .where(eq(prdDocuments.projectId, projectId))

    // Transition project to prd_purchased
    const service = getService()
    try {
      await service.transitionStatus(
        projectId,
        'prd_purchased' as ProjectStatus,
        'system',
        'PRD payment completed',
      )
    } catch {
      // Project may not be in the right state for this transition
    }

    return c.json({ success: true, data: { processed: true, type: 'prd' } })
  }

  if (orderId.startsWith('ESC-')) {
    // Update escrow transaction status — find matching transaction by project
    await db
      .update(transactions)
      .set({ status: 'completed', updatedAt: new Date() })
      .where(
        and(
          eq(transactions.projectId, projectId),
          eq(transactions.type, 'escrow_in'),
          eq(transactions.status, 'pending'),
        ),
      )

    // Transition project toward matching/in_progress
    const service = getService()
    try {
      await service.transitionStatus(
        projectId,
        'matching' as ProjectStatus,
        'system',
        'Escrow payment completed',
      )
    } catch {
      // Project may not be in the right state for this transition
    }

    return c.json({ success: true, data: { processed: true, type: 'escrow' } })
  }

  return c.json({ success: true, data: { processed: false, reason: 'unknown order prefix' } })
})

// B5: POST /projects/:id/brd/revision — request BRD revision with free limit
const brdRevisionSchema = z.object({
  description: z.string().min(5).max(2000),
  severity: z.enum(['minor', 'moderate', 'major']).default('minor'),
})

projectsRoute.post('/:id/brd/revision', async (c) => {
  const projectId = c.req.param('id')
  const body = await c.req.json()

  const parsed = brdRevisionSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid revision request data', {
      issues: z.flattenError(parsed.error).fieldErrors,
    })
  }

  const user = getAuthUser(c)
  const db = getDb()

  const [project] = await db
    .select({
      ownerId: projectsTable.ownerId,
      title: projectsTable.title,
      description: projectsTable.description,
      category: projectsTable.category,
      budgetMin: projectsTable.budgetMin,
      budgetMax: projectsTable.budgetMax,
      estimatedTimelineDays: projectsTable.estimatedTimelineDays,
    })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1)
  if (!project || project.ownerId !== user.id) {
    throw new AppError('AUTH_FORBIDDEN', 'Only the project owner can request BRD revision')
  }

  const [brd] = await db
    .select()
    .from(brdDocuments)
    .where(eq(brdDocuments.projectId, projectId))
    .limit(1)
  if (!brd) {
    throw new AppError('NOT_FOUND', 'BRD document not found for this project')
  }

  // Version counts every generation; the free allowance caps revisions.
  const currentVersion = brd.version ?? 1
  if (currentVersion >= FREE_BRD_GENERATIONS) {
    throw new AppError(
      'DOCUMENT_GENERATION_LIMIT',
      `Batas revisi BRD gratis (${FREE_BRD_GENERATIONS}x) sudah tercapai. Revisi tambahan memerlukan biaya.`,
    )
  }

  // Persist the instruction in the scoping thread, then regenerate from it.
  const [conversation] = await db
    .select()
    .from(chatConversations)
    .where(
      and(eq(chatConversations.projectId, projectId), eq(chatConversations.type, 'ai_scoping')),
    )
    .limit(1)
  let conversationHistory: Array<{ role: string; content: string }> = []
  if (conversation) {
    await db.insert(chatMessages).values({
      id: uuidv7(),
      conversationId: conversation.id,
      senderType: 'user',
      senderId: user.id,
      content: `[Revisi BRD] ${parsed.data.description}`,
      createdAt: new Date(),
    })
    const messages = await db
      .select({ senderType: chatMessages.senderType, content: chatMessages.content })
      .from(chatMessages)
      .where(eq(chatMessages.conversationId, conversation.id))
      .orderBy(chatMessages.createdAt)
    conversationHistory = messages.map((m) => ({
      role: m.senderType === 'user' ? 'user' : 'assistant',
      content: m.content ?? '',
    }))
  }

  const brdData = await generateBrdContent({
    projectId,
    project: {
      title: project.title,
      description: project.description ?? null,
      category: project.category,
      budgetMin: project.budgetMin ?? null,
      budgetMax: project.budgetMax ?? null,
      estimatedTimelineDays: project.estimatedTimelineDays ?? null,
    },
    conversationHistory,
    language: brdLanguage((brd.content ?? {}) as Record<string, unknown>),
    currentDocument: (brd.content ?? {}) as Record<string, unknown>,
    revisionInstruction: parsed.data.description,
  })

  await db
    .update(brdDocuments)
    .set({
      content: brdData,
      version: currentVersion + 1,
      status: 'review',
      updatedAt: new Date(),
    })
    .where(eq(brdDocuments.id, brd.id))

  return c.json({
    success: true,
    data: {
      version: currentVersion + 1,
      freeRevisionsRemaining: Math.max(0, FREE_BRD_GENERATIONS - currentVersion - 1),
    },
  })
})

// POST /projects/:id/prd/revision — request PRD revision with free limit
const prdRevisionSchema = z.object({
  description: z.string().min(5).max(2000),
  severity: z.enum(['minor', 'moderate', 'major']).default('minor'),
})

projectsRoute.post('/:id/prd/revision', async (c) => {
  const projectId = c.req.param('id')
  const body = await c.req.json()

  const parsed = prdRevisionSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid revision request data', {
      issues: z.flattenError(parsed.error).fieldErrors,
    })
  }

  const user = getAuthUser(c)
  const db = getDb()

  const [project] = await db
    .select({
      ownerId: projectsTable.ownerId,
      title: projectsTable.title,
      description: projectsTable.description,
      category: projectsTable.category,
      budgetMin: projectsTable.budgetMin,
      budgetMax: projectsTable.budgetMax,
      estimatedTimelineDays: projectsTable.estimatedTimelineDays,
    })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1)
  if (!project || project.ownerId !== user.id) {
    throw new AppError('AUTH_FORBIDDEN', 'Only the project owner can request PRD revision')
  }

  const [prd] = await db
    .select()
    .from(prdDocuments)
    .where(eq(prdDocuments.projectId, projectId))
    .limit(1)
  if (!prd) {
    throw new AppError('NOT_FOUND', 'PRD document not found for this project')
  }

  // Version counts every generation; the free allowance caps revisions.
  const currentVersion = prd.version ?? 1
  if (currentVersion >= FREE_PRD_GENERATIONS) {
    throw new AppError(
      'DOCUMENT_GENERATION_LIMIT',
      `Batas revisi PRD gratis (${FREE_PRD_GENERATIONS}x) sudah tercapai. Revisi tambahan memerlukan biaya.`,
    )
  }

  const [brd] = await db
    .select({ content: brdDocuments.content })
    .from(brdDocuments)
    .where(eq(brdDocuments.projectId, projectId))
    .limit(1)

  const prdData = await generatePrdContent({
    projectId,
    project: {
      title: project.title,
      description: project.description ?? null,
      category: project.category,
      budgetMin: project.budgetMin ?? null,
      budgetMax: project.budgetMax ?? null,
      estimatedTimelineDays: project.estimatedTimelineDays ?? null,
    },
    brdContent: (brd?.content ?? {}) as Record<string, unknown>,
    language: prdLanguage((prd.content ?? {}) as Record<string, unknown>),
    currentDocument: (prd.content ?? {}) as Record<string, unknown>,
    revisionInstruction: parsed.data.description,
  })

  await db
    .update(prdDocuments)
    .set({
      content: prdData,
      version: currentVersion + 1,
      status: 'review',
      updatedAt: new Date(),
    })
    .where(eq(prdDocuments.id, prd.id))

  return c.json({
    success: true,
    data: {
      version: currentVersion + 1,
      freeRevisionsRemaining: Math.max(0, FREE_PRD_GENERATIONS - currentVersion - 1),
    },
  })
})
