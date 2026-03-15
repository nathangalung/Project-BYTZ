import { getDb, skills, workerProfiles, workerSkills } from '@bytz/db'
import { AppError } from '@bytz/shared'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'

const availabilityValues = ['available', 'busy', 'unavailable'] as const

const listWorkersQuerySchema = z.object({
  skill: z.string().optional(),
  availability: z.enum(availabilityValues).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
})

export const workerRoute = new Hono()

// GET / - list workers with filters
workerRoute.get('/', async (c) => {
  const parsed = listWorkersQuerySchema.safeParse(c.req.query())
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid query parameters', {
      issues: parsed.error.flatten().fieldErrors,
    })
  }

  const { skill, availability, page, pageSize } = parsed.data
  const db = getDb()
  const offset = (page - 1) * pageSize

  // Build conditions
  const conditions = []
  if (availability) {
    conditions.push(eq(workerProfiles.availabilityStatus, availability))
  }
  conditions.push(eq(workerProfiles.verificationStatus, 'verified'))

  let query = db
    .select({
      id: workerProfiles.id,
      userId: workerProfiles.userId,
      bio: workerProfiles.bio,
      yearsOfExperience: workerProfiles.yearsOfExperience,
      availabilityStatus: workerProfiles.availabilityStatus,
      verificationStatus: workerProfiles.verificationStatus,
      domainExpertise: workerProfiles.domainExpertise,
      totalProjectsCompleted: workerProfiles.totalProjectsCompleted,
      totalProjectsActive: workerProfiles.totalProjectsActive,
      portfolioLinks: workerProfiles.portfolioLinks,
      createdAt: workerProfiles.createdAt,
    })
    .from(workerProfiles)
    .$dynamic()

  // Filter by skill via join
  if (skill) {
    query = query
      .innerJoin(workerSkills, eq(workerSkills.workerId, workerProfiles.id))
      .innerJoin(skills, eq(skills.id, workerSkills.skillId))
      .where(and(...conditions, eq(skills.name, skill)))
  } else {
    query = query.where(conditions.length > 0 ? and(...conditions) : undefined)
  }

  const workers = await query.limit(pageSize).offset(offset)

  // Count total
  const countResult = await db
    .select({ id: workerProfiles.id })
    .from(workerProfiles)
    .where(eq(workerProfiles.verificationStatus, 'verified'))

  return c.json({
    success: true,
    data: {
      items: workers,
      total: countResult.length,
      page,
      pageSize,
    },
  })
})

// GET /:id - anonymous worker profile
workerRoute.get('/:id', async (c) => {
  const id = c.req.param('id')
  const db = getDb()

  const [worker] = await db
    .select({
      id: workerProfiles.id,
      bio: workerProfiles.bio,
      yearsOfExperience: workerProfiles.yearsOfExperience,
      educationUniversity: workerProfiles.educationUniversity,
      educationMajor: workerProfiles.educationMajor,
      availabilityStatus: workerProfiles.availabilityStatus,
      verificationStatus: workerProfiles.verificationStatus,
      domainExpertise: workerProfiles.domainExpertise,
      totalProjectsCompleted: workerProfiles.totalProjectsCompleted,
      totalProjectsActive: workerProfiles.totalProjectsActive,
      portfolioLinks: workerProfiles.portfolioLinks,
      createdAt: workerProfiles.createdAt,
    })
    .from(workerProfiles)
    .where(eq(workerProfiles.id, id))
    .limit(1)

  if (!worker) {
    throw new AppError('WORKER_NOT_FOUND', 'Worker not found')
  }

  return c.json({
    success: true,
    data: worker,
  })
})

// GET /:id/skills - worker skills
workerRoute.get('/:id/skills', async (c) => {
  const id = c.req.param('id')
  const db = getDb()

  // Verify worker exists
  const [worker] = await db
    .select({ id: workerProfiles.id })
    .from(workerProfiles)
    .where(eq(workerProfiles.id, id))
    .limit(1)

  if (!worker) {
    throw new AppError('WORKER_NOT_FOUND', 'Worker not found')
  }

  const workerSkillRows = await db
    .select({
      skillId: workerSkills.skillId,
      proficiencyLevel: workerSkills.proficiencyLevel,
      isPrimary: workerSkills.isPrimary,
      skillName: skills.name,
      skillCategory: skills.category,
    })
    .from(workerSkills)
    .innerJoin(skills, eq(skills.id, workerSkills.skillId))
    .where(eq(workerSkills.workerId, id))

  return c.json({
    success: true,
    data: workerSkillRows,
  })
})
