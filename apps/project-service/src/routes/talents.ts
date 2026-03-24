import { getDb, reviews, skills, talentProfiles, talentSkills } from '@kerjacus/db'
import { AppError } from '@kerjacus/shared'
import { and, desc, eq, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'

const availabilityValues = ['available', 'busy', 'unavailable'] as const

const listTalentsQuerySchema = z.object({
  skill: z.string().optional(),
  availability: z.enum(availabilityValues).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
})

export const talentRoute = new Hono()

// GET / - list talents with filters
talentRoute.get('/', async (c) => {
  const parsed = listTalentsQuerySchema.safeParse(c.req.query())
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
    conditions.push(eq(talentProfiles.availabilityStatus, availability))
  }
  conditions.push(eq(talentProfiles.verificationStatus, 'verified'))

  let query = db
    .select({
      id: talentProfiles.id,
      bio: talentProfiles.bio,
      yearsOfExperience: talentProfiles.yearsOfExperience,
      availabilityStatus: talentProfiles.availabilityStatus,
      verificationStatus: talentProfiles.verificationStatus,
      domainExpertise: talentProfiles.domainExpertise,
      totalProjectsCompleted: talentProfiles.totalProjectsCompleted,
      totalProjectsActive: talentProfiles.totalProjectsActive,
      portfolioLinks: talentProfiles.portfolioLinks,
      createdAt: talentProfiles.createdAt,
    })
    .from(talentProfiles)
    .$dynamic()

  // Filter by skill via join
  if (skill) {
    query = query
      .innerJoin(talentSkills, eq(talentSkills.talentId, talentProfiles.id))
      .innerJoin(skills, eq(skills.id, talentSkills.skillId))
      .where(and(...conditions, eq(skills.name, skill)))
  } else {
    query = query.where(conditions.length > 0 ? and(...conditions) : undefined)
  }

  const talents = await query.limit(pageSize).offset(offset)

  // Count total (apply same filters as items query)
  let countQuery = db.select({ count: sql<number>`count(*)::int` }).from(talentProfiles).$dynamic()

  if (skill) {
    countQuery = countQuery
      .innerJoin(talentSkills, eq(talentSkills.talentId, talentProfiles.id))
      .innerJoin(skills, eq(skills.id, talentSkills.skillId))
      .where(and(...conditions, eq(skills.name, skill)))
  } else {
    countQuery = countQuery.where(conditions.length > 0 ? and(...conditions) : undefined)
  }

  const [{ count: total }] = await countQuery

  return c.json({
    success: true,
    data: {
      items: talents,
      total,
      page,
      pageSize,
    },
  })
})

// GET /:id - anonymous talent profile
talentRoute.get('/:id', async (c) => {
  const id = c.req.param('id')
  const db = getDb()

  const [talent] = await db
    .select({
      id: talentProfiles.id,
      bio: talentProfiles.bio,
      yearsOfExperience: talentProfiles.yearsOfExperience,
      educationUniversity: talentProfiles.educationUniversity,
      educationMajor: talentProfiles.educationMajor,
      availabilityStatus: talentProfiles.availabilityStatus,
      verificationStatus: talentProfiles.verificationStatus,
      domainExpertise: talentProfiles.domainExpertise,
      totalProjectsCompleted: talentProfiles.totalProjectsCompleted,
      totalProjectsActive: talentProfiles.totalProjectsActive,
      portfolioLinks: talentProfiles.portfolioLinks,
      createdAt: talentProfiles.createdAt,
    })
    .from(talentProfiles)
    .where(eq(talentProfiles.id, id))
    .limit(1)

  if (!talent) {
    throw new AppError('TALENT_NOT_FOUND', 'Talent not found')
  }

  return c.json({
    success: true,
    data: talent,
  })
})

// GET /:id/skills - talent skills
talentRoute.get('/:id/skills', async (c) => {
  const id = c.req.param('id')
  const db = getDb()

  // Verify talent exists
  const [talent] = await db
    .select({ id: talentProfiles.id })
    .from(talentProfiles)
    .where(eq(talentProfiles.id, id))
    .limit(1)

  if (!talent) {
    throw new AppError('TALENT_NOT_FOUND', 'Talent not found')
  }

  const talentSkillRows = await db
    .select({
      skillId: talentSkills.skillId,
      proficiencyLevel: talentSkills.proficiencyLevel,
      isPrimary: talentSkills.isPrimary,
      skillName: skills.name,
      skillCategory: skills.category,
    })
    .from(talentSkills)
    .innerJoin(skills, eq(skills.id, talentSkills.skillId))
    .where(eq(talentSkills.talentId, id))

  return c.json({
    success: true,
    data: talentSkillRows,
  })
})

// GET /ratings — talent's own ratings (internal)
talentRoute.get('/ratings', async (c) => {
  const userId = c.req.query('userId')
  if (!userId) {
    return c.json({ success: true, data: [] })
  }

  const db = getDb()

  const [profile] = await db
    .select({ id: talentProfiles.id })
    .from(talentProfiles)
    .where(eq(talentProfiles.userId, userId))
    .limit(1)

  if (!profile) {
    return c.json({ success: true, data: [] })
  }

  const talentReviews = await db
    .select({
      id: reviews.id,
      rating: reviews.rating,
      comment: reviews.comment,
      type: reviews.type,
      createdAt: reviews.createdAt,
    })
    .from(reviews)
    .where(eq(reviews.revieweeId, userId))
    .orderBy(desc(reviews.createdAt))
    .limit(20)

  return c.json({ success: true, data: talentReviews })
})
