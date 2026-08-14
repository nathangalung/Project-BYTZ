// biome-ignore-all lint/style/noRestrictedImports: the rule keeps route HANDLERS
// off Drizzle. This is a test, and the tables are what the fixtures are made of.

import {
  getDb,
  milestones,
  outboxEvents,
  projectAssignments,
  projects,
  skills,
  talentProfiles,
  talentSkills,
  user,
  workPackages,
} from '@kerjacus/db'
import { connectTestDatabase, hasTestDatabase, type TestHandle } from '@kerjacus/db/testing'
import { eq, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { isInternalTalentColumn } from '../lib/talent-visibility'
import { errorHandler } from '../middleware/error-handler'
import type { SessionUser } from '../middleware/session'
import { talentProfileRoute } from './talent-profiles'

/**
 * A talent's own profile, and what a stranger sees of it.
 *
 * Three things carry real consequence. Writing a profile is self-only, or one
 * talent could rewrite another's skills and change who matching selects.
 * Reading someone else's drops to the public column set, and tier is stripped
 * from every response including the talent's own. And the active-projects
 * route is the talent's dashboard: matching hands an owner the raw talentId of
 * every anonymous candidate, so without a check the owner reviewing a
 * shortlist could read each candidate's other clients' work - the pre-deal
 * anonymity rule inverted.
 */

const runIf = hasTestDatabase() ? describe : describe.skip
const INTEGRATION_LOCK = sql`SELECT pg_advisory_lock(20260813)`

function session(id: string, role = 'talent'): SessionUser {
  return { id, email: `${id}@example.test`, name: 'Caller', role }
}

function appAs(caller: SessionUser) {
  const app = new Hono()
  app.onError(errorHandler)
  app.use('*', async (c, next) => {
    c.set('user' as never, caller as never)
    await next()
  })
  app.route('/', talentProfileRoute)
  return app
}

type ErrorBody = { success: false; error: { code: string; message: string } }

function json(caller: SessionUser, path: string, method: string, body: unknown) {
  return appAs(caller).request(path, {
    method,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

runIf('talent profile routes against Postgres', () => {
  let handle: TestHandle

  let talentUserId: string
  let talentId: string
  let otherUserId: string
  let ownerId: string
  let adminId: string

  beforeAll(async () => {
    handle = await connectTestDatabase()
    await handle.db.execute(INTEGRATION_LOCK)
    getDb(process.env.TEST_DATABASE_URL)
  }, 120_000)

  afterAll(async () => {
    await handle.close()
  })

  async function makeUser(name: string): Promise<string> {
    const id = uuidv7()
    await handle.db
      .insert(user)
      .values({ id, email: `${name}-${id}@example.test`, name, emailVerified: false })
    return id
  }

  beforeEach(async () => {
    await handle.truncate()

    talentUserId = await makeUser('talent')
    otherUserId = await makeUser('other')
    ownerId = await makeUser('owner')
    adminId = await makeUser('admin')

    talentId = uuidv7()
    await handle.db.insert(talentProfiles).values({
      id: talentId,
      userId: talentUserId,
      bio: 'Backend engineer',
      yearsOfExperience: 6,
      tier: 'senior',
      averageRating: 4.9,
      hourlyRateExpectation: 250_000,
      cvFileUrl: 'cv/secret.pdf',
      portfolioLinks: [{ platform: 'github', url: 'https://github.com/realname' }],
      verificationStatus: 'verified',
      availabilityStatus: 'available',
    })
  })

  describe('POST /', () => {
    const body = (overrides: Record<string, unknown> = {}) => ({
      userId: talentUserId,
      yearsOfExperience: 6,
      bio: 'Updated bio',
      ...overrides,
    })

    it('saves the caller own profile', async () => {
      const res = await json(session(talentUserId), '/', 'POST', body())

      expect(res.status).toBe(201)
      const [row] = await handle.db
        .select({ bio: talentProfiles.bio })
        .from(talentProfiles)
        .where(eq(talentProfiles.userId, talentUserId))
      expect(row?.bio).toBe('Updated bio')
    })

    /** Rewriting another talent's skills changes who matching selects. */
    it('refuses to write a profile for another user', async () => {
      const res = await json(session(talentUserId), '/', 'POST', body({ userId: otherUserId }))

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.message).toContain('another user')
      expect(
        await handle.db.select().from(talentProfiles).where(eq(talentProfiles.userId, otherUserId)),
      ).toHaveLength(0)
    })

    it('resolves a skill that already exists in the taxonomy', async () => {
      const skillId = uuidv7()
      await handle.db
        .insert(skills)
        .values({ id: skillId, name: 'TypeScript', category: 'backend' })

      await json(
        session(talentUserId),
        '/',
        'POST',
        body({ skills: [{ name: 'typescript', proficiencyLevel: 'expert', isPrimary: true }] }),
      )

      const rows = await handle.db.select().from(talentSkills)
      expect(rows).toHaveLength(1)
      // Case-insensitive, so it joins the canonical row rather than minting one.
      expect(rows[0]?.skillId).toBe(skillId)
      expect(await handle.db.select().from(skills)).toHaveLength(1)
    })

    it('resolves a skill through its alias', async () => {
      const skillId = uuidv7()
      await handle.db
        .insert(skills)
        .values({ id: skillId, name: 'React', category: 'frontend', aliases: ['ReactJS'] })

      await json(
        session(talentUserId),
        '/',
        'POST',
        body({ skills: [{ name: 'reactjs', proficiencyLevel: 'advanced', isPrimary: false }] }),
      )

      const rows = await handle.db.select().from(talentSkills)
      expect(rows[0]?.skillId).toBe(skillId)
    })

    /** Capturing a genuinely new skill beats dropping it: matching fuzzy-matches later. */
    it('captures a skill the taxonomy has never seen', async () => {
      await json(
        session(talentUserId),
        '/',
        'POST',
        body({ skills: [{ name: 'Zig', proficiencyLevel: 'beginner', isPrimary: false }] }),
      )

      const rows = await handle.db.select().from(skills)
      expect(rows).toHaveLength(1)
      expect(rows[0]?.name).toBe('Zig')
      expect(rows[0]?.category).toBe('other')
    })

    it('drops a pathologically long skill rather than failing the whole save', async () => {
      const res = await json(
        session(talentUserId),
        '/',
        'POST',
        body({
          skills: [
            { name: 'x'.repeat(101), proficiencyLevel: 'expert', isPrimary: true },
            { name: 'Go', proficiencyLevel: 'expert', isPrimary: false },
          ],
        }),
      )

      expect(res.status).toBe(201)
      const rows = await handle.db.select().from(skills)
      expect(rows.map((r) => r.name)).toEqual(['Go'])
    })

    /**
     * Verification comes from CV parsing. Resetting it on a bio edit dropped
     * the talent out of matching and the directory with nothing reporting it.
     */
    it('leaves the verification status alone when the profile is edited', async () => {
      await json(session(talentUserId), '/', 'POST', body({ bio: 'A new bio' }))

      const [row] = await handle.db
        .select({ status: talentProfiles.verificationStatus })
        .from(talentProfiles)
        .where(eq(talentProfiles.userId, talentUserId))
      expect(row?.status).toBe('verified')
    })

    it('rejects a body the schema does not accept', async () => {
      const res = await json(session(talentUserId), '/', 'POST', body({ yearsOfExperience: -1 }))

      expect(res.status).toBe(400)
      expect(((await res.json()) as ErrorBody).error.code).toBe('VALIDATION_ERROR')
    })

    it('rejects a proficiency level outside the enum', async () => {
      const res = await json(
        session(talentUserId),
        '/',
        'POST',
        body({ skills: [{ name: 'Go', proficiencyLevel: 'wizard', isPrimary: false }] }),
      )

      expect(res.status).toBe(400)
    })
  })

  describe('GET /me', () => {
    it('returns the caller own profile', async () => {
      const res = await appAs(session(talentUserId)).request('/me')

      expect(res.status).toBe(200)
      const body = (await res.json()) as { data: { id: string } }
      expect(body.data.id).toBe(talentId)
    })

    it('returns null rather than 404 for a caller with no profile', async () => {
      const res = await appAs(session(ownerId, 'owner')).request('/me')

      expect(res.status).toBe(200)
      expect(((await res.json()) as { data: unknown }).data).toBeNull()
    })
  })

  describe('GET /user/:userId', () => {
    it('returns the talent their own row in full', async () => {
      const res = await appAs(session(talentUserId)).request(`/user/${talentUserId}`)

      expect(res.status).toBe(200)
      const row = ((await res.json()) as { data: Record<string, unknown> }).data
      expect(row.hourlyRateExpectation).toBe(250_000)
      expect(row.cvFileUrl).toBe('cv/secret.pdf')
    })

    /**
     * Tier drives pricing and is a matching feature. It is shown to nobody,
     * including the talent, so it is stripped after the column pick rather
     * than left to the allowlist.
     */
    it('withholds tier even on the talent own profile', async () => {
      const res = await appAs(session(talentUserId)).request(`/user/${talentUserId}`)

      const row = ((await res.json()) as { data: Record<string, unknown> }).data
      expect(row).not.toHaveProperty('tier')
    })

    it('drops to the public column set for anyone else', async () => {
      const res = await appAs(session(ownerId, 'owner')).request(`/user/${talentUserId}`)

      expect(res.status).toBe(200)
      const row = ((await res.json()) as { data: Record<string, unknown> }).data
      for (const key of Object.keys(row)) {
        expect(isInternalTalentColumn(key), `${key} is internal and must not be served`).toBe(false)
      }
      expect(row).not.toHaveProperty('portfolioLinks')
      expect(row).not.toHaveProperty('cvFileUrl')
      expect(row.bio).toBe('Backend engineer')
    })

    it('reports a user with no talent profile as not found', async () => {
      const res = await appAs(session(ownerId, 'owner')).request(`/user/${otherUserId}`)

      expect(res.status).toBe(404)
      expect(((await res.json()) as ErrorBody).error.code).toBe('NOT_FOUND')
    })
  })

  describe('PATCH /:id/availability', () => {
    it('updates the caller own availability and announces it', async () => {
      const res = await json(session(talentUserId), `/${talentId}/availability`, 'PATCH', {
        availability: 'busy',
      })

      expect(res.status).toBe(200)
      const [row] = await handle.db
        .select({ status: talentProfiles.availabilityStatus })
        .from(talentProfiles)
        .where(eq(talentProfiles.id, talentId))
      expect(row?.status).toBe('busy')
      const events = await handle.db.select({ type: outboxEvents.eventType }).from(outboxEvents)
      expect(events).toEqual([{ type: 'talent.availability_changed' }])
    })

    /** Availability is an input to matching, so marking a rival unavailable removes them. */
    it('refuses to change another talent availability', async () => {
      const res = await json(session(ownerId, 'owner'), `/${talentId}/availability`, 'PATCH', {
        availability: 'unavailable',
      })

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.message).toContain('your own')
      const [row] = await handle.db
        .select({ status: talentProfiles.availabilityStatus })
        .from(talentProfiles)
        .where(eq(talentProfiles.id, talentId))
      expect(row?.status).toBe('available')
    })

    it('refuses an unknown profile the same way, without confirming it is missing', async () => {
      const res = await json(session(talentUserId), `/${uuidv7()}/availability`, 'PATCH', {
        availability: 'busy',
      })

      expect(res.status).toBe(403)
    })

    it('rejects an availability outside the enum', async () => {
      const res = await json(session(talentUserId), `/${talentId}/availability`, 'PATCH', {
        availability: 'on_holiday',
      })

      expect(res.status).toBe(400)
      expect(((await res.json()) as ErrorBody).error.code).toBe('VALIDATION_ERROR')
    })
  })

  describe('GET /:id/active-projects', () => {
    let projectId: string

    beforeEach(async () => {
      projectId = uuidv7()
      await handle.db.insert(projects).values({
        id: projectId,
        ownerId,
        title: 'Live project',
        description: 'Carries the dashboard card',
        category: 'web_app',
        budgetMin: 1_000_000,
        budgetMax: 10_000_000,
        estimatedTimelineDays: 60,
        status: 'in_progress',
      })
      const wpId = uuidv7()
      await handle.db.insert(workPackages).values({
        id: wpId,
        projectId,
        title: 'Backend API',
        description: 'Package',
        orderIndex: 0,
        requiredSkills: ['backend'],
        estimatedHours: 40,
        amount: 5_000_000,
        talentPayout: 3_575_000,
        status: 'in_progress',
      })
      await handle.db.insert(projectAssignments).values({
        id: uuidv7(),
        projectId,
        talentId,
        workPackageId: wpId,
        roleLabel: 'Backend Developer',
        acceptanceStatus: 'accepted',
        status: 'active',
      })
      await handle.db.insert(milestones).values([
        {
          id: uuidv7(),
          projectId,
          workPackageId: wpId,
          assignedTalentId: talentId,
          title: 'Milestone one',
          description: 'Done',
          orderIndex: 0,
          amount: 2_000_000,
          status: 'approved',
          dueDate: new Date(Date.now() - 86_400_000),
        },
        {
          id: uuidv7(),
          projectId,
          workPackageId: wpId,
          assignedTalentId: talentId,
          title: 'Milestone two',
          description: 'In flight',
          orderIndex: 1,
          amount: 3_000_000,
          status: 'in_progress',
          dueDate: new Date(Date.now() + 7 * 86_400_000),
        },
      ])
    })

    it('returns the dashboard card with progress and the current milestone', async () => {
      const res = await appAs(session(talentUserId)).request(`/${talentId}/active-projects`)

      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        data: { title: string; progress: number; currentMilestone: string; deadline: string }[]
      }
      expect(body.data).toHaveLength(1)
      expect(body.data[0]?.progress).toBe(50)
      expect(body.data[0]?.currentMilestone).toBe('Milestone two')
      expect(body.data[0]?.deadline).not.toBeNull()
    })

    /**
     * Matching hands an owner the raw talentId of every anonymous candidate,
     * so this is the route that would turn a shortlist into a list of each
     * candidate's other clients.
     */
    it('refuses the owner of a project the talent is working on', async () => {
      const res = await appAs(session(ownerId, 'owner')).request(`/${talentId}/active-projects`)

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.message).toContain('their own')
    })

    it('refuses another talent', async () => {
      const res = await appAs(session(otherUserId)).request(`/${talentId}/active-projects`)

      expect(res.status).toBe(403)
    })

    /** Admins monitor utilisation and chase late work, so they are admitted. */
    it('admits an admin', async () => {
      const res = await appAs(session(adminId, 'admin')).request(`/${talentId}/active-projects`)

      expect(res.status).toBe(200)
    })

    it('reports an unknown profile as not found', async () => {
      const res = await appAs(session(talentUserId)).request(`/${uuidv7()}/active-projects`)

      expect(res.status).toBe(404)
    })

    it('returns an empty list when no assignment is live', async () => {
      await handle.db
        .update(projectAssignments)
        .set({ status: 'terminated' })
        .where(eq(projectAssignments.talentId, talentId))

      const res = await appAs(session(talentUserId)).request(`/${talentId}/active-projects`)

      expect(res.status).toBe(200)
      expect(((await res.json()) as { data: unknown[] }).data).toEqual([])
    })

    it('omits a project that is no longer in an active status', async () => {
      await handle.db
        .update(projects)
        .set({ status: 'completed' })
        .where(eq(projects.id, projectId))

      const res = await appAs(session(talentUserId)).request(`/${talentId}/active-projects`)

      expect(((await res.json()) as { data: unknown[] }).data).toEqual([])
    })
  })
})
