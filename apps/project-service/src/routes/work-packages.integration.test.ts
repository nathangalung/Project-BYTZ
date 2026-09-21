// biome-ignore-all lint/style/noRestrictedImports: the rule keeps route HANDLERS
// off Drizzle. This is a test, and the tables are what the fixtures are made of.

import {
  getDb,
  outboxEvents,
  projectAssignments,
  projects,
  talentProfiles,
  user,
  workPackageDependencies,
  workPackages,
} from '@kerjacus/db'
import { connectTestDatabase, hasTestDatabase, type TestHandle } from '@kerjacus/db/testing'
import { eq, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { errorHandler } from '../middleware/error-handler'
import type { SessionUser } from '../middleware/session'
import { workPackageRoute } from './work-packages'

/**
 * Work packages carry `amount` and `talentPayout`, so reading one discloses
 * what the platform takes and what a teammate is paid, and writing one moves
 * the project's money around. Both halves are authorised in the handler.
 *
 * The list and detail routes admit any party; creation and dependency edits
 * are owner-only; the status route has its own inline check that admits the
 * one talent holding an active assignment on that package and nobody else.
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
  app.route('/', workPackageRoute)
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

runIf('work-package routes against Postgres', () => {
  let handle: TestHandle

  let ownerId: string
  let talentUserId: string
  let talentId: string
  let otherTalentUserId: string
  let otherTalentId: string
  let strangerId: string

  let projectId: string
  let packageId: string
  let secondPackageId: string

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
    await handle.db
      .insert(talentProfiles)
      .values({ id, userId, verificationStatus: 'verified', availabilityStatus: 'available' })
    return id
  }

  async function makePackage(pid: string, order: number, title: string): Promise<string> {
    const id = uuidv7()
    await handle.db.insert(workPackages).values({
      id,
      projectId: pid,
      title,
      description: 'Package under test',
      orderIndex: order,
      requiredSkills: ['backend'],
      estimatedHours: 40,
      amount: 3_000_000,
      talentPayout: 2_145_000,
      status: 'open',
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

    projectId = uuidv7()
    await handle.db.insert(projects).values({
      id: projectId,
      ownerId,
      title: 'Team project',
      description: 'Exercises work-package authorisation',
      category: 'web_app',
      budgetMin: 1_000_000,
      budgetMax: 10_000_000,
      estimatedTimelineDays: 60,
      status: 'in_progress',
      teamSize: 2,
    })

    packageId = await makePackage(projectId, 0, 'Backend API')
    secondPackageId = await makePackage(projectId, 1, 'Frontend')

    await handle.db.insert(projectAssignments).values({
      id: uuidv7(),
      projectId,
      talentId,
      workPackageId: packageId,
      status: 'active',
    })
  })

  describe('GET /project/:projectId', () => {
    it('lists the packages for the owner', async () => {
      const res = await appAs(session(ownerId, 'owner')).request(`/project/${projectId}`)

      expect(res.status).toBe(200)
      const body = (await res.json()) as { data: unknown[] }
      expect(body.data).toHaveLength(2)
    })

    it('lists them for an assigned talent', async () => {
      const res = await appAs(session(talentUserId)).request(`/project/${projectId}`)

      expect(res.status).toBe(200)
    })

    /** The list is the whole payout schedule of the team. */
    it('refuses a signed-in stranger', async () => {
      const res = await appAs(session(strangerId)).request(`/project/${projectId}`)

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.code).toBe('AUTH_FORBIDDEN')
    })
  })

  describe('GET /:id', () => {
    it('returns the package to a party', async () => {
      const res = await appAs(session(talentUserId)).request(`/${packageId}`)

      expect(res.status).toBe(200)
      const body = (await res.json()) as { data: { id: string } }
      expect(body.data.id).toBe(packageId)
    })

    /**
     * The id is opaque, so this is the route a stranger would walk. The check
     * runs after the package is loaded, which is what makes it easy to omit.
     */
    it('refuses a stranger holding a valid package id', async () => {
      const res = await appAs(session(strangerId)).request(`/${packageId}`)

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.code).toBe('AUTH_FORBIDDEN')
    })

    it('reports an unknown package as not found', async () => {
      const res = await appAs(session(ownerId, 'owner')).request(`/${uuidv7()}`)

      expect(res.status).toBe(404)
    })
  })

  describe('POST /', () => {
    const packagesBody = (projectIdArg: string) => ({
      projectId: projectIdArg,
      packages: [
        {
          title: 'Mobile app',
          description: 'Build the client',
          requiredSkills: ['mobile'],
          estimatedHours: 80,
          amount: 4_000_000,
          orderIndex: 2,
        },
      ],
    })

    it('creates packages for the owner and derives the payout from the bracket', async () => {
      const res = await json(session(ownerId, 'owner'), '/', 'POST', packagesBody(projectId))

      expect(res.status).toBe(201)
      const [row] = await handle.db
        .select()
        .from(workPackages)
        .where(eq(workPackages.title, 'Mobile app'))
      expect(row?.amount).toBe(4_000_000)
      // The route never receives talentPayout; the pricing engine sets it.
      expect(row?.talentPayout).toBeGreaterThan(0)
      expect(row?.talentPayout).toBeLessThan(4_000_000)
    })

    it('writes a work_package.created outbox event per package', async () => {
      await json(session(ownerId, 'owner'), '/', 'POST', packagesBody(projectId))

      const events = await handle.db.select({ type: outboxEvents.eventType }).from(outboxEvents)
      expect(events).toEqual([{ type: 'work_package.created' }])
    })

    /** Creating a package on someone else's project would repartition their money. */
    it('refuses a talent assigned to the project', async () => {
      const res = await json(session(talentUserId), '/', 'POST', packagesBody(projectId))

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.code).toBe('AUTH_FORBIDDEN')
      expect(await handle.db.select().from(workPackages)).toHaveLength(2)
    })

    it('refuses a signed-in stranger', async () => {
      const res = await json(session(strangerId), '/', 'POST', packagesBody(projectId))

      expect(res.status).toBe(403)
    })

    it('rejects a package the schema does not accept', async () => {
      const res = await json(session(ownerId, 'owner'), '/', 'POST', {
        projectId,
        packages: [{ title: 'no', description: 'x', requiredSkills: [], estimatedHours: -1 }],
      })

      expect(res.status).toBe(400)
      expect(((await res.json()) as ErrorBody).error.code).toBe('VALIDATION_ERROR')
    })
  })

  describe('PATCH /:id/status', () => {
    /**
     * 'staffed' is what the accepted assignment in the fixture implies: the
     * offer path sets it in the same transaction that accepts. The route now
     * validates against WORK_PACKAGE_TRANSITIONS, and an accepted talent on an
     * 'open' package is a state the system never produces.
     *
     * Scoped to this block rather than the shared fixture: POST / refuses to
     * add a package to a project that has one past 'open', because the
     * fee bracket keys on the project total and appending would reprice work
     * somebody has already been quoted.
     */
    beforeEach(async () => {
      await handle.db
        .update(workPackages)
        .set({ status: 'staffed' })
        .where(eq(workPackages.id, packageId))
    })

    it('lets the owner move a package', async () => {
      const res = await json(session(ownerId, 'owner'), `/${packageId}/status`, 'PATCH', {
        status: 'in_progress',
      })

      expect(res.status).toBe(200)
      const [row] = await handle.db
        .select({ status: workPackages.status })
        .from(workPackages)
        .where(eq(workPackages.id, packageId))
      expect(row?.status).toBe('in_progress')
    })

    it('lets the talent holding the active assignment move it', async () => {
      const res = await json(session(talentUserId), `/${packageId}/status`, 'PATCH', {
        status: 'in_progress',
      })

      expect(res.status).toBe(200)
    })

    /**
     * Package-scoped, not project-scoped. A teammate on the same project must
     * not be able to mark somebody else's package complete, because completion
     * is what a milestone settlement pays against.
     */
    it('refuses a talent assigned to a different package on the same project', async () => {
      await handle.db.insert(projectAssignments).values({
        id: uuidv7(),
        projectId,
        talentId: otherTalentId,
        workPackageId: secondPackageId,
        status: 'active',
      })

      const res = await json(session(otherTalentUserId), `/${packageId}/status`, 'PATCH', {
        status: 'completed',
      })

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.code).toBe('AUTH_FORBIDDEN')
      const [row] = await handle.db
        .select({ status: workPackages.status })
        .from(workPackages)
        .where(eq(workPackages.id, packageId))
      expect(row?.status).toBe('staffed')
    })

    /**
     * Legality, not only authorisation. The route wrote whatever the enum
     * allowed, from any status to any other, so a package could jump straight
     * to 'completed' - the status a milestone settlement pays against - without
     * anybody having worked it.
     */
    it('refuses the owner a move the transition map does not declare', async () => {
      const res = await json(session(ownerId, 'owner'), `/${packageId}/status`, 'PATCH', {
        status: 'completed',
      })

      expect(res.status).toBe(400)
      const body = (await res.json()) as ErrorBody
      expect(body.error.code).toBe('VALIDATION_ERROR')
      expect(body.error.message).toContain("from 'staffed' to 'completed'")
      const [row] = await handle.db
        .select({ status: workPackages.status })
        .from(workPackages)
        .where(eq(workPackages.id, packageId))
      expect(row?.status).toBe('staffed')
    })

    /**
     * Returning a position to the pool is the owner's call. 'terminated' and
     * 'declined' were both refused here and both now map to 'open', so one
     * literal carries the guard - and the reason has moved with them: this
     * route writes the package alone, so a talent doing it would leave their
     * assignment row 'active' beside a package nobody holds and skip the
     * completed_at the abandonment penalty is charged on. Ending an assignment
     * from the talent side goes through POST /matching/assignments/:id/
     * terminate, which writes both rows under the project lock.
     */
    it('refuses the assigned talent a reopen', async () => {
      const res = await json(session(talentUserId), `/${packageId}/status`, 'PATCH', {
        status: 'open',
      })

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.code).toBe('AUTH_FORBIDDEN')
      const [row] = await handle.db
        .select({ status: workPackages.status })
        .from(workPackages)
        .where(eq(workPackages.id, packageId))
      expect(row?.status).toBe('staffed')
    })

    it('lets the owner reopen a package, and the package can be staffed again', async () => {
      const reopen = await json(session(ownerId, 'owner'), `/${packageId}/status`, 'PATCH', {
        status: 'open',
      })
      expect(reopen.status).toBe(200)

      // Terminal would reproduce the dead end one layer down.
      const restaff = await json(session(ownerId, 'owner'), `/${packageId}/status`, 'PATCH', {
        status: 'staffed',
      })

      expect(restaff.status).toBe(200)
      const [row] = await handle.db
        .select({ status: workPackages.status })
        .from(workPackages)
        .where(eq(workPackages.id, packageId))
      expect(row?.status).toBe('staffed')
    })

    it('refuses a signed-in stranger', async () => {
      const res = await json(session(strangerId), `/${packageId}/status`, 'PATCH', {
        status: 'completed',
      })

      expect(res.status).toBe(403)
    })

    it('reports an unknown package as not found', async () => {
      const res = await json(session(ownerId, 'owner'), `/${uuidv7()}/status`, 'PATCH', {
        status: 'completed',
      })

      expect(res.status).toBe(404)
    })

    it('rejects a status outside the enum', async () => {
      const res = await json(session(ownerId, 'owner'), `/${packageId}/status`, 'PATCH', {
        status: 'nonsense',
      })

      expect(res.status).toBe(400)
      expect(((await res.json()) as ErrorBody).error.code).toBe('VALIDATION_ERROR')
    })

    it('writes a work_package.status_changed outbox event', async () => {
      await json(session(ownerId, 'owner'), `/${packageId}/status`, 'PATCH', {
        status: 'in_progress',
      })

      const events = await handle.db.select({ type: outboxEvents.eventType }).from(outboxEvents)
      expect(events).toEqual([{ type: 'work_package.status_changed' }])
    })
  })

  describe('POST /:id/dependencies', () => {
    it('records a dependency for the owner', async () => {
      const res = await json(
        session(ownerId, 'owner'),
        `/${secondPackageId}/dependencies`,
        'POST',
        {
          dependsOnWorkPackageId: packageId,
        },
      )

      expect(res.status).toBe(201)
      const rows = await handle.db.select().from(workPackageDependencies)
      expect(rows).toHaveLength(1)
      expect(rows[0]?.dependsOnWorkPackageId).toBe(packageId)
    })

    /**
     * A dependency edge reschedules whoever sits downstream of it, so it is an
     * owner decision even though the talent holds the package.
     */
    it('refuses the assigned talent', async () => {
      const res = await json(session(talentUserId), `/${secondPackageId}/dependencies`, 'POST', {
        dependsOnWorkPackageId: packageId,
      })

      expect(res.status).toBe(403)
      expect(await handle.db.select().from(workPackageDependencies)).toHaveLength(0)
    })

    it('reports an unknown package as not found', async () => {
      const res = await json(session(ownerId, 'owner'), `/${uuidv7()}/dependencies`, 'POST', {
        dependsOnWorkPackageId: packageId,
      })

      expect(res.status).toBe(404)
    })

    it('rejects a body with no target', async () => {
      const res = await json(
        session(ownerId, 'owner'),
        `/${secondPackageId}/dependencies`,
        'POST',
        {
          type: 'finish_to_start',
        },
      )

      expect(res.status).toBe(400)
      expect(((await res.json()) as ErrorBody).error.code).toBe('VALIDATION_ERROR')
    })

    /** The DAG must stay acyclic or the critical path cannot be computed. */
    it('refuses an edge that would close a cycle', async () => {
      await json(session(ownerId, 'owner'), `/${secondPackageId}/dependencies`, 'POST', {
        dependsOnWorkPackageId: packageId,
      })

      const res = await json(session(ownerId, 'owner'), `/${packageId}/dependencies`, 'POST', {
        dependsOnWorkPackageId: secondPackageId,
      })

      expect(res.status).toBeGreaterThanOrEqual(400)
      expect(await handle.db.select().from(workPackageDependencies)).toHaveLength(1)
    })
  })

  describe('GET /project/:projectId/dependencies', () => {
    it('returns the graph to a party', async () => {
      const res = await appAs(session(talentUserId)).request(`/project/${projectId}/dependencies`)

      expect(res.status).toBe(200)
    })

    it('refuses a stranger', async () => {
      const res = await appAs(session(strangerId)).request(`/project/${projectId}/dependencies`)

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.code).toBe('AUTH_FORBIDDEN')
    })
  })
})
