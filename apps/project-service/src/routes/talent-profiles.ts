import {
  getDb,
  milestones,
  projectAssignments,
  projects,
  skills,
  talentProfiles,
} from '@kerjacus/db'
import { AppError } from '@kerjacus/shared'
import { and, eq, inArray, or, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { uuidv7 } from 'uuidv7'
import { z } from 'zod'
import { appendOutboxEvent } from '../lib/outbox'
import { PUBLIC_TALENT_COLUMNS } from '../lib/talent-visibility'
import { getAuthUser } from '../middleware/session'
import { TalentProfileRepository } from '../repositories/talent-profile.repository'

// Resolve a skill name to the taxonomy by exact/case-insensitive name or alias,
// capturing a genuinely new one rather than dropping it. Matching fuzzy-matches
// at recommend time, so a captured skill stays reachable.
async function resolveSkillId(db: ReturnType<typeof getDb>, name: string): Promise<string | null> {
  const trimmed = name.trim()
  // skills.name is varchar(100); drop a pathological long value rather than
  // failing the whole profile save on the insert.
  if (!trimmed || trimmed.length > 100) return null
  const [existing] = await db
    .select({ id: skills.id })
    .from(skills)
    .where(
      or(
        sql`lower(${skills.name}) = lower(${trimmed})`,
        sql`${skills.aliases} is not null and exists (
          select 1 from jsonb_array_elements_text(${skills.aliases}) alias
          where lower(alias) = lower(${trimmed})
        )`,
      ),
    )
    .limit(1)
  if (existing) return existing.id
  const id = uuidv7()
  await db
    .insert(skills)
    .values({ id, name: trimmed, category: 'other', aliases: [] })
    .onConflictDoNothing()
  const [created] = await db
    .select({ id: skills.id })
    .from(skills)
    .where(sql`lower(${skills.name}) = lower(${trimmed})`)
    .limit(1)
  return created?.id ?? null
}

const proficiencyValues = ['beginner', 'intermediate', 'advanced', 'expert'] as const

const availabilityValues = ['available', 'busy', 'unavailable'] as const

const createProfileSchema = z.object({
  userId: z.string(),
  bio: z.string().max(2000).optional(),
  location: z.string().max(255).optional(),
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
      issues: z.flattenError(parsed.error).fieldErrors,
    })
  }

  // Verify the authenticated user matches the profile being created
  const user = getAuthUser(c)
  if (parsed.data.userId !== user.id) {
    throw new AppError('AUTH_FORBIDDEN', 'Cannot create profile for another user')
  }

  const db = getDb()
  const data = parsed.data
  const repo = new TalentProfileRepository(db)

  const existing = await repo.findByUserId(data.userId)

  // Resolve the taxonomy before opening the write. These are reads that can
  // miss, and holding a transaction across them would lock for the whole
  // resolution rather than for the write it protects.
  let skills:
    | Array<{
        skillId: string
        proficiencyLevel: 'beginner' | 'intermediate' | 'advanced' | 'expert'
        isPrimary: boolean
      }>
    | undefined
  if (data.skills?.length) {
    skills = []
    for (const s of data.skills) {
      const skillId = await resolveSkillId(db, s.name)
      if (skillId) {
        skills.push({
          skillId,
          proficiencyLevel: s.proficiencyLevel,
          isPrimary: s.isPrimary,
        })
      }
    }
  }

  // Verification comes from CV parsing. Editing a bio is not grounds to
  // revoke it, and resetting it here dropped the talent out of matching and
  // the directory silently - so the update deliberately omits it.
  const profileId = await repo.save(
    {
      userId: data.userId,
      bio: data.bio,
      location: data.location,
      yearsOfExperience: data.yearsOfExperience,
      educationUniversity: data.educationUniversity,
      educationMajor: data.educationMajor,
      educationYear: data.educationYear,
      portfolioLinks: data.portfolioLinks,
      domainExpertise: data.domainExpertise,
    },
    existing?.id,
    skills,
  )

  return c.json({ success: true, data: { profileId } }, 201)
})

