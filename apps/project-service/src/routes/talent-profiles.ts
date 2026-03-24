import {
  getDb,
  outboxEvents,
  projectAssignments,
  projects,
  skills,
  talentProfiles,
  talentSkills,
} from '@kerjacus/db'
import { AppError } from '@kerjacus/shared'
import { and, eq, inArray } from 'drizzle-orm'
import { Hono } from 'hono'
import { uuidv7 } from 'uuidv7'
import { z } from 'zod'
import { getAuthUser } from '../middleware/session'

const proficiencyValues = ['beginner', 'intermediate', 'advanced', 'expert'] as const

const availabilityValues = ['available', 'busy', 'unavailable'] as const

const createProfileSchema = z.object({
  userId: z.string(),
  bio: z.string().max(2000).optional(),
  yearsOfExperience: z.number().int().nonnegative(),
  educationUniversity: z.string().max(255).optional(),
  educationMajor: z.string().max(255).optional(),
  educationYear: z.number().int().optional(),
  skills: z
    .array(
      z.object({
        name: z.string(),
        proficiencyLevel: z.enum(proficiencyValues),
        isPrimary: z.boolean().default(false),
      }),
    )
    .optional(),
  portfolioLinks: z.array(z.object({ platform: z.string(), url: z.string() })).optional(),
  domainExpertise: z.array(z.string()).optional(),
})

const updateAvailabilitySchema = z.object({
  availability: z.enum(availabilityValues),
})

export const talentProfileRoute = new Hono()

// POST / - create or update profile
talentProfileRoute.post('/', async (c) => {
  const body = await c.req.json()

  const parsed = createProfileSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid profile data', {
      issues: parsed.error.flatten().fieldErrors,
    })
  }

  // Verify the authenticated user matches the profile being created
  const user = getAuthUser(c)
  if (parsed.data.userId !== user.id) {
    throw new AppError('AUTH_FORBIDDEN', 'Cannot create profile for another user')
  }

  const db = getDb()
  const data = parsed.data

  // Check existing profile
  const [existing] = await db
    .select({ id: talentProfiles.id })
    .from(talentProfiles)
    .where(eq(talentProfiles.userId, data.userId))
    .limit(1)

  let profileId: string

  if (existing) {
    await db
      .update(talentProfiles)
      .set({
        bio: data.bio,
        yearsOfExperience: data.yearsOfExperience,
        educationUniversity: data.educationUniversity,
        educationMajor: data.educationMajor,
        educationYear: data.educationYear,
        portfolioLinks: data.portfolioLinks,
        domainExpertise: data.domainExpertise,
        verificationStatus: 'unverified',
        updatedAt: new Date(),
      })
      .where(eq(talentProfiles.id, existing.id))
    profileId = existing.id
  } else {
    profileId = uuidv7()
    await db.insert(talentProfiles).values({
      id: profileId,
      userId: data.userId,
      bio: data.bio,
      yearsOfExperience: data.yearsOfExperience,
      educationUniversity: data.educationUniversity,
      educationMajor: data.educationMajor,
      educationYear: data.educationYear,
      portfolioLinks: data.portfolioLinks,
      domainExpertise: data.domainExpertise,
      verificationStatus: 'unverified',
    })
  }

  // Upsert skills
  if (data.skills?.length) {
    await db.delete(talentSkills).where(eq(talentSkills.talentId, profileId))
    for (const s of data.skills) {
      const [skill] = await db
        .select({ id: skills.id })
        .from(skills)
        .where(eq(skills.name, s.name))
        .limit(1)
      if (skill) {
        await db
          .insert(talentSkills)
          .values({
            talentId: profileId,
            skillId: skill.id,
            proficiencyLevel: s.proficiencyLevel,
            isPrimary: s.isPrimary,
          })
          .onConflictDoNothing()
      }
    }
  }

  await db.insert(outboxEvents).values({
    id: uuidv7(),
    aggregateType: 'talent',
    aggregateId: profileId,
    eventType: 'talent.registered',
    payload: { talentId: profileId, userId: parsed.data.userId },
  })

  return c.json({ success: true, data: { profileId } }, 201)
})

// GET /user/:userId - profile by user ID
talentProfileRoute.get('/user/:userId', async (c) => {
  const userId = c.req.param('userId')
  const db = getDb()

  const [profile] = await db
    .select()
    .from(talentProfiles)
    .where(eq(talentProfiles.userId, userId))
    .limit(1)

  if (!profile) {
    throw new AppError('NOT_FOUND', 'Talent profile not found')
  }

  return c.json({ success: true, data: profile })
})

// PATCH /:id/availability
talentProfileRoute.patch('/:id/availability', async (c) => {
  const user = getAuthUser(c)
  const id = c.req.param('id')
  const body = await c.req.json()

  const parsed = updateAvailabilitySchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid availability', {
      issues: parsed.error.flatten().fieldErrors,
    })
  }

  // Verify user owns this talent profile
  const db = getDb()
  const [profile] = await db
    .select({ userId: talentProfiles.userId })
    .from(talentProfiles)
    .where(eq(talentProfiles.id, id))
    .limit(1)

  if (!profile || profile.userId !== user.id) {
    throw new AppError('AUTH_FORBIDDEN', 'Can only update your own availability')
  }

  const [updated] = await db
    .update(talentProfiles)
    .set({
      availabilityStatus: parsed.data.availability,
      updatedAt: new Date(),
    })
    .where(eq(talentProfiles.id, id))
    .returning()

  if (!updated) {
    throw new AppError('NOT_FOUND', 'Profile not found')
  }

  await db.insert(outboxEvents).values({
    id: uuidv7(),
    aggregateType: 'talent',
    aggregateId: id,
    eventType: 'talent.availability_changed',
    payload: { talentId: id, availability: parsed.data.availability },
  })

  return c.json({ success: true, data: updated })
})

// GET /:id/active-projects
talentProfileRoute.get('/:id/active-projects', async (c) => {
  const profileId = c.req.param('id')
  const db = getDb()

  const activeStatuses = ['in_progress', 'review', 'partially_active'] as const

  const assignments = await db
    .select({
      projectId: projectAssignments.projectId,
      roleLabel: projectAssignments.roleLabel,
      status: projectAssignments.status,
    })
    .from(projectAssignments)
    .where(and(eq(projectAssignments.talentId, profileId), eq(projectAssignments.status, 'active')))

  if (assignments.length === 0) {
    return c.json({ success: true, data: [] })
  }

  const projectIds = assignments.map((a) => a.projectId)
  const activeProjects = await db
    .select({
      id: projects.id,
      title: projects.title,
      status: projects.status,
      category: projects.category,
    })
    .from(projects)
    .where(and(inArray(projects.id, projectIds), inArray(projects.status, activeStatuses)))

  return c.json({ success: true, data: activeProjects })
})
