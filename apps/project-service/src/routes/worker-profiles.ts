import { getDb, skills, workerProfiles, workerSkills } from '@bytz/db'
import { AppError } from '@bytz/shared'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { uuidv7 } from 'uuidv7'
import { z } from 'zod'

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

export const workerProfileRoute = new Hono()

// POST / - create or update profile
workerProfileRoute.post('/', async (c) => {
  const body = await c.req.json()

  const parsed = createProfileSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid profile data', {
      issues: parsed.error.flatten().fieldErrors,
    })
  }

  const db = getDb()
  const data = parsed.data

  // Check existing profile
  const [existing] = await db
    .select({ id: workerProfiles.id })
    .from(workerProfiles)
    .where(eq(workerProfiles.userId, data.userId))
    .limit(1)

  let profileId: string

  if (existing) {
    await db
      .update(workerProfiles)
      .set({
        bio: data.bio,
        yearsOfExperience: data.yearsOfExperience,
        educationUniversity: data.educationUniversity,
        educationMajor: data.educationMajor,
        educationYear: data.educationYear,
        portfolioLinks: data.portfolioLinks,
        domainExpertise: data.domainExpertise,
        verificationStatus: 'verified',
        updatedAt: new Date(),
      })
      .where(eq(workerProfiles.id, existing.id))
    profileId = existing.id
  } else {
    profileId = uuidv7()
    await db.insert(workerProfiles).values({
      id: profileId,
      userId: data.userId,
      bio: data.bio,
      yearsOfExperience: data.yearsOfExperience,
      educationUniversity: data.educationUniversity,
      educationMajor: data.educationMajor,
      educationYear: data.educationYear,
      portfolioLinks: data.portfolioLinks,
      domainExpertise: data.domainExpertise,
      verificationStatus: 'verified',
    })
  }

  // Upsert skills
  if (data.skills?.length) {
    await db.delete(workerSkills).where(eq(workerSkills.workerId, profileId))
    for (const s of data.skills) {
      const [skill] = await db
        .select({ id: skills.id })
        .from(skills)
        .where(eq(skills.name, s.name))
        .limit(1)
      if (skill) {
        await db
          .insert(workerSkills)
          .values({
            workerId: profileId,
            skillId: skill.id,
            proficiencyLevel: s.proficiencyLevel,
            isPrimary: s.isPrimary,
          })
          .onConflictDoNothing()
      }
    }
  }

  return c.json({ success: true, data: { profileId } }, 201)
})

// GET /user/:userId - profile by user ID
workerProfileRoute.get('/user/:userId', async (c) => {
  const userId = c.req.param('userId')
  const db = getDb()

  const [profile] = await db
    .select()
    .from(workerProfiles)
    .where(eq(workerProfiles.userId, userId))
    .limit(1)

  if (!profile) {
    throw new AppError('NOT_FOUND', 'Worker profile not found')
  }

  return c.json({ success: true, data: profile })
})

// PATCH /:id/availability
workerProfileRoute.patch('/:id/availability', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()

  const parsed = updateAvailabilitySchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid availability', {
      issues: parsed.error.flatten().fieldErrors,
    })
  }

  const db = getDb()
  const [updated] = await db
    .update(workerProfiles)
    .set({
      availabilityStatus: parsed.data.availability,
      updatedAt: new Date(),
    })
    .where(eq(workerProfiles.id, id))
    .returning()

  if (!updated) {
    throw new AppError('NOT_FOUND', 'Profile not found')
  }

  return c.json({ success: true, data: updated })
})
