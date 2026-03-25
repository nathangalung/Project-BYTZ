import {
  brdDocuments,
  chatConversations,
  chatMessages,
  getDb,
  prdDocuments,
  projects as projectsTable,
  transactions,
} from '@kerjacus/db'
import {
  AppError,
  createProjectSchema,
  FREE_BRD_GENERATIONS,
  FREE_PRD_GENERATIONS,
  type ProjectCategory,
  type ProjectStatus,
} from '@kerjacus/shared'
import { and, desc, eq, inArray, isNull, type SQL, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { uuidv7 } from 'uuidv7'
import { z } from 'zod'
import { getAuthUser } from '../middleware/session'
import { ProjectRepository } from '../repositories/project.repository'
import { ProjectService } from '../services/project.service'

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

const projectCategoryValues = ['web_app', 'mobile_app', 'ui_ux_design', 'data_ai', 'other'] as const

// Query schemas
const listQuerySchema = z.object({
  status: z.enum(projectStatusValues).optional(),
  category: z.enum(projectCategoryValues).optional(),
  ownerId: z.string().uuid().optional(),
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
})

function getService(): ProjectService {
  const db = getDb()
  const repo = new ProjectRepository(db)
  return new ProjectService(repo)
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

  // For public_summary, strip detailed fields (description truncated, no preferences)
  const publicItems = items.map((item) => {
    if (item.visibility === 'public_summary') {
      return {
        ...item,
        description: item.description ? `${item.description.substring(0, 120)}...` : null,
        preferences: null,
      }
    }
    return item
  })

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
      issues: parsed.error.flatten().fieldErrors,
    })
  }

  const { category, page, pageSize } = parsed.data
  const offset = (page - 1) * pageSize
  const db = getDb()

  const conditions: SQL[] = [
    isNull(projectsTable.deletedAt),
    inArray(projectsTable.status, ['matching', 'team_forming']),
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
      items,
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
      issues: parsed.error.flatten().fieldErrors,
    })
  }

  const { status, category, ownerId, page, pageSize } = parsed.data
  const service = getService()

  const result = await service.listProjects(
    {
      status: status as ProjectStatus | undefined,
      category: category as ProjectCategory | undefined,
      ownerId,
    },
    { page, pageSize },
  )

  return c.json({
    success: true,
    data: {
      items: result.items,
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

  // Redact BRD content if not paid/approved
  const db = getDb()
  const [brd] = await db.select().from(brdDocuments).where(eq(brdDocuments.projectId, id)).limit(1)

  let brdData: Record<string, unknown> | null = null
  if (brd) {
    const brdContent = brd.content as Record<string, unknown> | null
    if (brd.status === 'paid' || brd.status === 'approved') {
      brdData = { ...brd, content: brdContent }
    } else {
      // Only expose executive_summary and business_objectives
      brdData = {
        ...brd,
        content: brdContent
          ? {
              executive_summary: brdContent.executive_summary ?? null,
              business_objectives: brdContent.business_objectives ?? null,
            }
          : null,
      }
    }
  }

  return c.json({
    success: true,
    data: { ...project, brd: brdData },
  })
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

  return c.json({ success: true, data: brd })
})

// GET /projects/:id/prd
projectsRoute.get('/:id/prd', async (c) => {
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
    throw new AppError('AUTH_FORBIDDEN', 'Only the project owner can view PRD')
  }

  const [prd] = await db
    .select()
    .from(prdDocuments)
    .where(eq(prdDocuments.projectId, projectId))
    .limit(1)

  if (!prd) {
    return c.json({ success: true, data: null })
  }

  return c.json({ success: true, data: prd })
})

// POST /projects - create
projectsRoute.post('/', async (c) => {
  const body = await c.req.json()

  const parsed = createProjectSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid project data', {
      issues: parsed.error.flatten().fieldErrors,
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
      issues: parsed.error.flatten().fieldErrors,
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
      issues: parsed.error.flatten().fieldErrors,
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

  return c.json({
    success: true,
    data: project,
  })
})

