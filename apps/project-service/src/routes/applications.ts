import { getDb, outboxEvents, projectApplications, projects, talentProfiles } from '@kerjacus/db'
import { TALENT_SUBJECTS } from '@kerjacus/nats-events'
import { AppError } from '@kerjacus/shared'
import { and, desc, eq, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { uuidv7 } from 'uuidv7'
import { z } from 'zod'
import { getAuthUser } from '../middleware/session'

const applicationStatusValues = ['pending', 'accepted', 'rejected', 'withdrawn'] as const

const createApplicationSchema = z.object({
  projectId: z.string(),
  talentId: z.string(),
  coverNote: z.string().max(2000).optional(),
})

const updateStatusSchema = z.object({
  status: z.enum(applicationStatusValues),
})

export const applicationRoute = new Hono()

// POST / - talent applies
applicationRoute.post('/', async (c) => {
  const user = getAuthUser(c)
  const body = await c.req.json()

  const parsed = createApplicationSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid application data', {
      issues: parsed.error.flatten().fieldErrors,
    })
  }

  const db = getDb()

  // Verify the authenticated user owns the talent profile
  const [talent] = await db
    .select({ userId: talentProfiles.userId })
    .from(talentProfiles)
    .where(eq(talentProfiles.id, parsed.data.talentId))
    .limit(1)

  if (!talent || talent.userId !== user.id) {
    throw new AppError('AUTH_FORBIDDEN', 'Can only apply with your own talent profile')
  }

  // Prevent talent from applying to own project
  const [project] = await db
    .select({ ownerId: projects.ownerId })
    .from(projects)
    .where(eq(projects.id, parsed.data.projectId))
    .limit(1)

  if (!project) {
    throw new AppError('NOT_FOUND', 'Project not found')
  }

  if (talent.userId === project.ownerId) {
    throw new AppError('VALIDATION_ERROR', 'Tidak bisa melamar proyek sendiri')
  }

  // Check duplicate
  const [existing] = await db
    .select({ id: projectApplications.id })
    .from(projectApplications)
    .where(
      and(
        eq(projectApplications.projectId, parsed.data.projectId),
        eq(projectApplications.talentId, parsed.data.talentId),
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
      talentId: parsed.data.talentId,
      coverNote: parsed.data.coverNote ?? null,
      status: 'pending',
      recommendationScore: 0,
    })
    .returning()

  await db.insert(outboxEvents).values({
    id: uuidv7(),
    aggregateType: 'application',
    aggregateId: app.id,
    eventType: 'application.created',
    payload: {
      applicationId: app.id,
      projectId: parsed.data.projectId,
      talentId: parsed.data.talentId,
    },
  })

  return c.json({ success: true, data: app }, 201)
})

// GET /project/:projectId
applicationRoute.get('/project/:projectId', async (c) => {
  const user = getAuthUser(c)
  const projectId = c.req.param('projectId')
  const page = Number(c.req.query('page') ?? 1)
  const pageSize = Number(c.req.query('pageSize') ?? 20)
  const offset = (page - 1) * pageSize
  const db = getDb()

  // Verify user owns project or is an applicant
  const [project] = await db
    .select({ ownerId: projects.ownerId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)

  if (!project) {
    throw new AppError('NOT_FOUND', 'Project not found')
  }

  if (project.ownerId !== user.id) {
    // Check if user is a talent who applied
    const [talentProfile] = await db
      .select({ id: talentProfiles.id })
      .from(talentProfiles)
      .where(eq(talentProfiles.userId, user.id))
      .limit(1)

    if (!talentProfile) {
      throw new AppError('AUTH_FORBIDDEN', 'Not authorized')
    }

    const [application] = await db
      .select({ id: projectApplications.id })
      .from(projectApplications)
      .where(
        and(
          eq(projectApplications.projectId, projectId),
          eq(projectApplications.talentId, talentProfile.id),
        ),
      )
      .limit(1)

    if (!application) {
      throw new AppError('AUTH_FORBIDDEN', 'Not authorized')
    }
  }

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

// GET /talent/:talentId
applicationRoute.get('/talent/:talentId', async (c) => {
  const user = getAuthUser(c)
  const talentId = c.req.param('talentId')
  const page = Number(c.req.query('page') ?? 1)
  const pageSize = Number(c.req.query('pageSize') ?? 20)
  const offset = (page - 1) * pageSize
  const db = getDb()

  // Verify user is the talent or an admin
  const [talentProfile] = await db
    .select({ userId: talentProfiles.userId })
    .from(talentProfiles)
    .where(eq(talentProfiles.id, talentId))
    .limit(1)

  if (!talentProfile) {
    throw new AppError('NOT_FOUND', 'Talent profile not found')
  }

  if (talentProfile.userId !== user.id && user.role !== 'admin') {
    throw new AppError('AUTH_FORBIDDEN', 'Not authorized')
  }

  const [items, countResult] = await Promise.all([
    db
      .select()
      .from(projectApplications)
      .where(eq(projectApplications.talentId, talentId))
      .orderBy(desc(projectApplications.createdAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(projectApplications)
      .where(eq(projectApplications.talentId, talentId)),
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
  const user = getAuthUser(c)
  const id = c.req.param('id')
  const body = await c.req.json()

  const parsed = updateStatusSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid status', {
      issues: parsed.error.flatten().fieldErrors,
    })
  }

  const db = getDb()
  const newStatus = parsed.data.status

  // Fetch application to verify authorization
  const [app] = await db
    .select()
    .from(projectApplications)
    .where(eq(projectApplications.id, id))
    .limit(1)

  if (!app) {
    throw new AppError('NOT_FOUND', 'Application not found')
  }

  if (newStatus === 'withdrawn') {
    // Only the applicant talent can withdraw
    const [talentProfile] = await db
      .select({ userId: talentProfiles.userId })
      .from(talentProfiles)
      .where(eq(talentProfiles.id, app.talentId))
      .limit(1)
    if (!talentProfile || talentProfile.userId !== user.id) {
      throw new AppError('AUTH_FORBIDDEN', 'Only the applicant can withdraw')
    }
  } else {
    // Accept/reject: only project owner can do this
    const [project] = await db
      .select({ ownerId: projects.ownerId })
      .from(projects)
      .where(eq(projects.id, app.projectId))
      .limit(1)
    if (!project || project.ownerId !== user.id) {
      throw new AppError(
        'AUTH_FORBIDDEN',
        'Only the project owner can accept or reject applications',
      )
    }
  }

  const updated = await db.transaction(async (tx) => {
    const [result] = await tx
      .update(projectApplications)
      .set({ status: newStatus, updatedAt: new Date() })
      .where(eq(projectApplications.id, id))
      .returning()

    if (!result) {
      throw new AppError('NOT_FOUND', 'Application not found')
    }

    const eventType =
      newStatus === 'accepted'
        ? TALENT_SUBJECTS.ASSIGNMENT_ACCEPTED
        : newStatus === 'rejected'
          ? TALENT_SUBJECTS.ASSIGNMENT_DECLINED
          : `application.status.${newStatus}`

    await tx.insert(outboxEvents).values({
      id: uuidv7(),
      aggregateType: 'application',
      aggregateId: id,
      eventType,
      payload: {
        applicationId: id,
        projectId: result.projectId,
        talentId: result.talentId,
        status: newStatus,
      },
    })

    return result
  })

  return c.json({ success: true, data: updated })
})
