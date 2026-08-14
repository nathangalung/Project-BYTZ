// biome-ignore-all lint/style/noRestrictedImports: the rule keeps route HANDLERS
// off Drizzle. This is a test, and the tables are what the fixtures are made of.

import {
  getDb,
  outboxEvents,
  projectApplications,
  projectAssignments,
  projects,
  talentProfiles,
  user,
  workPackages,
} from '@kerjacus/db'
import { connectTestDatabase, hasTestDatabase, type TestHandle } from '@kerjacus/db/testing'
import { eq, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { errorHandler } from '../middleware/error-handler'
import type { SessionUser } from '../middleware/session'
import { applicationRoute } from './applications'

/**
 * Applying, and being hired.
 *
 * Two things here are more than CRUD. The per-project list carries every
 * competing talent's id and cover note, so an applicant may read their own row
 * and nobody else's - one application used to buy the whole list. And
 * accepting IS the hiring decision: the assignment it implies is written in
 * the same transaction, because a committed acceptance with no assignment
 * leaves contracts with no talent to bind and milestones with nobody to pay.
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
  app.route('/', applicationRoute)
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

runIf('application routes against Postgres', () => {
  let handle: TestHandle

  let ownerId: string
  let talentUserId: string
  let talentId: string
  let rivalUserId: string
  let rivalTalentId: string
  let strangerId: string
  let adminId: string

  let projectId: string
  let packageId: string

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

  async function makeTalent(userId: string): Promise<string> {
    const id = uuidv7()
    await handle.db.insert(talentProfiles).values({ id, userId, verificationStatus: 'verified' })
    return id
  }

  beforeEach(async () => {
    await handle.truncate()

    ownerId = await makeUser('owner')
    talentUserId = await makeUser('talent')
    talentId = await makeTalent(talentUserId)
    rivalUserId = await makeUser('rival')
    rivalTalentId = await makeTalent(rivalUserId)
    strangerId = await makeUser('stranger')
    adminId = await makeUser('admin')

    projectId = uuidv7()
    await handle.db.insert(projects).values({
      id: projectId,
      ownerId,
      title: 'Open project',
      description: 'Exercises the application rules',
      category: 'web_app',
      budgetMin: 1_000_000,
      budgetMax: 10_000_000,
      estimatedTimelineDays: 60,
      status: 'matching',
    })

    packageId = uuidv7()
    await handle.db.insert(workPackages).values({
      id: packageId,
      projectId,
      title: 'Backend API',
      description: 'Package',
      orderIndex: 0,
      requiredSkills: ['backend'],
      estimatedHours: 40,
      amount: 5_000_000,
      talentPayout: 3_575_000,
      status: 'unassigned',
    })
  })

  /** Inserted directly, not through POST /. The create path is covered above. */
  async function apply(talent: string, note = 'I have shipped three of these'): Promise<string> {
    const id = uuidv7()
    await handle.db.insert(projectApplications).values({
      id,
      projectId,
      talentId: talent,
      coverNote: note,
      status: 'pending',
      recommendationScore: 0,
    })
    return id
  }

  describe('POST /', () => {
    const body = () => ({ projectId, talentId, coverNote: 'I would like to build this' })

    it('records an application for the talent who owns the profile', async () => {
      const res = await json(session(talentUserId), '/', 'POST', body())

      expect(res.status).toBe(201)
      const rows = await handle.db.select().from(projectApplications)
      expect(rows).toHaveLength(1)
      expect(rows[0]?.status).toBe('pending')
      const events = await handle.db.select({ type: outboxEvents.eventType }).from(outboxEvents)
      expect(events).toEqual([{ type: 'application.created' }])
    })

    /** Applying as someone else would put their name on work they never chose. */
    it('refuses to apply with a talent profile the caller does not own', async () => {
      const res = await json(session(talentUserId), '/', 'POST', {
        ...body(),
        talentId: rivalTalentId,
      })

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.message).toContain('own talent profile')
      expect(await handle.db.select().from(projectApplications)).toHaveLength(0)
    })

    it('refuses a caller with no talent profile', async () => {
      const res = await json(session(strangerId), '/', 'POST', body())

      expect(res.status).toBe(403)
    })

    it('refuses an owner applying to their own project', async () => {
      const ownerTalentId = await makeTalent(ownerId)

      const res = await json(session(ownerId, 'owner'), '/', 'POST', {
        ...body(),
        talentId: ownerTalentId,
      })

      expect(res.status).toBe(400)
      expect(((await res.json()) as ErrorBody).error.message).toContain('your own project')
    })

    it('reports an unknown project as not found', async () => {
      const res = await json(session(talentUserId), '/', 'POST', {
        ...body(),
        projectId: uuidv7(),
      })

      expect(res.status).toBe(404)
    })

    it('refuses a second live application to the same project', async () => {
      await json(session(talentUserId), '/', 'POST', body())

      const res = await json(session(talentUserId), '/', 'POST', body())

      expect(res.status).toBe(409)
      expect(((await res.json()) as ErrorBody).error.code).toBe('CONFLICT')
    })

    /**
     * DEFECT, pinned rather than asserted as correct.
     *
     * The handler above narrows its duplicate check to ACTIVE_APPLICATION_
     * STATUSES so that withdrawing is reversible - its comment says so
     * outright. The database never followed: project_applications_unique is
     * UNIQUE (project_id, talent_id) with no predicate, created in migration
     * 0000 and never made partial. So the application-layer check passes, the
     * INSERT then violates the index, and the talent gets a 500 rather than
     * the 201 the handler intends or even the 409 it used to give.
     *
     * Two of these because the handler admits two dead statuses and both are
     * unreachable. Delete them when the index becomes partial on
     * `status IN ('pending','accepted')`; the assertion flips to 201.
     */
    it('cannot reapply after withdrawing: the unique index has no status predicate', async () => {
      const id = await apply(talentId)
      await handle.db
        .update(projectApplications)
        .set({ status: 'withdrawn' })
        .where(eq(projectApplications.id, id))

      const res = await json(session(talentUserId), '/', 'POST', body())

      expect(res.status).toBe(500)
      expect(((await res.json()) as ErrorBody).error.code).toBe('INTERNAL_ERROR')
      // Discriminates the cause from any other 500: the row that survived is
      // the withdrawn one, so the insert is what the index refused.
      const rows = await handle.db.select().from(projectApplications)
      expect(rows).toHaveLength(1)
      expect(rows[0]?.id).toBe(id)
      expect(rows[0]?.status).toBe('withdrawn')
    })

    it('cannot reapply after being rejected either', async () => {
      const id = await apply(talentId)
      await handle.db
        .update(projectApplications)
        .set({ status: 'rejected' })
        .where(eq(projectApplications.id, id))

      const res = await json(session(talentUserId), '/', 'POST', body())

      expect(res.status).toBe(500)
      const rows = await handle.db.select().from(projectApplications)
      expect(rows).toHaveLength(1)
      expect(rows[0]?.id).toBe(id)
      expect(rows[0]?.status).toBe('rejected')
    })

    it('rejects a cover note longer than the schema allows', async () => {
      const res = await json(session(talentUserId), '/', 'POST', {
        ...body(),
        coverNote: 'x'.repeat(2001),
      })

      expect(res.status).toBe(400)
      expect(((await res.json()) as ErrorBody).error.code).toBe('VALIDATION_ERROR')
    })
  })

  describe('GET /project/:projectId', () => {
    beforeEach(async () => {
      await apply(talentId, 'My cover note')
      await apply(rivalTalentId, 'The rival cover note')
    })

    it('shows the owner every application', async () => {
      const res = await appAs(session(ownerId, 'owner')).request(`/project/${projectId}`)

      expect(res.status).toBe(200)
      expect(((await res.json()) as { data: { total: number } }).data.total).toBe(2)
    })

    /**
     * The list carries competing talent ids and their cover notes, so an
     * applicant sees their own row alone. One application used to buy the lot.
     */
    it('shows an applicant only their own row', async () => {
      const res = await appAs(session(talentUserId)).request(`/project/${projectId}`)

      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        data: { items: { talentId: string; coverNote: string }[]; total: number }
      }
      expect(body.data.total).toBe(1)
      expect(body.data.items[0]?.talentId).toBe(talentId)
      expect(JSON.stringify(body)).not.toContain('The rival cover note')
    })

    it('refuses a talent who has not applied', async () => {
      const outsiderUser = await makeUser('outsider')
      await makeTalent(outsiderUser)

      const res = await appAs(session(outsiderUser)).request(`/project/${projectId}`)

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.code).toBe('AUTH_FORBIDDEN')
    })

    it('refuses a caller with no talent profile at all', async () => {
      const res = await appAs(session(strangerId)).request(`/project/${projectId}`)

      expect(res.status).toBe(403)
    })

    it('reports an unknown project as not found', async () => {
      const res = await appAs(session(ownerId, 'owner')).request(`/project/${uuidv7()}`)

      expect(res.status).toBe(404)
    })

    it('rejects a page that is not a number', async () => {
      const res = await appAs(session(ownerId, 'owner')).request(`/project/${projectId}?page=abc`)

      expect(res.status).toBe(400)
    })
  })

  describe('GET /talent/:talentId', () => {
    beforeEach(async () => {
      await apply(talentId)
    })

    it('lets a talent read their own application history', async () => {
      const res = await appAs(session(talentUserId)).request(`/talent/${talentId}`)

      expect(res.status).toBe(200)
      expect(((await res.json()) as { data: { total: number } }).data.total).toBe(1)
    })

    /** Where a talent has applied is a record of what they are looking for. */
    it('refuses another talent', async () => {
      const res = await appAs(session(rivalUserId)).request(`/talent/${talentId}`)

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.code).toBe('AUTH_FORBIDDEN')
    })

    it('refuses the owner of a project they applied to', async () => {
      const res = await appAs(session(ownerId, 'owner')).request(`/talent/${talentId}`)

      expect(res.status).toBe(403)
    })

    it('lets an admin read it', async () => {
      const res = await appAs(session(adminId, 'admin')).request(`/talent/${talentId}`)

      expect(res.status).toBe(200)
    })

    it('reports an unknown talent profile as not found', async () => {
      const res = await appAs(session(talentUserId)).request(`/talent/${uuidv7()}`)

      expect(res.status).toBe(404)
    })
  })

  describe('PATCH /:id', () => {
    let applicationId: string

    beforeEach(async () => {
      applicationId = await apply(talentId)
    })

    /**
     * Acceptance and the assignment it implies land together. Without the
     * assignment the status column said "accepted" and nothing else agreed.
     */
    it('creates the assignment and claims the work package on acceptance', async () => {
      const res = await json(session(ownerId, 'owner'), `/${applicationId}`, 'PATCH', {
        status: 'accepted',
      })

      expect(res.status).toBe(200)
      const assignments = await handle.db.select().from(projectAssignments)
      expect(assignments).toHaveLength(1)
      expect(assignments[0]?.talentId).toBe(talentId)
      expect(assignments[0]?.workPackageId).toBe(packageId)
      expect(assignments[0]?.applicationId).toBe(applicationId)
      expect(assignments[0]?.roleLabel).toBe('Backend API')
      const [wp] = await handle.db
        .select({ status: workPackages.status })
        .from(workPackages)
        .where(eq(workPackages.id, packageId))
      expect(wp?.status).toBe('assigned')
    })

    /**
     * application.status.* rather than talent.assignment.*: the latter means a
     * hired talent left, and notification-service reads a decline as "your
     * position reopened" and emails the owner.
     */
    it('announces a rejection on the application subject, not the assignment one', async () => {
      await json(session(ownerId, 'owner'), `/${applicationId}`, 'PATCH', { status: 'rejected' })

      const events = await handle.db.select({ type: outboxEvents.eventType }).from(outboxEvents)
      expect(events).toEqual([{ type: 'application.status.rejected' }])
      expect(await handle.db.select().from(projectAssignments)).toHaveLength(0)
    })

    it('refuses to accept when every work package is already taken', async () => {
      await handle.db
        .update(workPackages)
        .set({ status: 'assigned' })
        .where(eq(workPackages.id, packageId))

      const res = await json(session(ownerId, 'owner'), `/${applicationId}`, 'PATCH', {
        status: 'accepted',
      })

      expect(res.status).toBe(409)
      expect(((await res.json()) as ErrorBody).error.message).toContain('already has a talent')
      // The whole transaction rolls back, acceptance included.
      const [row] = await handle.db
        .select({ status: projectApplications.status })
        .from(projectApplications)
        .where(eq(projectApplications.id, applicationId))
      expect(row?.status).toBe('pending')
    })

    it('refuses the applicant trying to accept themselves', async () => {
      const res = await json(session(talentUserId), `/${applicationId}`, 'PATCH', {
        status: 'accepted',
      })

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.message).toContain('owner')
      expect(await handle.db.select().from(projectAssignments)).toHaveLength(0)
    })

    it('refuses a signed-in stranger', async () => {
      const res = await json(session(strangerId), `/${applicationId}`, 'PATCH', {
        status: 'rejected',
      })

      expect(res.status).toBe(403)
    })

    it('lets the applicant withdraw', async () => {
      const res = await json(session(talentUserId), `/${applicationId}`, 'PATCH', {
        status: 'withdrawn',
      })

      expect(res.status).toBe(200)
      const events = await handle.db.select({ type: outboxEvents.eventType }).from(outboxEvents)
      expect(events).toEqual([{ type: 'application.status.withdrawn' }])
    })

    /** Withdrawing on someone else's behalf takes them out of the running. */
    it('refuses another talent withdrawing this application', async () => {
      const res = await json(session(rivalUserId), `/${applicationId}`, 'PATCH', {
        status: 'withdrawn',
      })

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.message).toContain('applicant')
    })

    it('refuses the owner withdrawing on the applicant behalf', async () => {
      const res = await json(session(ownerId, 'owner'), `/${applicationId}`, 'PATCH', {
        status: 'withdrawn',
      })

      expect(res.status).toBe(403)
    })

    it('reports an unknown application as not found', async () => {
      const res = await json(session(ownerId, 'owner'), `/${uuidv7()}`, 'PATCH', {
        status: 'rejected',
      })

      expect(res.status).toBe(404)
    })

    it('rejects a status outside the enum', async () => {
      const res = await json(session(ownerId, 'owner'), `/${applicationId}`, 'PATCH', {
        status: 'hired',
      })

      expect(res.status).toBe(400)
      expect(((await res.json()) as ErrorBody).error.code).toBe('VALIDATION_ERROR')
    })
  })
})