// GET /me - current user's talent profile (for auth check)
talentProfileRoute.get('/me', async (c) => {
  const user = getAuthUser(c)
  const db = getDb()

  const [profile] = await db
    .select({
      id: talentProfiles.id,
      userId: talentProfiles.userId,
      verificationStatus: talentProfiles.verificationStatus,
      bio: talentProfiles.bio,
      yearsOfExperience: talentProfiles.yearsOfExperience,
      availabilityStatus: talentProfiles.availabilityStatus,
    })
    .from(talentProfiles)
    .where(eq(talentProfiles.userId, user.id))
    .limit(1)

  if (!profile) {
    return c.json({ success: true, data: null })
  }

  return c.json({ success: true, data: profile })
})

// GET /user/:userId - profile by user ID
talentProfileRoute.get('/user/:userId', async (c) => {
  const userId = c.req.param('userId')
  const viewer = getAuthUser(c)
  const db = getDb()

  // Own profile in full, anyone else's without the internal columns.
  const columns = viewer.id === userId ? undefined : PUBLIC_TALENT_COLUMNS

  const [profile] = await (columns ? db.select(columns) : db.select())
    .from(talentProfiles)
    .where(eq(talentProfiles.userId, userId))
    .limit(1)

  if (!profile) {
    throw new AppError('NOT_FOUND', 'Talent profile not found')
  }

  // Tier is internal-only: used by pricing and matching, shown to no one,
  // including the talent themself.
  const { tier: _tier, ...visible } = profile as Record<string, unknown>
  return c.json({ success: true, data: visible })
})

// PATCH /:id/availability
talentProfileRoute.patch('/:id/availability', async (c) => {
  const user = getAuthUser(c)
  const id = c.req.param('id')
  const body = await c.req.json()

  const parsed = updateAvailabilitySchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid availability', {
      issues: z.flattenError(parsed.error).fieldErrors,
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

  await appendOutboxEvent(db, {
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
  const user = getAuthUser(c)
  const db = getDb()

  /**
   * A talent's own dashboard, and nothing else.
   *
   * This returns project titles, statuses, progress and deadlines. Matching
   * hands an owner the raw talentId of every anonymous candidate, so without
   * a check an owner reviewing a shortlist could read each candidate's other
   * clients' work - which is the pre-deal anonymity rule inverted. An admin
   * is admitted deliberately: they monitor utilisation and chase late work.
   */
  const [profile] = await db
    .select({ userId: talentProfiles.userId })
    .from(talentProfiles)
    .where(eq(talentProfiles.id, profileId))
    .limit(1)

  if (!profile) {
    throw new AppError('NOT_FOUND', 'Talent profile not found')
  }
  if (profile.userId !== user.id && user.role !== 'admin') {
    throw new AppError('AUTH_FORBIDDEN', 'Only the talent can see their own active projects')
  }

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

  // The dashboard card renders progress, the current milestone and a deadline;
  // returning only id/title left it drawing an empty bar and a bare "%".
  const activeIds = activeProjects.map((p) => p.id)
  const ms =
    activeIds.length > 0
      ? await db
          .select({
            projectId: milestones.projectId,
            title: milestones.title,
            status: milestones.status,
            orderIndex: milestones.orderIndex,
            dueDate: milestones.dueDate,
          })
          .from(milestones)
          .where(inArray(milestones.projectId, activeIds))
      : []

  const enriched = activeProjects.map((p) => {
    const rows = ms.filter((m) => m.projectId === p.id).sort((a, b) => a.orderIndex - b.orderIndex)
    const approved = rows.filter((m) => m.status === 'approved').length
    const current = rows.find((m) => m.status !== 'approved')
    return {
      ...p,
      progress: rows.length > 0 ? Math.round((approved / rows.length) * 100) : 0,
      currentMilestone: current?.title ?? null,
      deadline: current?.dueDate ?? rows.at(-1)?.dueDate ?? null,
    }
  })

  return c.json({ success: true, data: enriched })
})
