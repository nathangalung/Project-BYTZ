// biome-ignore-all lint/style/noRestrictedImports: the rule keeps route HANDLERS
// off Drizzle. This is a test, and the tables are what the fixtures are made of.

import { getDb, projects, reviews, skills, talentProfiles, talentSkills, user } from '@kerjacus/db'
import { connectTestDatabase, hasTestDatabase, type TestHandle } from '@kerjacus/db/testing'
import { sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { isInternalTalentColumn } from '../lib/talent-visibility'
import { errorHandler } from '../middleware/error-handler'
import type { SessionUser } from '../middleware/session'
import { talentRoute } from './talents'

/**
 * The talent directory, and what it withholds.
 *
 * These routes serve someone else's profile to a signed-in caller, so the
 * column allowlist is the whole security surface. tier and average_rating are
 * internal by design - a visible rating compounds into more work - and
 * portfolio_links is withheld until there is a deal, because a GitHub or
 * LinkedIn URL carries the real name and a channel outside the platform, which
 * is the same thing the chat bypass filter exists to stop.
 *
 * Asserted against the response body rather than the constant, so a column
 * added to the select is caught rather than a constant edited in isolation.
 */

const runIf = hasTestDatabase() ? describe : describe.skip
const INTEGRATION_LOCK = sql`SELECT pg_advisory_lock(20260813)`

function session(id: string, role = 'owner'): SessionUser {
  return { id, email: `${id}@example.test`, name: 'Caller', role }
}

function appAs(caller: SessionUser) {
  const app = new Hono()
  app.onError(errorHandler)
  app.use('*', async (c, next) => {
    c.set('user' as never, caller as never)
    await next()
  })
  app.route('/', talentRoute)
  return app
}

type ErrorBody = { success: false; error: { code: string; message: string } }

runIf('talent directory routes against Postgres', () => {
  let handle: TestHandle
  let viewerId: string
  let talentUserId: string
  let talentId: string
  let skillId: string

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

    viewerId = await makeUser('viewer')
    talentUserId = await makeUser('talent')
    talentId = uuidv7()
    await handle.db.insert(talentProfiles).values({
      id: talentId,
      userId: talentUserId,
      bio: 'Backend engineer',
      yearsOfExperience: 6,
      tier: 'senior',
      educationUniversity: 'ITB',
      educationMajor: 'Informatika',
      educationYear: 2018,
      cvFileUrl: 'cv/secret.pdf',
      cvParsedData: { nama: 'Real Name' },
      portfolioLinks: [{ platform: 'github', url: 'https://github.com/realname' }],
      hourlyRateExpectation: 250_000,
      location: 'Bandung',
      averageRating: 4.8,
      pemerataanPenalty: 0.5,
      totalProjectsActive: 2,
      totalProjectsCompleted: 9,
      verificationStatus: 'verified',
      availabilityStatus: 'available',
    })

    skillId = uuidv7()
    await handle.db.insert(skills).values({ id: skillId, name: 'TypeScript', category: 'backend' })
    await handle.db.insert(talentSkills).values({
      talentId,
      skillId,
      proficiencyLevel: 'expert',
      isPrimary: true,
    })
  })

  describe('GET /', () => {
    it('lists verified talents', async () => {
      const res = await appAs(session(viewerId)).request('/')

      expect(res.status).toBe(200)
      const body = (await res.json()) as { data: { items: unknown[]; total: number } }
      expect(body.data.total).toBe(1)
    })

    it('omits a talent who has not been verified', async () => {
      const otherUser = await makeUser('unverified')
      await handle.db.insert(talentProfiles).values({
        id: uuidv7(),
        userId: otherUser,
        verificationStatus: 'unverified',
      })

      const res = await appAs(session(viewerId)).request('/')

      expect(((await res.json()) as { data: { total: number } }).data.total).toBe(1)
    })

    /** Every internal column, checked on the row the route actually returns. */
    it('withholds every internal column from the listing', async () => {
      const res = await appAs(session(viewerId)).request('/')

      const body = (await res.json()) as { data: { items: Record<string, unknown>[] } }
      const row = body.data.items[0] as Record<string, unknown>
      for (const key of Object.keys(row)) {
        expect(isInternalTalentColumn(key), `${key} is internal and must not be listed`).toBe(false)
      }
      expect(row).not.toHaveProperty('portfolioLinks')
      expect(row).not.toHaveProperty('tier')
      expect(row).not.toHaveProperty('averageRating')
      expect(row).not.toHaveProperty('cvParsedData')
      // What the matching screen does show.
      expect(row.educationUniversity).toBe('ITB')
      expect(row.yearsOfExperience).toBe(6)
    })

    it('filters by skill name', async () => {
      const hit = await appAs(session(viewerId)).request('/?skill=TypeScript')
      const miss = await appAs(session(viewerId)).request('/?skill=Rust')

      expect(((await hit.json()) as { data: { total: number } }).data.total).toBe(1)
      expect(((await miss.json()) as { data: { total: number } }).data.total).toBe(0)
    })

    it('filters by availability', async () => {
      const res = await appAs(session(viewerId)).request('/?availability=unavailable')

      expect(((await res.json()) as { data: { total: number } }).data.total).toBe(0)
    })

    it('rejects an availability outside the enum', async () => {
      const res = await appAs(session(viewerId)).request('/?availability=maybe')

      expect(res.status).toBe(400)
      expect(((await res.json()) as ErrorBody).error.code).toBe('VALIDATION_ERROR')
    })

    it('rejects an out-of-range page size', async () => {
      const res = await appAs(session(viewerId)).request('/?pageSize=100000')

      expect(res.status).toBe(400)
    })
  })

  describe('GET /ratings', () => {
    /**
     * Registered before /:id, so the literal has to win the route match. If
     * ordering flipped, "ratings" would be read as a talent id and the
     * talent's own ratings page would 404.
     */
    it('resolves to the caller own ratings rather than a talent id', async () => {
      const projectId = uuidv7()
      await handle.db.insert(projects).values({
        id: projectId,
        ownerId: viewerId,
        title: 'Finished project',
        description: 'Carries the rating',
        category: 'web_app',
        budgetMin: 1_000_000,
        budgetMax: 2_000_000,
        estimatedTimelineDays: 30,
        status: 'completed',
      })
      await handle.db.insert(reviews).values({
        id: uuidv7(),
        projectId,
        reviewerId: viewerId,
        revieweeId: talentUserId,
        rating: 5,
        comment: 'Strong delivery',
        type: 'owner_to_talent',
      })

      const res = await appAs(session(talentUserId, 'talent')).request('/ratings')

      expect(res.status).toBe(200)
      const body = (await res.json()) as { data: { rating: number }[] }
      expect(body.data).toHaveLength(1)
      expect(body.data[0]?.rating).toBe(5)
    })

    it('returns an empty list for a caller with no talent profile', async () => {
      const res = await appAs(session(viewerId)).request('/ratings')

      expect(res.status).toBe(200)
      expect(((await res.json()) as { data: unknown[] }).data).toEqual([])
    })
  })

  describe('GET /:id', () => {
    /**
     * The allowlist is repeated per route rather than shared through a view,
     * which is exactly how portfolio_links once survived being withheld on
     * talent-profiles while this route kept serving them.
     */
    it('withholds every internal column from the profile', async () => {
      const res = await appAs(session(viewerId)).request(`/${talentId}`)

      expect(res.status).toBe(200)
      const row = ((await res.json()) as { data: Record<string, unknown> }).data
      for (const key of Object.keys(row)) {
        expect(isInternalTalentColumn(key), `${key} is internal and must not be served`).toBe(false)
      }
      expect(row).not.toHaveProperty('portfolioLinks')
      expect(row).not.toHaveProperty('cvFileUrl')
      expect(row).not.toHaveProperty('hourlyRateExpectation')
      expect(row).not.toHaveProperty('pemerataanPenalty')
    })

    it('reports an unknown talent as not found', async () => {
      const res = await appAs(session(viewerId)).request(`/${uuidv7()}`)

      expect(res.status).toBe(404)
      expect(((await res.json()) as ErrorBody).error.code).toBe('TALENT_NOT_FOUND')
    })
  })

  describe('GET /:id/skills', () => {
    it('returns the skills with their canonical names', async () => {
      const res = await appAs(session(viewerId)).request(`/${talentId}/skills`)

      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        data: { skillName: string; proficiencyLevel: string; isPrimary: boolean }[]
      }
      expect(body.data).toEqual([
        {
          skillId,
          skillName: 'TypeScript',
          skillCategory: 'backend',
          proficiencyLevel: 'expert',
          isPrimary: true,
        },
      ])
    })

    it('reports an unknown talent as not found rather than an empty list', async () => {
      const res = await appAs(session(viewerId)).request(`/${uuidv7()}/skills`)

      expect(res.status).toBe(404)
      expect(((await res.json()) as ErrorBody).error.code).toBe('TALENT_NOT_FOUND')
    })
  })
})
