// biome-ignore-all lint/style/noRestrictedImports: the rule keeps route HANDLERS
// off Drizzle. This is a test, and the tables are what the fixtures are made of.

import {
  getDb,
  milestones,
  outboxEvents,
  projectAssignments,
  projects,
  talentProfiles,
  tasks,
  timeLogs,
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
import { timeLogRoute } from './time-logs'

/**
 * Every refusal branch on the time-log routes, executed.
 *
 * Hours are the record a dispute is argued from and the input to the next
 * project's estimate, so who may read and write them is the whole point of
 * these handlers. Three of the six routes authorise against the talent profile
 * rather than the project, and one - POST / - has to do both: own the profile
 * AND be party to the project the task belongs to. None of that is provable by
 * reading the source.
 */

const runIf = hasTestDatabase() ? describe : describe.skip

/**
 * Integration files run in parallel forks and each truncates every table in
 * beforeEach, so two overlapping files delete each other's fixtures mid-test.
 * The same session advisory lock the repository suites take.
 */
const INTEGRATION_LOCK = sql`SELECT pg_advisory_lock(20260813)`

function session(id: string, role = 'talent'): SessionUser {
  return { id, email: `${id}@example.test`, name: 'Caller', role }
}

/**
 * The real route behind the real error handler, as one signed-in caller.
 *
 * Mounting the exported Hono app rather than calling handlers keeps the
 * routing, the Zod parse and the AppError-to-envelope translation in the test.
 * Only identity is supplied, which is what sessionMiddleware would have set.
 */
function appAs(caller: SessionUser) {
  const app = new Hono()
  app.onError(errorHandler)
  app.use('*', async (c, next) => {
    c.set('user' as never, caller as never)
    await next()
  })
  app.route('/', timeLogRoute)
  return app
}

type ErrorBody = { success: false; error: { code: string; message: string } }

runIf('time-log routes against Postgres', () => {
  let handle: TestHandle

  let ownerId: string
  let talentUserId: string
  let talentId: string
  let otherTalentUserId: string
  let otherTalentId: string
  let strangerId: string

  let projectId: string
  let otherProjectId: string
  let taskId: string
  let otherProjectTaskId: string

  beforeAll(async () => {
    handle = await connectTestDatabase()
    await handle.db.execute(INTEGRATION_LOCK)
    // Explicit URL rather than mutating DATABASE_URL: getDb caches on first
    // call, so naming it here is deterministic whatever the env holds.
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
    await handle.db
      .insert(talentProfiles)
      .values({ id, userId, verificationStatus: 'verified', availabilityStatus: 'available' })
    return id
  }

  /** Project plus the work package, milestone and task a time log hangs off. */
  async function makeProject(owner: string): Promise<{ projectId: string; taskId: string }> {
    const pid = uuidv7()
    await handle.db.insert(projects).values({
      id: pid,
      ownerId: owner,
      title: 'Time tracked project',
      description: 'Exercises the time-log authorisation',
      category: 'web_app',
      budgetMin: 1_000_000,
      budgetMax: 5_000_000,
      estimatedTimelineDays: 30,
      status: 'in_progress',
    })

    const wpId = uuidv7()
    await handle.db.insert(workPackages).values({
      id: wpId,
      projectId: pid,
      title: 'Backend API',
      description: 'Package',
      orderIndex: 0,
      requiredSkills: ['backend'],
      estimatedHours: 40,
      amount: 3_000_000,
      talentPayout: 2_145_000,
      status: 'assigned',
    })

    const msId = uuidv7()
    await handle.db.insert(milestones).values({
      id: msId,
      projectId: pid,
      workPackageId: wpId,
      title: 'Milestone one',
      description: 'First',
      orderIndex: 0,
      amount: 1_000_000,
      dueDate: new Date(Date.now() + 7 * 86_400_000),
    })

    const tId = uuidv7()
    await handle.db.insert(tasks).values({
      id: tId,
      milestoneId: msId,
      title: 'Build the endpoint',
      orderIndex: 0,
      estimatedHours: 8,
    })

    return { projectId: pid, taskId: tId }
  }

  async function assign(pid: string, talent: string, status: 'active' | 'terminated' = 'active') {
    const [wp] = await handle.db
      .select({ id: workPackages.id })
      .from(workPackages)
      .where(eq(workPackages.projectId, pid))
      .limit(1)
    const id = uuidv7()
    await handle.db.insert(projectAssignments).values({
      id,
      projectId: pid,
      talentId: talent,
      workPackageId: wp?.id as string,
      acceptanceStatus: 'accepted',
      status,
    })
    return id
  }

  beforeEach(async () => {
    await handle.truncate()

    ownerId = await makeUser('owner')
    talentUserId = await makeUser('talent')
    talentId = await makeTalent(talentUserId)
    otherTalentUserId = await makeUser('other-talent')
    otherTalentId = await makeTalent(otherTalentUserId)
    strangerId = await makeUser('stranger')

    const main = await makeProject(ownerId)
    projectId = main.projectId
    taskId = main.taskId
    await assign(projectId, talentId)

    const other = await makeProject(await makeUser('other-owner'))
    otherProjectId = other.projectId
    otherProjectTaskId = other.taskId
  })

  describe('GET /project/:projectId', () => {
    it('lets the project owner read the hours logged against it', async () => {
      const res = await appAs(session(ownerId, 'owner')).request(`/project/${projectId}`)

      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ success: true })
    })

    it('lets the assigned talent read them', async () => {
      const res = await appAs(session(talentUserId)).request(`/project/${projectId}`)

      expect(res.status).toBe(200)
    })

    /** The refusal that keeps one project's effort record out of another's. */
    it('refuses a signed-in stranger', async () => {
      const res = await appAs(session(strangerId)).request(`/project/${projectId}`)

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.code).toBe('AUTH_FORBIDDEN')
    })

    /**
     * A talent whose assignment was terminated is history, not a party. Keeping
     * them admitted would hand a removed talent the project's hours for as long
     * as they stayed signed in.
     */
    it('refuses a talent whose assignment was terminated', async () => {
      await assign(otherProjectId, otherTalentId, 'terminated')

      const res = await appAs(session(otherTalentUserId)).request(`/project/${otherProjectId}`)

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.code).toBe('AUTH_FORBIDDEN')
    })

    it('reports a project that does not exist as not found', async () => {
      const res = await appAs(session(ownerId, 'owner')).request(`/project/${uuidv7()}`)

      expect(res.status).toBe(404)
      expect(((await res.json()) as ErrorBody).error.code).toBe('NOT_FOUND')
    })

    /** Deleted has to mean gone here too, not merely hidden from the listings. */
    it('reports a soft-deleted project as not found', async () => {
      await handle.db
        .update(projects)
        .set({ deletedAt: new Date() })
        .where(eq(projects.id, projectId))

      const res = await appAs(session(ownerId, 'owner')).request(`/project/${projectId}`)

      expect(res.status).toBe(404)
    })
  })

  describe('POST /', () => {
    function post(caller: SessionUser, body: unknown) {
      return appAs(caller).request('/', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
      })
    }

    it('records an entry for the talent who owns the profile', async () => {
      const res = await post(session(talentUserId), {
        taskId,
        startedAt: new Date(Date.now() - 3_600_000).toISOString(),
        endedAt: new Date().toISOString(),
        description: 'Wrote the handler',
      })

      expect(res.status).toBe(201)
      const rows = await handle.db.select().from(timeLogs)
      expect(rows).toHaveLength(1)
      expect(rows[0]?.talentId).toBe(talentId)
      // 60 minutes, derived by the service rather than sent by the client.
      expect(rows[0]?.durationMinutes).toBe(60)
    })

    it('writes the time_log.created event to the outbox in the same request', async () => {
      await post(session(talentUserId), {
        taskId,
        startedAt: new Date().toISOString(),
      })

      const events = await handle.db
        .select({ type: outboxEvents.eventType, published: outboxEvents.published })
        .from(outboxEvents)
      expect(events).toEqual([{ type: 'time_log.created', published: false }])
    })

    it('rejects a payload the schema does not accept', async () => {
      const res = await post(session(talentUserId), { taskId, startedAt: 'not-a-timestamp' })

      expect(res.status).toBe(400)
      const body = (await res.json()) as ErrorBody
      expect(body.error.code).toBe('VALIDATION_ERROR')
    })

    /**
     * The write that would put another talent's name on this caller's hours -
     * and with it their share of a disputed milestone.
     */
    it('refuses to log time against a talent profile the caller does not own', async () => {
      const res = await post(session(talentUserId), {
        taskId,
        talentId: otherTalentId,
        startedAt: new Date().toISOString(),
      })

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.code).toBe('AUTH_FORBIDDEN')
      expect(await handle.db.select().from(timeLogs)).toHaveLength(0)
    })

    it('refuses a caller with no talent profile at all', async () => {
      const res = await post(session(strangerId), {
        taskId,
        startedAt: new Date().toISOString(),
      })

      expect(res.status).toBe(403)
    })

    it('reports an unknown task as not found rather than dying on the foreign key', async () => {
      const res = await post(session(talentUserId), {
        taskId: uuidv7(),
        startedAt: new Date().toISOString(),
      })

      expect(res.status).toBe(404)
      expect(((await res.json()) as ErrorBody).error.code).toBe('NOT_FOUND')
    })

    /** Owning a profile is not the same as being on the project the task sits on. */
    it('refuses a task belonging to a project the talent is not assigned to', async () => {
      const res = await post(session(talentUserId), {
        taskId: otherProjectTaskId,
        startedAt: new Date().toISOString(),
      })

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.code).toBe('AUTH_FORBIDDEN')
      expect(await handle.db.select().from(timeLogs)).toHaveLength(0)
    })

    it('refuses an entry that ends before it starts', async () => {
      const now = Date.now()
      const res = await post(session(talentUserId), {
        taskId,
        startedAt: new Date(now).toISOString(),
        endedAt: new Date(now - 60_000).toISOString(),
      })

      expect(res.status).toBe(400)
      expect(((await res.json()) as ErrorBody).error.message).toContain('endedAt')
    })
  })

  describe('POST /:id/stop', () => {
    async function runningTimer(talent: string, task = taskId): Promise<string> {
      const id = uuidv7()
      await handle.db.insert(timeLogs).values({
        id,
        taskId: task,
        talentId: talent,
        startedAt: new Date(Date.now() - 1_800_000),
      })
      return id
    }

    it('stops the caller own timer and records the elapsed minutes', async () => {
      const id = await runningTimer(talentId)

      const res = await appAs(session(talentUserId)).request(`/${id}/stop`, { method: 'POST' })

      expect(res.status).toBe(200)
      const [row] = await handle.db.select().from(timeLogs).where(eq(timeLogs.id, id))
      expect(row?.endedAt).not.toBeNull()
      expect(row?.durationMinutes).toBe(30)
    })

    it('reports an unknown timer as not found', async () => {
      const res = await appAs(session(talentUserId)).request(`/${uuidv7()}/stop`, {
        method: 'POST',
      })

      expect(res.status).toBe(404)
      expect(((await res.json()) as ErrorBody).error.code).toBe('NOT_FOUND')
    })

    /** Stopping a teammate's timer would freeze their hours at a number they did not choose. */
    it('refuses to stop a timer started by another talent', async () => {
      const id = await runningTimer(otherTalentId)

      const res = await appAs(session(talentUserId)).request(`/${id}/stop`, { method: 'POST' })

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.code).toBe('AUTH_FORBIDDEN')
      const [row] = await handle.db.select().from(timeLogs).where(eq(timeLogs.id, id))
      expect(row?.endedAt).toBeNull()
    })

    it('refuses to stop an already stopped timer', async () => {
      const id = await runningTimer(talentId)
      await appAs(session(talentUserId)).request(`/${id}/stop`, { method: 'POST' })

      const res = await appAs(session(talentUserId)).request(`/${id}/stop`, { method: 'POST' })

      expect(res.status).toBe(409)
      expect(((await res.json()) as ErrorBody).error.code).toBe('CONFLICT')
    })
  })

  describe('GET /task/:taskId', () => {
    it('lets a party to the project read the task hours', async () => {
      const res = await appAs(session(ownerId, 'owner')).request(`/task/${taskId}`)

      expect(res.status).toBe(200)
    })

    it('reports an unknown task as not found', async () => {
      const res = await appAs(session(ownerId, 'owner')).request(`/task/${uuidv7()}`)

      expect(res.status).toBe(404)
    })

    /** The task id is the back door into a project the caller cannot open directly. */
    it('refuses a task on a project the caller is not party to', async () => {
      const res = await appAs(session(talentUserId)).request(`/task/${otherProjectTaskId}`)

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.code).toBe('AUTH_FORBIDDEN')
    })
  })

  describe('GET /talent/:talentId', () => {
    it('lets a talent read their own hours', async () => {
      const res = await appAs(session(talentUserId)).request(`/talent/${talentId}`)

      expect(res.status).toBe(200)
    })

    /**
     * This route spans every project the talent has ever worked, so it is not
     * covered by any per-project check. Own profile only, including for the
     * owner of a project they are currently working on.
     */
    it('refuses another talent profile even to a project owner', async () => {
      const res = await appAs(session(ownerId, 'owner')).request(`/talent/${talentId}`)

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.code).toBe('AUTH_FORBIDDEN')
    })

    it('refuses an unknown talent profile the same way, without confirming it is missing', async () => {
      const res = await appAs(session(talentUserId)).request(`/talent/${uuidv7()}`)

      expect(res.status).toBe(403)
    })
  })

  describe('GET /project/:projectId/summary', () => {
    it('aggregates the hours for a party to the project', async () => {
      await handle.db.insert(timeLogs).values({
        id: uuidv7(),
        taskId,
        talentId,
        startedAt: new Date(Date.now() - 7_200_000),
        endedAt: new Date(),
        durationMinutes: 120,
      })

      const res = await appAs(session(ownerId, 'owner')).request(`/project/${projectId}/summary`)

      expect(res.status).toBe(200)
      const body = (await res.json()) as { data: { totalMinutes?: number } }
      expect(JSON.stringify(body)).toContain('120')
    })

    it('refuses a stranger', async () => {
      const res = await appAs(session(strangerId)).request(`/project/${projectId}/summary`)

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.code).toBe('AUTH_FORBIDDEN')
    })
  })
})
