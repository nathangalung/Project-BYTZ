import {
  getDb,
  projectActivities,
  projectAssignments,
  projects,
  talentProfiles,
} from '@kerjacus/db'
import { AppError } from '@kerjacus/shared'
import { desc, eq, inArray, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { assertProjectAccess } from '../lib/project-access'
import { getAuthUser } from '../middleware/session'

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  limit: z.coerce.number().int().positive().max(100).optional(),
})

export const activityRoute = new Hono()

// GET / — global recent activities with project title
activityRoute.get('/', async (c) => {
  const parsed = listQuerySchema.safeParse(c.req.query())
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid query parameters', {
      issues: z.flattenError(parsed.error).fieldErrors,
    })
  }

  const { page, pageSize, limit } = parsed.data
  const effectiveLimit = limit ?? pageSize
  const offset = (page - 1) * effectiveLimit
  const db = getDb()
  const user = getAuthUser(c)

  // Only projects the caller owns or is assigned to. Unscoped this was every
  // activity on the platform, which also handed out the project ids needed to
  // reach the per-project routes.
  const visibleProjectIds = sql`(
    SELECT ${projects.id} FROM ${projects} WHERE ${projects.ownerId} = ${user.id}
    UNION
    SELECT ${projectAssignments.projectId} FROM ${projectAssignments}
    JOIN ${talentProfiles} ON ${talentProfiles.id} = ${projectAssignments.talentId}
    WHERE ${talentProfiles.userId} = ${user.id}
  )`
  const scope = inArray(projectActivities.projectId, visibleProjectIds)

  const [items, countResult] = await Promise.all([
    db
      .select({
        id: projectActivities.id,
        projectId: projectActivities.projectId,
        userId: projectActivities.userId,
        type: projectActivities.type,
        title: projectActivities.title,
        metadata: projectActivities.metadata,
        createdAt: projectActivities.createdAt,
        projectTitle: projects.title,
      })
      .from(projectActivities)
      .leftJoin(projects, eq(projectActivities.projectId, projects.id))
      .where(scope)
      .orderBy(desc(projectActivities.createdAt))
      .limit(effectiveLimit)
      .offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(projectActivities).where(scope),
  ])

  return c.json({
    success: true,
    data: {
      items,
      total: countResult[0]?.count ?? 0,
      page,
      pageSize: effectiveLimit,
    },
  })
})

// GET /project/:projectId
activityRoute.get('/project/:projectId', async (c) => {
  const projectId = c.req.param('projectId')
  // Payment and staffing history for one project.
  await assertProjectAccess(projectId, getAuthUser(c).id)
  const parsed = listQuerySchema.safeParse(c.req.query())
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid query parameters', {
      issues: z.flattenError(parsed.error).fieldErrors,
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
