import { getDb, projectApplications } from '@bytz/db'
import { AppError } from '@bytz/shared'
import { and, desc, eq, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { uuidv7 } from 'uuidv7'
import { z } from 'zod'

const applicationStatusValues = ['pending', 'accepted', 'rejected', 'withdrawn'] as const

const createApplicationSchema = z.object({
  projectId: z.string(),
  workerId: z.string(),
  coverNote: z.string().max(2000).optional(),
})

const updateStatusSchema = z.object({
  status: z.enum(applicationStatusValues),
})

export const applicationRoute = new Hono()

// POST / - worker applies
applicationRoute.post('/', async (c) => {
  const body = await c.req.json()

  const parsed = createApplicationSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid application data', {
      issues: parsed.error.flatten().fieldErrors,
    })
  }

  const db = getDb()

  // Check duplicate
  const [existing] = await db
    .select({ id: projectApplications.id })
    .from(projectApplications)
    .where(
      and(
        eq(projectApplications.projectId, parsed.data.projectId),
        eq(projectApplications.workerId, parsed.data.workerId),
      ),
    )
    .limit(1)

  if (existing) {
    throw new AppError('CONFLICT', 'Already applied to this project')
  }

  const id = uuidv7()
  const [app] = await db
    .insert(projectApplications)
    .values({
      id,
      projectId: parsed.data.projectId,
      workerId: parsed.data.workerId,
      coverNote: parsed.data.coverNote ?? null,
      status: 'pending',
      recommendationScore: 0,
    })
    .returning()

  return c.json({ success: true, data: app }, 201)
})

// GET /project/:projectId
applicationRoute.get('/project/:projectId', async (c) => {
  const projectId = c.req.param('projectId')
  const page = Number(c.req.query('page') ?? 1)
  const pageSize = Number(c.req.query('pageSize') ?? 20)
  const offset = (page - 1) * pageSize
  const db = getDb()

  const [items, countResult] = await Promise.all([
    db
      .select()
      .from(projectApplications)
      .where(eq(projectApplications.projectId, projectId))
      .orderBy(desc(projectApplications.createdAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(projectApplications)
      .where(eq(projectApplications.projectId, projectId)),
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

// GET /worker/:workerId
applicationRoute.get('/worker/:workerId', async (c) => {
  const workerId = c.req.param('workerId')
  const page = Number(c.req.query('page') ?? 1)
  const pageSize = Number(c.req.query('pageSize') ?? 20)
  const offset = (page - 1) * pageSize
  const db = getDb()

  const [items, countResult] = await Promise.all([
    db
      .select()
      .from(projectApplications)
      .where(eq(projectApplications.workerId, workerId))
      .orderBy(desc(projectApplications.createdAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(projectApplications)
      .where(eq(projectApplications.workerId, workerId)),
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

// PATCH /:id - update status
applicationRoute.patch('/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()

  const parsed = updateStatusSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid status', {
      issues: parsed.error.flatten().fieldErrors,
    })
  }

  const db = getDb()
  const [updated] = await db
    .update(projectApplications)
    .set({ status: parsed.data.status, updatedAt: new Date() })
    .where(eq(projectApplications.id, id))
    .returning()

  if (!updated) {
    throw new AppError('NOT_FOUND', 'Application not found')
  }

  return c.json({ success: true, data: updated })
})
