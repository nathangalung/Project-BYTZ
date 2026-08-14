// biome-ignore-all lint/style/noRestrictedImports: the rule keeps route HANDLERS
// off Drizzle. This is a test, and the tables are what the fixtures are made of.

import {
  getDb,
  projectActivities,
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
import { activityRoute } from './activities'

/**
 * The activity feed, scoped to what the caller is party to.
 *
 * The global feed is the interesting one: unscoped it was every activity on
 * the platform, which is both a disclosure in itself - payment and staffing
 * history for projects the caller has nothing to do with - and the way to
 * collect the project ids needed to reach every other per-project route.
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
  app.route('/', activityRoute)
  return app
}

type ErrorBody = { success: false; error: { code: string; message: string } }
type FeedBody = { data: { items: { projectId: string; title: string }[]; total: number } }

runIf('activity routes against Postgres', () => {
  let handle: TestHandle

  let ownerId: string
  let talentUserId: string
  let talentId: string
  let strangerId: string

  let ownedProjectId: string
  let assignedProjectId: string
  let foreignProjectId: string

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

  async function makeProject(owner: string, title: string): Promise<string> {
    const id = uuidv7()
    await handle.db.insert(projects).values({
      id,
      ownerId: owner,
      title,
      description: 'Exercises the activity feed scope',
      category: 'web_app',
      budgetMin: 1_000_000,
      budgetMax: 10_000_000,
      estimatedTimelineDays: 60,
      status: 'in_progress',
    })
    return id
  }

  async function activity(projectId: string, title: string) {
    await handle.db.insert(projectActivities).values({
      id: uuidv7(),
      projectId,
      type: 'milestone_submitted',
      title,
    })
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

    ownedProjectId = await makeProject(ownerId, 'Owned project')
    assignedProjectId = await makeProject(await makeUser('other-owner'), 'Assigned project')
    foreignProjectId = await makeProject(await makeUser('foreign-owner'), 'Foreign project')

    const wpId = uuidv7()
    await handle.db.insert(workPackages).values({
      id: wpId,
      projectId: assignedProjectId,
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
      projectId: assignedProjectId,
      talentId,
      workPackageId: wpId,
      acceptanceStatus: 'accepted',
      status: 'active',
    })

    await activity(ownedProjectId, 'Owned activity')
    await activity(assignedProjectId, 'Assigned activity')
    await activity(foreignProjectId, 'Foreign activity')
  })

  describe('GET /', () => {
    it('shows an owner only their own projects', async () => {
      const res = await appAs(session(ownerId, 'owner')).request('/')

      expect(res.status).toBe(200)
      const body = (await res.json()) as FeedBody
      expect(body.data.total).toBe(1)
      expect(body.data.items[0]?.title).toBe('Owned activity')
    })

    /** Both halves of the union: projects owned, and projects worked on. */
    it('shows a talent the projects they are assigned to', async () => {
      const res = await appAs(session(talentUserId)).request('/')

      const body = (await res.json()) as FeedBody
      expect(body.data.total).toBe(1)
      expect(body.data.items[0]?.title).toBe('Assigned activity')
    })

    it('shows a signed-in stranger nothing at all', async () => {
      const res = await appAs(session(strangerId)).request('/')

      expect(res.status).toBe(200)
      const body = (await res.json()) as FeedBody
      expect(body.data.total).toBe(0)
      expect(body.data.items).toEqual([])
    })

    it('never leaks a foreign project id through the feed', async () => {
      const res = await appAs(session(ownerId, 'owner')).request('/')

      expect(JSON.stringify(await res.json())).not.toContain(foreignProjectId)
    })

    it('joins the project title onto each row', async () => {
      const res = await appAs(session(ownerId, 'owner')).request('/')

      const body = (await res.json()) as { data: { items: { projectTitle: string }[] } }
      expect(body.data.items[0]?.projectTitle).toBe('Owned project')
    })

    it('honours an explicit limit over the page size', async () => {
      await activity(ownedProjectId, 'Second owned activity')

      const res = await appAs(session(ownerId, 'owner')).request('/?limit=1')

      const body = (await res.json()) as { data: { items: unknown[]; pageSize: number } }
      expect(body.data.items).toHaveLength(1)
      expect(body.data.pageSize).toBe(1)
    })

    it('rejects a page that is not a number', async () => {
      const res = await appAs(session(ownerId, 'owner')).request('/?page=abc')

      expect(res.status).toBe(400)
      expect(((await res.json()) as ErrorBody).error.code).toBe('VALIDATION_ERROR')
    })

    it('rejects a limit past the page cap', async () => {
      const res = await appAs(session(ownerId, 'owner')).request('/?limit=99999')

      expect(res.status).toBe(400)
    })
  })

  describe('GET /project/:projectId', () => {
    it('returns the feed to the project owner', async () => {
      const res = await appAs(session(ownerId, 'owner')).request(`/project/${ownedProjectId}`)

      expect(res.status).toBe(200)
      expect(((await res.json()) as FeedBody).data.total).toBe(1)
    })

    it('returns it to an assigned talent', async () => {
      const res = await appAs(session(talentUserId)).request(`/project/${assignedProjectId}`)

      expect(res.status).toBe(200)
    })

    /** Payment and staffing history for one project. */
    it('refuses a signed-in stranger', async () => {
      const res = await appAs(session(strangerId)).request(`/project/${ownedProjectId}`)

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.code).toBe('AUTH_FORBIDDEN')
    })

    it('refuses a talent assigned to a different project', async () => {
      const res = await appAs(session(talentUserId)).request(`/project/${foreignProjectId}`)

      expect(res.status).toBe(403)
    })

    it('reports an unknown project as not found', async () => {
      const res = await appAs(session(ownerId, 'owner')).request(`/project/${uuidv7()}`)

      expect(res.status).toBe(404)
    })

    it('reports a soft-deleted project as not found', async () => {
      await handle.db
        .update(projects)
        .set({ deletedAt: new Date() })
        .where(eq(projects.id, ownedProjectId))

      const res = await appAs(session(ownerId, 'owner')).request(`/project/${ownedProjectId}`)

      expect(res.status).toBe(404)
    })

    it('rejects invalid pagination', async () => {
      const res = await appAs(session(ownerId, 'owner')).request(
        `/project/${ownedProjectId}?pageSize=99999`,
      )

      expect(res.status).toBe(400)
    })
  })
})
