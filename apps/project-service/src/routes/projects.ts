import {
  brdDocuments,
  chatMessages,
  getDb,
  prdDocuments,
  projectAssignments,
  projects as projectsTable,
  talentProfiles,
} from '@kerjacus/db'
import {
  AppError,
  createProjectSchema,
  DAILY_FREE_DOCUMENTS,
  FREE_BRD_GENERATIONS,
  FREE_PRD_GENERATIONS,
  MAX_TEAM_SIZE,
  normalizePrdContent,
  type ProjectCategory,
  type ProjectStatus,
  paginationSchema,
  revisionGate,
} from '@kerjacus/shared'
import { and, desc, eq, gt, inArray, isNull, type SQL, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { uuidv7 } from 'uuidv7'
import { z } from 'zod'
import { brdLanguage, normalizeBrdContent, renderBrdPdf } from '../lib/brd-pdf'
import { claimGeneration, claimRevision, releaseClaim } from '../lib/document-claim'
import { dailyDocsCreated, isDocumentPaid } from '../lib/document-entitlement'
import {
  generateBrdContent,
  generatePrdContent,
  priceBrd,
  pricePrd,
} from '../lib/document-generation'
import { env } from '../lib/env'
import { refundRemainingEscrow } from '../lib/escrow-refund'
import { serviceFetch, TIMEOUT_MS } from '../lib/http/service-fetch'
import { UpstreamError } from '../lib/http/upstream-error'
import { appendOutboxEvent } from '../lib/outbox'
import { publicPaginationSchema } from '../lib/pagination'
import { prdLanguage, renderPrdPdf } from '../lib/prd-pdf'
import { assertProjectAccess, assertProjectOwner, isAssignedTalent } from '../lib/project-access'
import { publicProjectScope } from '../lib/public-scope'
import { buildScopingSystemPrompt, computeFormCompleteness } from '../lib/scoping-context'
import { ensureScopingConversation, findScopingConversation } from '../lib/scoping-conversation'
import { signalTeamComplete, startTeamFormationWorkflow } from '../lib/team-formation-workflow'
import { applyProjectVisibility, gateProjectBrd, gateProjectPrd } from '../lib/visibility'
import { planDependencies, planWorkPackages } from '../lib/work-package-planning'
import { getAuthUser, getOptionalUser } from '../middleware/session'
import { ProjectRepository } from '../repositories/project.repository'
import { WorkPackageRepository } from '../repositories/work-package.repository'
import { ProjectService } from '../services/project.service'
import { WorkPackageService } from '../services/work-package.service'
import { settlementRoutes } from './projects/settlement.routes'

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

// Query schemas. Pagination bounds come from the shared schema rather than a
// third copy of the same two lines, so the page cap cannot hold on two of
// these routes and be missing on the third.
const listQuerySchema = paginationSchema.extend({
  status: z.enum(projectStatusValues).optional(),
  category: z.enum(projectCategoryValues).optional(),
  ownerId: z.uuid().optional(),
})

const publicBrowseQuerySchema = publicPaginationSchema.extend({
  category: z.enum(projectCategoryValues).optional(),
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

function getWorkPackageService(): WorkPackageService {
  const db = getDb()
  return new WorkPackageService(new WorkPackageRepository(db), new ProjectRepository(db))
}

/**
 * Bounds on what one scoping turn may cost.
 *
 * Every turn used to load the whole conversation and ship it upstream, so cost
 * and latency grew with the square of the session, and the owner's message was
 * only checked for being non-empty. max_output_tokens is set on the AI side, so
 * input was the last unbounded dimension. The window keeps the newest turns
 * because the tail is what the next answer depends on.
 */
const MAX_SCOPING_MESSAGE_LENGTH = 4000
const SCOPING_HISTORY_WINDOW = 40

// The owner picks the document language at generation; default Indonesian.
function pickDocLanguage(body: unknown): 'id' | 'en' {
  return (body as { language?: string } | null)?.language === 'en' ? 'en' : 'id'
}

export const projectsRoute = new Hono()

// Money boundary, mounted here so /projects/:id/payment-callback is unchanged.
projectsRoute.route('/', settlementRoutes)

// GET /projects/stats — public platform stats
projectsRoute.get('/stats', async (c) => {
  const db = getDb()
  // Public landing-page success metrics. Deleted projects counted toward all
  // three, so every number was inflated by work that no longer exists.
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(projectsTable)
    .where(isNull(projectsTable.deletedAt))
  const [{ completed }] = await db
    .select({ completed: sql<number>`count(*)::int` })
    .from(projectsTable)
    .where(and(eq(projectsTable.status, 'completed'), isNull(projectsTable.deletedAt)))
  const [{ active }] = await db
    .select({ active: sql<number>`count(*)::int` })
    .from(projectsTable)
    .where(
      and(
        inArray(projectsTable.status, ['in_progress', 'review']),
        isNull(projectsTable.deletedAt),
      ),
    )

  return c.json({ success: true, data: { total, completed, active } })
})

// GET /projects/public — unauthenticated browsing
projectsRoute.get('/public', async (c) => {
  // Bare Number() put the query string straight into LIMIT and OFFSET on the
  // one list route that needs no session, and passed category through an
  // unchecked cast into an enum comparison Postgres answers with an error.
  const parsed = publicBrowseQuerySchema.safeParse(c.req.query())
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid query parameters', {
      issues: z.flattenError(parsed.error).fieldErrors,
    })
  }

  const { page, pageSize, category } = parsed.data
  const db = getDb()

  // Show projects that owner marked as public (summary or detail). Status is
  // filtered server-side: default visibility is public_summary, so without
  // this every draft and scoping project leaked onto the public browse page.
  const conditions: SQL[] = [
    inArray(projectsTable.visibility, ['public_summary', 'public_detail']),
    inArray(projectsTable.status, [
      'matching',
      'team_forming',
      'matched',
      'in_progress',
      'review',
      'completed',
    ]),
    isNull(projectsTable.deletedAt),
  ]
  if (category) {
    conditions.push(eq(projectsTable.category, category))
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
  const querySchema = paginationSchema.extend({
    category: z.enum(projectCategoryValues).optional(),
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

  // Pre-live projects (draft, scoping, documents) are the owner's private
  // workspace even under the public_summary default; the browse lists already
  // hide them, so a direct link must not reveal them either.
  const LIVE_STATUSES = [
    'matching',
    'team_forming',
    'matched',
    'in_progress',
    'review',
    'completed',
  ]
  const isStranger = viewerId !== project.ownerId && !participant
  if (isStranger && !LIVE_STATUSES.includes(project.status)) {
    throw new AppError('PROJECT_NOT_FOUND', 'Project not found')
  }

  const visible = applyProjectVisibility(project, viewerId, participant)

  // Owner and assigned talents only; both documents are the owner's, not
  // public marketing, and the anonymous GET /:id must not hand them to a
  // stranger. Payment does not gate the content - the app watermarks the
  // preview and gates the download.
  // gt(version, 0) skips a row reserving an in-flight generation: it carries no
  // content yet, and reporting it as a document shows an empty one. Every read
  // below applies the same rule.
  const db = getDb()
  const [brd] = await db
    .select()
    .from(brdDocuments)
    .where(and(eq(brdDocuments.projectId, id), gt(brdDocuments.version, 0)))
    .limit(1)
  const brdData = gateProjectBrd(brd, viewerId, project.ownerId, participant)

  const [prd] = await db
    .select()
    .from(prdDocuments)
    .where(and(eq(prdDocuments.projectId, id), gt(prdDocuments.version, 0)))
    .limit(1)
  const prdData = gateProjectPrd(prd, viewerId, project.ownerId, participant)

  // On public_detail the owner chose to advertise what the work involves. The
  // PRD holds that, but the document is theirs and priced, so a stranger gets
  // a scope projection instead - no per-package amount, no total cost.
  const scope = prdData ? null : publicProjectScope(prd, project.visibility)

  // The owner and assigned talents may see who is on the team - the talent's
  // user id and role - so an owner can aim a review or dispute at one talent.
  // Only active (post-deal) assignments, and never for a stranger: matching
  // anonymity covers the pre-deal window, not talents already under contract.
  const canSeeTeam = viewerId !== null && (viewerId === project.ownerId || participant)
  const assignments = canSeeTeam
    ? await db
        .select({
          workPackageId: projectAssignments.workPackageId,
          talentUserId: talentProfiles.userId,
          roleLabel: projectAssignments.roleLabel,
        })
        .from(projectAssignments)
        .innerJoin(talentProfiles, eq(talentProfiles.id, projectAssignments.talentId))
        .where(and(eq(projectAssignments.projectId, id), eq(projectAssignments.status, 'active')))
    : []

  return c.json({
    success: true,
    data: { ...visible, brd: brdData, prd: prdData, scope, assignments },
  })
})

// GET /projects/:id/brd
projectsRoute.get('/:id/brd', async (c) => {
  const projectId = c.req.param('id')
  const user = getAuthUser(c)
  const db = getDb()

  await assertProjectOwner(projectId, user.id, 'Only the project owner can view BRD')

  const [brd] = await db
    .select()
    .from(brdDocuments)
    .where(and(eq(brdDocuments.projectId, projectId), gt(brdDocuments.version, 0)))
    .limit(1)

  if (!brd) {
    return c.json({ success: true, data: null })
  }

  // Owner-only endpoint: the owner sees the whole BRD. The app watermarks the
  // preview and the clean PDF download stays behind payment (see /brd/pdf).
  return c.json({ success: true, data: brd })
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
    .where(and(eq(brdDocuments.projectId, projectId), gt(brdDocuments.version, 0)))
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
    .where(and(eq(prdDocuments.projectId, projectId), gt(prdDocuments.version, 0)))
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
    .where(and(eq(prdDocuments.projectId, projectId), gt(prdDocuments.version, 0)))
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

  await assertProjectOwner(id, user.id, 'Only the project owner can update this project')

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

  // Money moves BEFORE the status flip, mirroring the dispute path: a refund
  // failure throws and the owner retries the cancellation, instead of a
  // cancelled project whose escrow silently stays trapped. Refund is sized
  // from the remaining ledger balance, so approved-and-released milestones
  // stay paid and only the unspent escrow returns.
  if (parsed.data.status === 'cancelled') {
    await refundRemainingEscrow({
      projectId: id,
      ownerId: ownedProject.ownerId,
      performedBy: userId,
      idempotencyKeyPrefix: `refund:cancel:${id}`,
      reason: 'Project cancelled by owner',
    })
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

/**
 * Enqueue an embedding request for the latest BRD/PRD revision. Resolves once
 * the outbox row commits, so callers can rely on it being durable before they
 * respond. The actual embedding work is done by ai-service when it consumes
 * `ai.{brd,prd}.embed_requested`.
 */
async function enqueueEmbeddingRequest(projectId: string, docType: 'brd' | 'prd'): Promise<void> {
  const db = getDb()
  const docsTable = docType === 'brd' ? brdDocuments : prdDocuments
  // Approval is the only caller, and a document cannot be approved while it is
  // still reserved, so gt(version, 0) is unreachable here. It is kept because
  // the alternative if it ever were reached is embedding an empty document,
  // and the existing early return already treats "no document" as nothing to do.
  const [doc] = await db
    .select({ id: docsTable.id, content: docsTable.content })
    .from(docsTable)
    .where(and(eq(docsTable.projectId, projectId), gt(docsTable.version, 0)))
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

  // missing names the gaps the form left, so the scoping page can open with a
  // question instead of an empty chat the owner has to guess at.
  const { floor: formFloor, missing } = computeFormCompleteness(project)
  return c.json({
    success: true,
    data: { formFloor, missing, suggestGenerateBrd: formFloor >= 80 },
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
  if (content.length > MAX_SCOPING_MESSAGE_LENGTH) {
    throw new AppError('VALIDATION_ERROR', 'Message is too long')
  }

  const conversationId = await ensureScopingConversation(projectId)

  await db.insert(chatMessages).values({
    id: uuidv7(),
    conversationId,
    senderType: 'user',
    content: content.trim(),
    createdAt: new Date(),
  })

  const allMessages = (
    await db
      .select({ senderType: chatMessages.senderType, content: chatMessages.content })
      .from(chatMessages)
      .where(eq(chatMessages.conversationId, conversationId))
      .orderBy(desc(chatMessages.createdAt))
      .limit(SCOPING_HISTORY_WINDOW)
  ).reverse()

  const { floor: formFloor } = computeFormCompleteness(project)
  const systemPrompt = buildScopingSystemPrompt(project)
  const payloadMessages = [
    { role: 'system' as const, content: systemPrompt },
    ...allMessages.map((m) => ({
      role: (m.senderType === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: m.content,
    })),
  ]

  const aiUrl = env.AI_SERVICE_URL
  let aiRes: Response
  try {
    aiRes = await serviceFetch(
      `${aiUrl}/api/v1/ai/chat`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: projectId, messages: payloadMessages }),
      },
      { service: 'ai-service', timeoutMs: TIMEOUT_MS.chat },
    )
  } catch (err) {
    // The upstream body used to be sliced into this message and shipped to the
    // browser, which leaks internal detail. It now stays in the log line that
    // UpstreamError carries, and the user gets the catalog message.
    if (err instanceof UpstreamError) throw err.toAppError()
    throw err
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
  // The AI names the BRD fields still missing; the scoping page renders them as
  // a "still needed" checklist, so the proxy has to carry them through.
  const aiMissing =
    (aiData.missing as string[] | undefined) ??
    ((aiData.data as Record<string, unknown>)?.missing as string[] | undefined) ??
    []

  if (!aiContent) {
    throw new AppError('AI_INVALID_RESPONSE', 'AI service returned empty content')
  }

  await db.insert(chatMessages).values({
    id: uuidv7(),
    conversationId,
    senderType: 'ai',
    content: aiContent,
    createdAt: new Date(),
  })

  return c.json({
    success: true,
    data: {
      message: aiContent,
      completeness,
      missing: aiMissing,
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
  if (content.length > MAX_SCOPING_MESSAGE_LENGTH) {
    throw new AppError('VALIDATION_ERROR', 'Message is too long')
  }

  const conversationId = await ensureScopingConversation(projectId)

  await db.insert(chatMessages).values({
    id: uuidv7(),
    conversationId,
    senderType: 'user',
    content,
    createdAt: new Date(),
  })

  const allMessages = (
    await db
      .select({ senderType: chatMessages.senderType, content: chatMessages.content })
      .from(chatMessages)
      .where(eq(chatMessages.conversationId, conversationId))
      .orderBy(desc(chatMessages.createdAt))
      .limit(SCOPING_HISTORY_WINDOW)
  ).reverse()

  const { floor: formFloor } = computeFormCompleteness(project)
  const systemPrompt = buildScopingSystemPrompt(project)
  const payloadMessages = [
    { role: 'system' as const, content: systemPrompt },
    ...allMessages.map((m) => ({
      role: (m.senderType === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: m.content,
    })),
  ]

  const aiUrl = env.AI_SERVICE_URL

  // Structural, because Bun and lib.dom disagree on the reader type and all
  // this needs is the teardown.
  let upstreamReader: { cancel: () => Promise<void> } | null = null

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder()
      const decoder = new TextDecoder()
      const emit = (obj: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`))

      let fullText = ''
      let aiScore = 0
      let aiMissing: string[] = []
      let upstreamFailed = false

      try {
        const upstream = await serviceFetch(
          `${aiUrl}/api/v1/ai/chat/stream`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'text/event-stream',
            },
            body: JSON.stringify({
              project_id: projectId,
              messages: payloadMessages,
            }),
          },
          {
            service: 'ai-service',
            timeoutMs: TIMEOUT_MS.stream,
            // Closing the tab aborted nothing: ai-service kept consuming the
            // Gemini stream to completion, billed in full, for up to the
            // 180s stream timeout.
            signal: c.req.raw.signal,
          },
        )

        // A non-2xx now throws out of serviceFetch and is handled below, so
        // only a 2xx with no readable body reaches this branch.
        if (!upstream.body) {
          upstreamFailed = true
          emit({ type: 'error', message: 'AI service returned no content' })
        } else {
          const reader = upstream.body.getReader()
          upstreamReader = reader
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
                  missing?: string[]
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
                  if (Array.isArray(event.missing)) {
                    aiMissing = event.missing
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
        // UpstreamError carries the upstream body for the logs; emitting its
        // message would push that internal detail down the SSE channel to the
        // browser, so it is mapped to the catalog message first.
        const message =
          err instanceof UpstreamError
            ? err.toAppError().message
            : err instanceof Error
              ? err.message
              : 'stream failed'
        emit({ type: 'error', message })
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
          missing: aiMissing,
          suggestGenerateBrd: completeness >= 80,
        })
      } else if (!upstreamFailed) {
        emit({ type: 'error', message: 'AI service returned empty content' })
      }
      controller.close()
    },
    // The browser going away is the common ending for a scoping stream, not
    // an error. Without this the upstream read loop kept running and emit()
    // threw on a closed controller from outside any try.
    cancel() {
      void upstreamReader?.cancel()
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
  let aiFailure = 'the AI service did not accept the document'
  try {
    const aiRes = await serviceFetch(
      `${aiUrl}/api/v1/ai/parse-spec`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_url: parsed.data.fileUrl,
          file_type: parsed.data.fileType,
          notes: parsed.data.notes,
        }),
      },
      { service: 'ai-service', timeoutMs: TIMEOUT_MS.document },
    )

    if (aiRes.ok) {
      const aiData = (await aiRes.json()) as Record<string, unknown>
      const data = (aiData.data ?? {}) as Record<string, unknown>

      const conversationId = await ensureScopingConversation(projectId)

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
  } catch (err) {
    aiFailure = err instanceof Error ? err.message : 'request failed'
  }

  // The point of uploading a specification is to seed the scoping chat from
  // it. Reporting success for an upload that was never parsed left the owner
  // with a document the assistant had never read, and the old copy promised
  // parsing "shortly" when nothing queues or retries it.
  throw new AppError(
    'AI_SERVICE_UNAVAILABLE',
    `The specification was stored but could not be read (${aiFailure}). Please try uploading it again.`,
  )
})

// POST /projects/:id/generate-brd
projectsRoute.post('/:id/generate-brd', async (c) => {
  const projectId = c.req.param('id')
  const user = getAuthUser(c)
  const db = getDb()
  const service = getService()

  await assertProjectOwner(projectId, user.id, 'Only the project owner can generate BRD')

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

  // Daily free-creation cap applies only to a brand-new BRD.
  if (!existingBrdCheck && (await dailyDocsCreated(user.id, 'brd')) >= DAILY_FREE_DOCUMENTS) {
    throw new AppError(
      'DOCUMENT_DAILY_LIMIT',
      'Batas pembuatan BRD gratis harian tercapai. Coba lagi besok.',
    )
  }

  const language = pickDocLanguage(await c.req.json().catch(() => ({})))

  // Get project
  const project = await service.getProject(projectId)
  if (!project) throw new AppError('PROJECT_NOT_FOUND', 'Proyek tidak ditemukan')

  // Get conversation history
  const conversationId = await findScopingConversation(projectId)

  let conversationHistory: Array<{ role: string; content: string }> = []
  if (conversationId) {
    const messages = await db
      .select({ senderType: chatMessages.senderType, content: chatMessages.content })
      .from(chatMessages)
      .where(eq(chatMessages.conversationId, conversationId))
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

  // Spend the allowance before the model call, so two concurrent submits
  // cannot both pass the limit check above and both bill a generation.
  const claim = await claimGeneration('brd', projectId, FREE_BRD_GENERATIONS)

  let brdData: Record<string, unknown>
  try {
    brdData = await generateBrdContent({
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
  } catch (err) {
    // Nothing was generated, so nothing was billed: give the slot back.
    await releaseClaim('brd', projectId, claim)
    throw err
  }
  const brdPrice = priceBrd(brdData)

  // The claim already created or advanced the row, so this only fills it in.
  await db
    .update(brdDocuments)
    .set({
      content: brdData,
      version: claim.version,
      status: 'review',
      price: brdPrice,
      updatedAt: new Date(),
    })
    .where(eq(brdDocuments.projectId, projectId))

  // Transition status to brd_generated
  try {
    await service.transitionStatus(
      projectId,
      'brd_generated' as ProjectStatus,
      // Null, not 'system'. project_status_logs.changed_by is a foreign key to
      // user, so the literal rolled this transition back and the catch hid it:
      // the owner got a BRD and the project stayed in scoping.
      null,
      'BRD generated by AI',
    )
  } catch (err) {
    // May already be in brd_generated state. Logged rather than swallowed,
    // because a bare catch here hid a constraint violation for as long as it
    // existed.
    console.warn('[projects] brd_generated transition skipped', { projectId, err })
  }

  return c.json({ success: true, data: brdData })
})

// POST /projects/:id/generate-prd
projectsRoute.post('/:id/generate-prd', async (c) => {
  const projectId = c.req.param('id')
  const user = getAuthUser(c)
  const db = getDb()
  const service = getService()

  await assertProjectOwner(projectId, user.id, 'Only the project owner can generate PRD')

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

  // Daily free-creation cap applies only to a brand-new PRD.
  if (!existingPrdCheck && (await dailyDocsCreated(user.id, 'prd')) >= DAILY_FREE_DOCUMENTS) {
    throw new AppError(
      'DOCUMENT_DAILY_LIMIT',
      'Batas pembuatan PRD gratis harian tercapai. Coba lagi besok.',
    )
  }

  const project = await service.getProject(projectId)
  if (!project) throw new AppError('PROJECT_NOT_FOUND', 'Proyek tidak ditemukan')

  // Get BRD content
  const [brd] = await db
    .select()
    .from(brdDocuments)
    .where(and(eq(brdDocuments.projectId, projectId), gt(brdDocuments.version, 0)))
    .limit(1)

  // Same claim-before-the-call rule as the BRD: see claimGeneration.
  const claim = await claimGeneration('prd', projectId, FREE_PRD_GENERATIONS)

  let prdData: Record<string, unknown>
  try {
    prdData = await generatePrdContent({
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
  } catch (err) {
    await releaseClaim('prd', projectId, claim)
    throw err
  }
  const prdPrice = pricePrd(prdData)

  // The claim already created or advanced the row, so this only fills it in.
  await db
    .update(prdDocuments)
    .set({
      content: prdData,
      version: claim.version,
      status: 'review',
      price: prdPrice,
      updatedAt: new Date(),
    })
    .where(eq(prdDocuments.projectId, projectId))

  const composition = prdData.team_composition as { team_size?: number } | undefined
  const rawTeamSize = composition?.team_size ?? (prdData.estimated_team_size as number | undefined)
  const clampedTeamSize = Math.min(Math.max(1, rawTeamSize ?? 1), MAX_TEAM_SIZE)

  // Turn the PRD into work packages so matching and /confirm have rows to act
  // on -- without this the confirm step throws MATCHING_NO_WORK_PACKAGES for
  // every project. One worker takes the whole project as a single package; a
  // team gets one package per role. Guarded on existing rows so a regenerate
  // never duplicates, and priced packages only so the amount CHECK holds.
  // The stored team size is then the real package count, so every "team size"
  // the UI shows matches the number of positions the owner staffs.
  let teamSize = clampedTeamSize
  try {
    const wpService = getWorkPackageService()
    const prdContent = normalizePrdContent(prdData)
    let allWps = await wpService.listByProject(projectId)
    if (allWps.length === 0) {
      const packages = planWorkPackages(prdContent, clampedTeamSize, project.title)
      if (packages.length > 0) {
        await wpService.createWorkPackages(projectId, packages)
        allWps = await wpService.listByProject(projectId)
      }
    }
    if (allWps.length > 0) teamSize = Math.min(allWps.length, MAX_TEAM_SIZE)

    // The PRD says which package blocks which, but nothing was storing it, so
    // every project's dependency table sat empty. Skipped per edge rather than
    // in bulk: addDependency rejects a cycle or a cross-project id on its own,
    // and one rejected edge should not take the graph with it. Existing edges
    // are skipped instead of the whole pass, so a PRD written before this
    // backfills on regenerate and a half-written graph still completes.
    if (allWps.length > 1) {
      const existing = new Set(
        (await wpService.getDependencies(projectId)).map(
          (d) => `${d.workPackageId}:${d.dependsOnWorkPackageId}`,
        ),
      )
      for (const edge of planDependencies(prdContent, allWps)) {
        if (existing.has(`${edge.workPackageId}:${edge.dependsOnWorkPackageId}`)) continue
        try {
          await wpService.addDependency(edge.workPackageId, edge.dependsOnWorkPackageId, edge.type)
        } catch (depErr) {
          console.error('work package dependency skipped', depErr)
        }
      }
    }
  } catch (err) {
    // Non-fatal: the PRD is already stored and a regenerate retries this.
    console.error('work package creation from PRD failed', err)
  }

  await db
    .update(projectsTable)
    .set({ teamSize, updatedAt: new Date() })
    .where(eq(projectsTable.id, projectId))

  try {
    await service.transitionStatus(
      projectId,
      'prd_generated' as ProjectStatus,
      // Same foreign key as the BRD branch above.
      null,
      'PRD generated by AI',
    )
  } catch (err) {
    console.warn('[projects] prd_generated transition skipped', { projectId, err })
  }

  return c.json({ success: true, data: prdData })
})

// GET /projects/:id/status-logs - get status change history
// The log names the users who moved the project and when, so it is not public
// to anyone holding a session: only the owner and its assigned talents.
projectsRoute.get('/:id/status-logs', async (c) => {
  const id = c.req.param('id')
  const service = getService()

  await assertProjectAccess(id, getAuthUser(c).id)

  const logs = await service.getStatusLogs(id)

  return c.json({
    success: true,
    data: logs,
  })
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
    .where(and(eq(brdDocuments.projectId, projectId), gt(brdDocuments.version, 0)))
    .limit(1)
  if (!brd) {
    throw new AppError('NOT_FOUND', 'BRD document not found for this project')
  }

  // Unpaid documents get two free revisions; paying extends the cap to nine,
  // after which there is a hard stop -- never route the paid cap to payment.
  const currentVersion = brd.version ?? 1
  const brdPaid = await isDocumentPaid(projectId, 'brd', brd.paidAt)
  const brdGate = revisionGate(currentVersion, brdPaid, FREE_BRD_GENERATIONS)
  if (brdGate === 'pay_to_unlock') {
    throw new AppError('DOCUMENT_NOT_PAID', 'Bayar untuk membuka revisi tambahan.')
  }
  if (brdGate === 'max_reached') {
    throw new AppError('DOCUMENT_REVISION_LIMIT', 'Batas maksimum revisi tercapai.')
  }

  // The gate above read a version that a concurrent revision may already have
  // spent, so the claim settles who gets it -- before the instruction is
  // written, so a caller that loses leaves nothing behind in the thread.
  const claim = await claimRevision('brd', projectId, currentVersion)

  let brdData: Record<string, unknown>
  try {
    // Persist the instruction in the scoping thread, then regenerate from it.
    const conversationId = await findScopingConversation(projectId)
    let conversationHistory: Array<{ role: string; content: string }> = []
    if (conversationId) {
      await db.insert(chatMessages).values({
        id: uuidv7(),
        conversationId,
        senderType: 'user',
        senderId: user.id,
        content: `[Revisi BRD] ${parsed.data.description}`,
        createdAt: new Date(),
      })
      const messages = await db
        .select({ senderType: chatMessages.senderType, content: chatMessages.content })
        .from(chatMessages)
        .where(eq(chatMessages.conversationId, conversationId))
        .orderBy(chatMessages.createdAt)
      conversationHistory = messages.map((m) => ({
        role: m.senderType === 'user' ? 'user' : 'assistant',
        content: m.content ?? '',
      }))
    }

    brdData = await generateBrdContent({
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
  } catch (err) {
    // No revision was produced, so the slot was never spent.
    await releaseClaim('brd', projectId, claim)
    throw err
  }

  // The body carries the estimate the document fee derives from, so a revision
  // that changes scope changes the fee. Stop at payment: once bought, the
  // price is settled and moving it would rewrite a completed sale.
  await db
    .update(brdDocuments)
    .set({
      content: brdData,
      version: claim.version,
      status: 'review',
      ...(brdPaid ? {} : { price: priceBrd(brdData) }),
      updatedAt: new Date(),
    })
    .where(eq(brdDocuments.id, brd.id))

  return c.json({
    success: true,
    data: {
      version: claim.version,
      freeRevisionsRemaining: Math.max(0, FREE_BRD_GENERATIONS - claim.version),
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
    .where(and(eq(prdDocuments.projectId, projectId), gt(prdDocuments.version, 0)))
    .limit(1)
  if (!prd) {
    throw new AppError('NOT_FOUND', 'PRD document not found for this project')
  }

  // Unpaid documents get two free revisions; paying extends the cap to nine,
  // after which there is a hard stop -- never route the paid cap to payment.
  const currentVersion = prd.version ?? 1
  const prdPaid = await isDocumentPaid(projectId, 'prd', prd.paidAt)
  const prdGate = revisionGate(currentVersion, prdPaid, FREE_PRD_GENERATIONS)
  if (prdGate === 'pay_to_unlock') {
    throw new AppError('DOCUMENT_NOT_PAID', 'Bayar untuk membuka revisi tambahan.')
  }
  if (prdGate === 'max_reached') {
    throw new AppError('DOCUMENT_REVISION_LIMIT', 'Batas maksimum revisi tercapai.')
  }

  // Same claim rule as the BRD revision: settle the slot before generating.
  const claim = await claimRevision('prd', projectId, currentVersion)

  let prdData: Record<string, unknown>
  try {
    const [brd] = await db
      .select({ content: brdDocuments.content })
      .from(brdDocuments)
      .where(and(eq(brdDocuments.projectId, projectId), gt(brdDocuments.version, 0)))
      .limit(1)

    prdData = await generatePrdContent({
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
  } catch (err) {
    // No revision was produced, so the slot was never spent.
    await releaseClaim('prd', projectId, claim)
    throw err
  }

  // Same rule as the BRD revision: reprice while unpaid, freeze once bought.
  await db
    .update(prdDocuments)
    .set({
      content: prdData,
      version: claim.version,
      status: 'review',
      ...(prdPaid ? {} : { price: pricePrd(prdData) }),
      updatedAt: new Date(),
    })
    .where(eq(prdDocuments.id, prd.id))

  return c.json({
    success: true,
    data: {
      version: claim.version,
      freeRevisionsRemaining: Math.max(0, FREE_PRD_GENERATIONS - claim.version),
    },
  })
})
