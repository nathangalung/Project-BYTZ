// biome-ignore-all lint/style/noRestrictedImports: the rule keeps route HANDLERS
// off Drizzle. This is a test, and the tables are what the fixtures are made of.

import {
  getDb,
  outboxEvents,
  projectAssignments,
  projects,
  reviews,
  talentProfiles,
  user,
  workPackages,
} from '@kerjacus/db'
import { connectTestDatabase, hasTestDatabase, type TestHandle } from '@kerjacus/db/testing'
import { sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { errorHandler } from '../middleware/error-handler'
import type { SessionUser } from '../middleware/session'
import { reviewRoute } from './reviews'

/**
 * Ratings are internal, and that is a fairness decision rather than a privacy
 * one: a visible rating compounds into more work for whoever already has the
 * most, which is the effect pemerataan exists to prevent. So the read rules
 * are the point of these routes, and so is the duplicate guard - a rating is
 * 0.15 of the recommendation score, and one counted twice quietly moves a
 * talent up the queue with nothing surfacing as an error.
 */

const runIf = hasTestDatabase() ? describe : describe.skip
const INTEGRATION_LOCK = sql`SELECT pg_advisory_lock(20260813)`

function session(id: string, role = 'talent'): SessionUser {
  return { id, email: `${id}@example.test`, name: 'Caller', role }
}

function appAs(caller: SessionUser | null) {
  const app = new Hono()
  app.onError(errorHandler)
  app.use('*', async (c, next) => {
    if (caller) c.set('user' as never, caller as never)
    await next()
  })
  app.route('/', reviewRoute)
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

runIf('review routes against Postgres', () => {
  let handle: TestHandle

  let ownerId: string
  let talentUserId: string
  let talentId: string
  let strangerId: string
  let adminId: string
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

  beforeEach(async () => {
    await handle.truncate()

    ownerId = await makeUser('owner')
    talentUserId = await makeUser('talent')
    talentId = uuidv7()
    await handle.db
      .insert(talentProfiles)
      .values({ id: talentId, userId: talentUserId, verificationStatus: 'verified' })
    strangerId = await makeUser('stranger')
    adminId = await makeUser('admin')

    projectId = uuidv7()
    await handle.db.insert(projects).values({
      id: projectId,
      ownerId,
      title: 'Completed project',
      description: 'Exercises the review rules',
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

  const ownerReview = () => ({
    projectId,
    revieweeId: talentUserId,
    rating: 5,
    comment: 'Delivered on time and communicated well',
    type: 'owner_to_talent' as const,
  })

  describe('GET /public', () => {
    it('returns only owner-to-talent reviews the reviewer opted to publish', async () => {
      await handle.db.insert(reviews).values([
        {
          id: uuidv7(),
          projectId,
          reviewerId: ownerId,
          revieweeId: talentUserId,
          rating: 5,
          comment: 'Shared publicly',
          type: 'owner_to_talent',
          isPublicTestimonial: true,
        },
        {
          id: uuidv7(),
          projectId,
          reviewerId: talentUserId,
          revieweeId: ownerId,
          rating: 4,
          comment: 'Internal only',
          type: 'talent_to_owner',
          isPublicTestimonial: true,
        },
      ])

      const res = await appAs(null).request('/public')

      expect(res.status).toBe(200)
      const body = (await res.json()) as { data: { comment: string }[] }
      expect(body.data).toHaveLength(1)
      expect(body.data[0]?.comment).toBe('Shared publicly')
    })

    /** Opt-in: a rating is internal until the reviewer says otherwise. */
    it('withholds a review that was not marked as a testimonial', async () => {
      await handle.db.insert(reviews).values({
        id: uuidv7(),
        projectId,
        reviewerId: ownerId,
        revieweeId: talentUserId,
        rating: 5,
        comment: 'Not shared',
        type: 'owner_to_talent',
      })

      const res = await appAs(null).request('/public')

      expect(((await res.json()) as { data: unknown[] }).data).toHaveLength(0)
    })

    it('never exposes who wrote it or who it is about', async () => {
      await handle.db.insert(reviews).values({
        id: uuidv7(),
        projectId,
        reviewerId: ownerId,
        revieweeId: talentUserId,
        rating: 5,
        comment: 'Shared publicly',
        type: 'owner_to_talent',
        isPublicTestimonial: true,
      })

      const res = await appAs(null).request('/public')

      const body = (await res.json()) as { data: Record<string, unknown>[] }
      expect(body.data[0]).not.toHaveProperty('reviewerId')
      expect(body.data[0]).not.toHaveProperty('revieweeId')
      expect(body.data[0]).not.toHaveProperty('projectId')
    })
  })

  describe('POST /', () => {
    it('records the owner rating of the talent', async () => {
      const res = await json(session(ownerId, 'owner'), '/', 'POST', ownerReview())

      expect(res.status).toBe(201)
      const rows = await handle.db.select().from(reviews)
      expect(rows).toHaveLength(1)
      expect(rows[0]?.reviewerId).toBe(ownerId)
      expect(rows[0]?.rating).toBe(5)
    })

    it('records a review.created outbox event', async () => {
      await json(session(ownerId, 'owner'), '/', 'POST', ownerReview())

      const events = await handle.db.select({ type: outboxEvents.eventType }).from(outboxEvents)
      expect(events).toEqual([{ type: 'review.created' }])
    })

    it('records the talent rating of the owner', async () => {
      const res = await json(session(talentUserId), '/', 'POST', {
        projectId,
        revieweeId: ownerId,
        rating: 4,
        type: 'talent_to_owner',
      })

      expect(res.status).toBe(201)
    })

    it('refuses someone who was never on the project', async () => {
      const res = await json(session(strangerId), '/', 'POST', {
        ...ownerReview(),
        revieweeId: talentUserId,
      })

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.message).toContain('participants')
      expect(await handle.db.select().from(reviews)).toHaveLength(0)
    })

    /**
     * The reviewee must be the counterpart on this project. An arbitrary id
     * would otherwise reach the users foreign key as a 500, and an unrelated
     * user would carry a rating from a project they never touched.
     */
    it('refuses a reviewee who is not a party to the project', async () => {
      const res = await json(session(ownerId, 'owner'), '/', 'POST', {
        ...ownerReview(),
        revieweeId: strangerId,
      })

      expect(res.status).toBe(400)
      expect(((await res.json()) as ErrorBody).error.message).toContain('not a party')
    })

    it('refuses an owner-to-talent review aimed at the owner', async () => {
      const res = await json(session(ownerId, 'owner'), '/', 'POST', {
        ...ownerReview(),
        revieweeId: ownerId,
      })

      expect(res.status).toBe(400)
    })

    it('refuses a talent-to-owner review aimed at a talent', async () => {
      const res = await json(session(talentUserId), '/', 'POST', {
        projectId,
        revieweeId: talentUserId,
        rating: 4,
        type: 'talent_to_owner',
      })

      expect(res.status).toBe(400)
    })

    /** Backed by reviews_project_reviewer_reviewee_unique, not a prior SELECT. */
    it('refuses a second review of the same person on the same project', async () => {
      await json(session(ownerId, 'owner'), '/', 'POST', ownerReview())

      const res = await json(session(ownerId, 'owner'), '/', 'POST', {
        ...ownerReview(),
        rating: 1,
      })

      expect(res.status).toBe(409)
      expect(((await res.json()) as ErrorBody).error.code).toBe('CONFLICT')
      const rows = await handle.db.select().from(reviews)
      expect(rows).toHaveLength(1)
      expect(rows[0]?.rating).toBe(5)
    })

    it('emits no second event for the refused duplicate', async () => {
      await json(session(ownerId, 'owner'), '/', 'POST', ownerReview())
      await json(session(ownerId, 'owner'), '/', 'POST', ownerReview())

      const events = await handle.db.select({ type: outboxEvents.eventType }).from(outboxEvents)
      expect(events).toHaveLength(1)
    })

    it('rejects a rating outside one to five', async () => {
      const res = await json(session(ownerId, 'owner'), '/', 'POST', {
        ...ownerReview(),
        rating: 6,
      })

      expect(res.status).toBe(400)
      expect(((await res.json()) as ErrorBody).error.code).toBe('VALIDATION_ERROR')
    })

    it('rejects an empty reviewee id', async () => {
      const res = await json(session(ownerId, 'owner'), '/', 'POST', {
        ...ownerReview(),
        revieweeId: '',
      })

      expect(res.status).toBe(400)
    })

    it('reports an unknown project as not found', async () => {
      const res = await json(session(ownerId, 'owner'), '/', 'POST', {
        ...ownerReview(),
        projectId: uuidv7(),
      })

      expect(res.status).toBe(404)
    })
  })

  describe('GET /project/:projectId', () => {
    it('returns the reviews to a party', async () => {
      await json(session(ownerId, 'owner'), '/', 'POST', ownerReview())

      const res = await appAs(session(talentUserId)).request(`/project/${projectId}`)

      expect(res.status).toBe(200)
      expect(((await res.json()) as { data: unknown[] }).data).toHaveLength(1)
    })

    it('refuses a signed-in stranger', async () => {
      const res = await appAs(session(strangerId)).request(`/project/${projectId}`)

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.code).toBe('AUTH_FORBIDDEN')
    })
  })

  describe('GET /user/:userId', () => {
    beforeEach(async () => {
      await json(session(ownerId, 'owner'), '/', 'POST', ownerReview())
    })

    it('lets a talent read their own ratings', async () => {
      const res = await appAs(session(talentUserId)).request(`/user/${talentUserId}`)

      expect(res.status).toBe(200)
      expect(((await res.json()) as { data: unknown[] }).data).toHaveLength(1)
    })

    /**
     * The refusal that keeps a high rating from compounding: even the owner who
     * wrote it cannot read the talent's rating history.
     */
    it('refuses the owner who wrote it', async () => {
      const res = await appAs(session(ownerId, 'owner')).request(`/user/${talentUserId}`)

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.message).toContain('internal')
    })

    it('refuses another talent', async () => {
      const res = await appAs(session(strangerId)).request(`/user/${talentUserId}`)

      expect(res.status).toBe(403)
    })

    it('lets an admin read them for quality control', async () => {
      const res = await appAs(session(adminId, 'admin')).request(`/user/${talentUserId}`)

      expect(res.status).toBe(200)
    })
  })
})
