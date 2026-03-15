import { getDb, projects as projectsTable } from '@bytz/db'
import {
  AppError,
  createProjectSchema,
  type ProjectCategory,
  type ProjectStatus,
} from '@bytz/shared'
import { and, desc, eq, inArray, isNull, type SQL, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
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
  clientId: z.string().uuid().optional(),
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

  const conditions: SQL[] = [
    inArray(projectsTable.status, [
      'matching',
      'team_forming',
      'in_progress',
      'review',
      'completed',
    ]),
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

  return c.json({ success: true, data: { items, total: count, page, pageSize } })
})

// GET /projects/available — worker discovery
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

  const { status, category, clientId, page, pageSize } = parsed.data
  const service = getService()

  const result = await service.listProjects(
    {
      status: status as ProjectStatus | undefined,
      category: category as ProjectCategory | undefined,
      clientId,
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

  return c.json({
    success: true,
    data: project,
  })
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

  // TODO: extract clientId from authenticated session
  const clientId = c.req.header('X-User-ID')
  if (!clientId) {
    throw new AppError('AUTH_UNAUTHORIZED', 'User ID is required')
  }

  const service = getService()
  const project = await service.createProject(clientId, parsed.data)

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

  // TODO: extract userId from authenticated session
  const userId = c.req.header('X-User-ID')
  if (!userId) {
    throw new AppError('AUTH_UNAUTHORIZED', 'User ID is required')
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

  // TODO: extract userId from authenticated session
  const userId = c.req.header('X-User-ID')
  if (!userId) {
    throw new AppError('AUTH_UNAUTHORIZED', 'User ID is required')
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
