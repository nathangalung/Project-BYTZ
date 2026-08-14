// biome-ignore-all lint/style/noRestrictedImports: the rule keeps route HANDLERS
// off Drizzle. This is a test, and the tables are what the fixtures are made of.

import {
  getDb,
  outboxEvents,
  projectAssignments,
  projects,
  talentPlacementRequests,
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
import { talentPlacementRoute } from './talent-placement'

/**
 * The release valve for an owner who would rather hire a talent than lose
 * them off-platform, and the conversion fee that comes with it.
 *
 * The authorisation here is the relationship, not the id. Matching returns a
 * raw talentId with every anonymous recommendation, so owners hold ids for
 * candidates they have never worked with; confirming the profile merely exists
 * would let one of them file a fee-bearing hire request against a stranger.
 *
 * The status rules are split by side - a talent accepts or declines, an owner
 * moves it to discussion or completion - so neither can record the other's
 * decision.
 */

const runIf = hasTestDatabase() ? describe : describe.skip
const INTEGRATION_LOCK = sql`SELECT pg_advisory_lock(20260813)`

function session(id: string, role: string): SessionUser {
  return { id, email: `${id}@example.test`, name: 'Caller', role }
}

function appAs(caller: SessionUser) {
  const app = new Hono()
  app.onError(errorHandler)
  app.use('*', async (c, next) => {
    c.set('user' as never, caller as never)
    await next()
  })
  app.route('/', talentPlacementRoute)
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

runIf('talent placement routes against Postgres', () => {
  let handle: TestHandle

  let ownerId: string
  let talentUserId: string
  let talentId: string
  let strangerTalentUserId: string
  let strangerTalentId: string
  let otherOwnerId: string

  let projectId: string

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
    otherOwnerId = await makeUser('other-owner')
    talentUserId = await makeUser('talent')
    talentId = await makeTalent(talentUserId)
    strangerTalentUserId = await makeUser('stranger-talent')
    strangerTalentId = await makeTalent(strangerTalentUserId)

    projectId = uuidv7()
    await handle.db.insert(projects).values({
      id: projectId,
      ownerId,
      title: 'Finished project',
      description: 'The relationship that justifies a placement',
      category: 'web_app',
      budgetMin: 1_000_000,
      budgetMax: 10_000_000,
      estimatedTimelineDays: 60,
      status: 'completed',
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
      status: 'completed',
    })
    await handle.db.insert(projectAssignments).values({
      id: uuidv7(),
      projectId,
      talentId,
      workPackageId: wpId,
      acceptanceStatus: 'accepted',
      status: 'completed',
    })
  })

  async function makePlacement(
    overrides: Partial<typeof talentPlacementRequests.$inferInsert> = {},
  ): Promise<string> {
    const id = uuidv7()
    await handle.db.insert(talentPlacementRequests).values({
      id,
      projectId,
      ownerId,
      talentId,
      status: 'requested',
      conversionFeePercentage: 0.15,
      ...overrides,
    })
    return id
  }

  const body = (overrides: Record<string, unknown> = {}) => ({
    projectId,
    talentId,
    estimatedAnnualSalary: 120_000_000,
    ...overrides,
  })

  describe('POST /', () => {
    it('opens a request for an owner who worked with this talent', async () => {
      const res = await json(session(ownerId, 'owner'), '/', 'POST', body())

      expect(res.status).toBe(201)
      const rows = await handle.db.select().from(talentPlacementRequests)
      expect(rows).toHaveLength(1)
      expect(rows[0]?.status).toBe('requested')
      const events = await handle.db.select({ type: outboxEvents.eventType }).from(outboxEvents)
      expect(events).toEqual([{ type: 'talent_placement.requested' }])
    })

    /**
     * The refusal that matters: an owner holds the talentId of every anonymous
     * candidate matching ever showed them, and a placement request carries a
     * fee.
     */
    it('refuses a talent who never worked on this project', async () => {
      const res = await json(
        session(ownerId, 'owner'),
        '/',
        'POST',
        body({ talentId: strangerTalentId }),
      )

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.message).toContain('has not worked')
      expect(await handle.db.select().from(talentPlacementRequests)).toHaveLength(0)
    })

    it('refuses an owner who does not own the project', async () => {
      const res = await json(session(otherOwnerId, 'owner'), '/', 'POST', body())

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.message).toContain('your own projects')
    })

    it('refuses a talent trying to place themselves', async () => {
      const res = await json(session(talentUserId, 'talent'), '/', 'POST', body())

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.message).toContain('Only project owners')
    })

    it('reports an unknown project as not found', async () => {
      const res = await json(session(ownerId, 'owner'), '/', 'POST', body({ projectId: uuidv7() }))

      expect(res.status).toBe(404)
    })

    /** Backed by talent_placement_live_unique, which settles the race. */
    it('refuses a second open request for the same talent', async () => {
      await json(session(ownerId, 'owner'), '/', 'POST', body())

      const res = await json(session(ownerId, 'owner'), '/', 'POST', body())

      expect(res.status).toBe(409)
      expect(((await res.json()) as ErrorBody).error.code).toBe('CONFLICT')
      expect(await handle.db.select().from(talentPlacementRequests)).toHaveLength(1)
    })

    /** A declined request is closed, so the owner may ask again later. */
    it('allows a fresh request once the previous one was declined', async () => {
      await makePlacement({ status: 'declined' })

      const res = await json(session(ownerId, 'owner'), '/', 'POST', body())

      expect(res.status).toBe(201)
    })

    it('rejects a salary that is not a positive integer', async () => {
      const res = await json(
        session(ownerId, 'owner'),
        '/',
        'POST',
        body({ estimatedAnnualSalary: -1 }),
      )

      expect(res.status).toBe(400)
      expect(((await res.json()) as ErrorBody).error.code).toBe('VALIDATION_ERROR')
    })
  })

  describe('GET /me', () => {
    beforeEach(async () => {
      await makePlacement()
    })

    it('lists the requests an owner filed', async () => {
      const res = await appAs(session(ownerId, 'owner')).request('/me')

      expect(res.status).toBe(200)
      expect(((await res.json()) as { data: { total: number } }).data.total).toBe(1)
    })

    it('lists the requests a talent received', async () => {
      const res = await appAs(session(talentUserId, 'talent')).request('/me')

      expect(res.status).toBe(200)
      expect(((await res.json()) as { data: { total: number } }).data.total).toBe(1)
    })

    it('shows another owner none of them', async () => {
      const res = await appAs(session(otherOwnerId, 'owner')).request('/me')

      expect(((await res.json()) as { data: { total: number } }).data.total).toBe(0)
    })

    it('shows a talent with no profile an empty list', async () => {
      const noProfile = await makeUser('profileless')

      const res = await appAs(session(noProfile, 'talent')).request('/me')

      expect(res.status).toBe(200)
      expect(((await res.json()) as { data: { total: number } }).data.total).toBe(0)
    })

    it('refuses a role that is neither side of a placement', async () => {
      const res = await appAs(session(ownerId, 'admin')).request('/me')

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.message).toContain('Role not permitted')
    })

    it('rejects invalid pagination', async () => {
      const res = await appAs(session(ownerId, 'owner')).request('/me?page=abc')

      expect(res.status).toBe(400)
    })
  })

  describe('GET /:id', () => {
    it('returns it to the owner who filed it', async () => {
      const id = await makePlacement()

      const res = await appAs(session(ownerId, 'owner')).request(`/${id}`)

      expect(res.status).toBe(200)
    })

    it('returns it to the talent it is about', async () => {
      const id = await makePlacement()

      const res = await appAs(session(talentUserId, 'talent')).request(`/${id}`)

      expect(res.status).toBe(200)
    })

    /** The request names a salary and a fee; neither is a third party's business. */
    it('refuses another owner', async () => {
      const id = await makePlacement()

      const res = await appAs(session(otherOwnerId, 'owner')).request(`/${id}`)

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.code).toBe('AUTH_FORBIDDEN')
    })

    it('refuses another talent', async () => {
      const id = await makePlacement()

      const res = await appAs(session(strangerTalentUserId, 'talent')).request(`/${id}`)

      expect(res.status).toBe(403)
    })

    it('reports an unknown request as not found', async () => {
      const res = await appAs(session(ownerId, 'owner')).request(`/${uuidv7()}`)

      expect(res.status).toBe(404)
    })
  })

  describe('PATCH /:id/status', () => {
    it('lets the talent accept', async () => {
      const id = await makePlacement()

      const res = await json(session(talentUserId, 'talent'), `/${id}/status`, 'PATCH', {
        status: 'accepted',
      })

      expect(res.status).toBe(200)
      const [row] = await handle.db
        .select({ status: talentPlacementRequests.status })
        .from(talentPlacementRequests)
        .where(eq(talentPlacementRequests.id, id))
      expect(row?.status).toBe('accepted')
      const events = await handle.db.select({ type: outboxEvents.eventType }).from(outboxEvents)
      expect(events).toEqual([{ type: 'talent_placement.accepted' }])
    })

    it('lets the talent decline', async () => {
      const id = await makePlacement()

      const res = await json(session(talentUserId, 'talent'), `/${id}/status`, 'PATCH', {
        status: 'declined',
      })

      expect(res.status).toBe(200)
    })

    /**
     * Accepting a hire is the talent's decision. An owner who could record it
     * would be marking the talent as having agreed to leave the platform.
     */
    it('refuses to let the owner accept on the talent behalf', async () => {
      const id = await makePlacement()

      const res = await json(session(ownerId, 'owner'), `/${id}/status`, 'PATCH', {
        status: 'accepted',
      })

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.message).toContain(
        'in_discussion or completed',
      )
      const [row] = await handle.db
        .select({ status: talentPlacementRequests.status })
        .from(talentPlacementRequests)
        .where(eq(talentPlacementRequests.id, id))
      expect(row?.status).toBe('requested')
    })

    /** Completion is what makes the conversion fee payable, so it is the owner's. */
    it('refuses to let the talent mark it completed', async () => {
      const id = await makePlacement()

      const res = await json(session(talentUserId, 'talent'), `/${id}/status`, 'PATCH', {
        status: 'completed',
      })

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.message).toContain('accepted or declined')
    })

    it('lets the owner move it into discussion', async () => {
      const id = await makePlacement()

      const res = await json(session(ownerId, 'owner'), `/${id}/status`, 'PATCH', {
        status: 'in_discussion',
      })

      expect(res.status).toBe(200)
    })

    it('refuses a caller who is neither side', async () => {
      const id = await makePlacement()

      const res = await json(session(strangerTalentUserId, 'talent'), `/${id}/status`, 'PATCH', {
        status: 'declined',
      })

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.message).toContain('Not authorized')
    })

    it('reports an unknown request as not found', async () => {
      const res = await json(session(ownerId, 'owner'), `/${uuidv7()}/status`, 'PATCH', {
        status: 'in_discussion',
      })

      expect(res.status).toBe(404)
    })

    it('rejects a status outside the enum', async () => {
      const id = await makePlacement()

      const res = await json(session(ownerId, 'owner'), `/${id}/status`, 'PATCH', {
        status: 'hired_already',
      })

      expect(res.status).toBe(400)
      expect(((await res.json()) as ErrorBody).error.code).toBe('VALIDATION_ERROR')
    })
  })

  describe('POST /:id/quote', () => {
    /**
     * The fee slides down with how long the two have already worked together,
     * because by then the platform has recouped most of the introduction
     * through margin. The percentage is what the owner pays, so the tier
     * boundaries are money.
     */
    it('quotes the newcomer rate on a short relationship and stores it', async () => {
      const id = await makePlacement()

      const res = await json(session(ownerId, 'owner'), `/${id}/quote`, 'POST', {
        estimatedAnnualSalary: 120_000_000,
        durationMonths: 3,
      })

      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        data: { conversionFeePercentage: number; conversionFeeAmount: number }
      }
      expect(body.data.conversionFeePercentage).toBe(0.15)
      expect(body.data.conversionFeeAmount).toBe(18_000_000)
      const [row] = await handle.db
        .select({
          pct: talentPlacementRequests.conversionFeePercentage,
          amount: talentPlacementRequests.conversionFeeAmount,
          salary: talentPlacementRequests.estimatedAnnualSalary,
        })
        .from(talentPlacementRequests)
        .where(eq(talentPlacementRequests.id, id))
      expect(row?.pct).toBeCloseTo(0.15)
      expect(row?.amount).toBe(18_000_000)
      expect(row?.salary).toBe(120_000_000)
    })

    it('quotes the middle band past a year together', async () => {
      const id = await makePlacement()

      const res = await json(session(ownerId, 'owner'), `/${id}/quote`, 'POST', {
        estimatedAnnualSalary: 120_000_000,
        durationMonths: 18,
      })

      const body = (await res.json()) as { data: { conversionFeePercentage: number } }
      expect(body.data.conversionFeePercentage).toBe(0.12)
    })

    it('quotes the floor past two years', async () => {
      const id = await makePlacement()

      const res = await json(session(ownerId, 'owner'), `/${id}/quote`, 'POST', {
        estimatedAnnualSalary: 120_000_000,
        durationMonths: 36,
      })

      const body = (await res.json()) as { data: { conversionFeePercentage: number } }
      expect(body.data.conversionFeePercentage).toBe(0.1)
    })

    /** The quote writes the fee onto the request, so it is not a read. */
    it('refuses a talent asking for a quote on their own placement', async () => {
      const id = await makePlacement()

      const res = await json(session(talentUserId, 'talent'), `/${id}/quote`, 'POST', {
        estimatedAnnualSalary: 120_000_000,
        durationMonths: 3,
      })

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.message).toContain('Only the owner')
    })

    it('refuses another owner', async () => {
      const id = await makePlacement()

      const res = await json(session(otherOwnerId, 'owner'), `/${id}/quote`, 'POST', {
        estimatedAnnualSalary: 120_000_000,
        durationMonths: 3,
      })

      expect(res.status).toBe(403)
    })

    it('reports an unknown request as not found', async () => {
      const res = await json(session(ownerId, 'owner'), `/${uuidv7()}/quote`, 'POST', {
        estimatedAnnualSalary: 120_000_000,
        durationMonths: 3,
      })

      expect(res.status).toBe(404)
    })

    it('rejects a quote body the schema does not accept', async () => {
      const id = await makePlacement()

      const res = await json(session(ownerId, 'owner'), `/${id}/quote`, 'POST', {
        estimatedAnnualSalary: 120_000_000,
        durationMonths: 0,
      })

      expect(res.status).toBe(400)
      expect(((await res.json()) as ErrorBody).error.code).toBe('VALIDATION_ERROR')
    })
  })
})
