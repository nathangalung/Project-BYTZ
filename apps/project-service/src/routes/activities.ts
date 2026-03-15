import { getDb, projectActivities } from '@bytz/db'
import { AppError } from '@bytz/shared'
import { desc, eq, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
})

export const activityRoute = new Hono()

// GET /project/:projectId
activityRoute.get('/project/:projectId', async (c) => {
  const projectId = c.req.param('projectId')
  const parsed = listQuerySchema.safeParse(c.req.query())
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid query parameters', {
      issues: parsed.error.flatten().fieldErrors,
    })
  }

  const { page, pageSize } = parsed.data
  const offset = (page - 1) * pageSize
  const db = getDb()

  const [items, countResult] = await Promise.all([
    db
      .select()
      .from(projectActivities)
      .where(eq(projectActivities.projectId, projectId))
      .orderBy(desc(projectActivities.createdAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(projectActivities)
      .where(eq(projectActivities.projectId, projectId)),
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