// POST /projects/:id/chat - scoping chat with AI
projectsRoute.post('/:id/chat', async (c) => {
  const projectId = c.req.param('id')

  const user = getAuthUser(c)
  const userId = user.id

  // Verify user is the project owner
  const db = getDb()
  const [project] = await db
    .select({ ownerId: projectsTable.ownerId })
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

  // Get or create scoping conversation
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

  // Save user message
  await db.insert(chatMessages).values({
    id: uuidv7(),
    conversationId: conversation.id,
    senderType: 'user',
    content: content.trim(),
    createdAt: new Date(),
  })

  // Get all messages for context
  const allMessages = await db
    .select({ senderType: chatMessages.senderType, content: chatMessages.content })
    .from(chatMessages)
    .where(eq(chatMessages.conversationId, conversation.id))
    .orderBy(chatMessages.createdAt)

  // Forward to AI service
  const aiUrl = process.env.AI_SERVICE_URL || 'http://localhost:3003'
  let aiContent = 'Terima kasih. Bisa ceritakan lebih detail tentang kebutuhan proyek Anda?'
  let completeness = Math.min(100, allMessages.filter((m) => m.senderType === 'user').length * 18)

  try {
    const aiRes = await fetch(`${aiUrl}/api/v1/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: projectId,
        messages: allMessages.map((m) => ({
          role: m.senderType === 'user' ? 'user' : 'assistant',
          content: m.content,
        })),
      }),
    })
    if (aiRes.ok) {
      const aiData = (await aiRes.json()) as Record<string, unknown>
      const msg =
        (aiData.message as Record<string, string>)?.content ??
        ((aiData.data as Record<string, unknown>)?.message as Record<string, string>)?.content
      if (msg) aiContent = msg
      const score =
        (aiData as Record<string, number>).completeness_score ??
        (aiData.data as Record<string, number>)?.completeness_score
      if (typeof score === 'number') completeness = score
    }
  } catch {
    // AI service unavailable, use completeness heuristic
  }

  // Save AI response
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

// POST /projects/:id/upload-spec - upload existing specification for BRD generation
const uploadSpecSchema = z.object({
  fileUrl: z.string().url(),
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
      issues: parsed.error.flatten().fieldErrors,
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
  const aiUrl = process.env.AI_SERVICE_URL || 'http://localhost:3003'
  try {
    const aiRes = await fetch(`${aiUrl}/api/v1/ai/parse-spec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

  // Call AI service
  const aiUrl = process.env.AI_SERVICE_URL || 'http://localhost:3003'
  let brdData: Record<string, unknown> = {}

  try {
    const res = await fetch(`${aiUrl}/api/v1/ai/generate-brd`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: projectId,
        conversation_history: conversationHistory,
        project_category: project.category,
        budget_min: project.budgetMin,
        budget_max: project.budgetMax,
        timeline_days: project.estimatedTimelineDays,
      }),
    })
    if (res.ok) {
      const aiResponse = (await res.json()) as Record<string, Record<string, unknown>>
      brdData = (aiResponse.brd ??
        (aiResponse.data as Record<string, unknown>)?.brd ??
        {}) as Record<string, unknown>
    }
  } catch {
    // AI unavailable, create minimal BRD
    brdData = {
      executive_summary: `Proyek ${project.title}: ${project.description?.substring(0, 300) ?? ''}`,
      business_objectives: ['Selesaikan proyek sesuai kebutuhan'],
      scope: project.description ?? '',
    }
  }

  // B2: Calculate BRD price from AI estimate or use default
  const DEFAULT_BRD_PRICE = 99_000
  let brdPrice = DEFAULT_BRD_PRICE
  const estimatedMin = brdData.estimated_price_min as number | undefined
  const estimatedMax = brdData.estimated_price_max as number | undefined
  if (
    typeof estimatedMin === 'number' &&
    typeof estimatedMax === 'number' &&
    estimatedMin > 0 &&
    estimatedMax > 0
  ) {
    brdPrice = Math.round(((estimatedMin + estimatedMax) / 2) * 0.05)
    if (brdPrice < DEFAULT_BRD_PRICE) brdPrice = DEFAULT_BRD_PRICE
  }

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

  // Call AI service
  const aiUrl = process.env.AI_SERVICE_URL || 'http://localhost:3003'
  let prdData: Record<string, unknown> = {}

  try {
    const res = await fetch(`${aiUrl}/api/v1/ai/generate-prd`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: projectId,
        brd_content: brd?.content ?? {},
        project_category: project.category,
        budget_min: project.budgetMin,
        budget_max: project.budgetMax,
        timeline_days: project.estimatedTimelineDays,
      }),
    })
    if (res.ok) {
      const aiResponse = (await res.json()) as Record<string, Record<string, unknown>>
      prdData = (aiResponse.prd ??
        (aiResponse.data as Record<string, unknown>)?.prd ??
        {}) as Record<string, unknown>
    }
  } catch {
    prdData = { tech_stack: [], architecture: 'Standard web architecture', api_design: [] }
  }

  // Calculate PRD price from AI estimate or use default
  const DEFAULT_PRD_PRICE = 199_000
  let prdPrice = DEFAULT_PRD_PRICE
  const prdEstimatedMin = prdData.estimated_price_min as number | undefined
  const prdEstimatedMax = prdData.estimated_price_max as number | undefined
  if (
    typeof prdEstimatedMin === 'number' &&
    typeof prdEstimatedMax === 'number' &&
    prdEstimatedMin > 0 &&
    prdEstimatedMax > 0
  ) {
    prdPrice = Math.round(((prdEstimatedMin + prdEstimatedMax) / 2) * 0.08)
    if (prdPrice < DEFAULT_PRD_PRICE) prdPrice = DEFAULT_PRD_PRICE
  }

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
  const secret = process.env.SERVICE_AUTH_SECRET
  if (!secret || serviceAuth !== secret) {
    throw new AppError('AUTH_UNAUTHORIZED', 'Invalid service authentication')
  }

  const projectId = c.req.param('id')
  const body = await c.req.json()

  const parsed = paymentCallbackSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid payment callback data', {
      issues: parsed.error.flatten().fieldErrors,
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

    // Idempotency: skip if already paid
    if (brd.status === 'paid') {
      return c.json({ success: true, data: { processed: false, reason: 'already processed' } })
    }

    await db
      .update(brdDocuments)
      .set({ status: 'paid', updatedAt: new Date() })
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

    // Idempotency: skip if already paid
    if (prd.status === 'paid') {
      return c.json({ success: true, data: { processed: false, reason: 'already processed' } })
    }

    await db
      .update(prdDocuments)
      .set({ status: 'paid', updatedAt: new Date() })
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
      issues: parsed.error.flatten().fieldErrors,
    })
  }

  const user = getAuthUser(c)
  const db = getDb()

  // Verify ownership
  const [project] = await db
    .select({ ownerId: projectsTable.ownerId })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1)
  if (!project || project.ownerId !== user.id) {
    throw new AppError('AUTH_FORBIDDEN', 'Only the project owner can request BRD revision')
  }

  // Get BRD for this project
  const [brd] = await db
    .select()
    .from(brdDocuments)
    .where(eq(brdDocuments.projectId, projectId))
    .limit(1)

  if (!brd) {
    throw new AppError('NOT_FOUND', 'BRD document not found for this project')
  }

  // Check generation count (version tracks total generations)
  const currentVersion = brd.version ?? 1

  if (currentVersion >= FREE_BRD_GENERATIONS) {
    throw new AppError(
      'DOCUMENT_GENERATION_LIMIT',
      `Batas generasi BRD gratis (${FREE_BRD_GENERATIONS}x) sudah tercapai. Generasi tambahan memerlukan biaya.`,
    )
  }

  // Increment BRD version and set back to review
  await db
    .update(brdDocuments)
    .set({
      version: currentVersion + 1,
      status: 'review',
      updatedAt: new Date(),
    })
    .where(eq(brdDocuments.id, brd.id))

  return c.json({
    success: true,
    data: {
      generationsUsed: currentVersion + 1,
      freeGenerationsRemaining: Math.max(0, FREE_BRD_GENERATIONS - currentVersion - 1),
      requiresPayment: currentVersion + 1 >= FREE_BRD_GENERATIONS,
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
      issues: parsed.error.flatten().fieldErrors,
    })
  }

  const user = getAuthUser(c)
  const db = getDb()

  // Verify ownership
  const [project] = await db
    .select({ ownerId: projectsTable.ownerId })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1)
  if (!project || project.ownerId !== user.id) {
    throw new AppError('AUTH_FORBIDDEN', 'Only the project owner can request PRD revision')
  }

  // Get PRD for this project
  const [prd] = await db
    .select()
    .from(prdDocuments)
    .where(eq(prdDocuments.projectId, projectId))
    .limit(1)

  if (!prd) {
    throw new AppError('NOT_FOUND', 'PRD document not found for this project')
  }

  // Check generation count (version tracks total generations)
  const currentVersion = prd.version ?? 1

  if (currentVersion >= FREE_PRD_GENERATIONS) {
    throw new AppError(
      'DOCUMENT_GENERATION_LIMIT',
      `Batas generasi PRD gratis (${FREE_PRD_GENERATIONS}x) sudah tercapai. Generasi tambahan memerlukan biaya.`,
    )
  }

  // Increment PRD version and set back to review
  await db
    .update(prdDocuments)
    .set({
      version: currentVersion + 1,
      status: 'review',
      updatedAt: new Date(),
    })
    .where(eq(prdDocuments.id, prd.id))

  return c.json({
    success: true,
    data: {
      generationsUsed: currentVersion + 1,
      freeGenerationsRemaining: Math.max(0, FREE_PRD_GENERATIONS - currentVersion - 1),
      requiresPayment: currentVersion + 1 >= FREE_PRD_GENERATIONS,
    },
  })
})
