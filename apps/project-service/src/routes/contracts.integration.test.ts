// biome-ignore-all lint/style/noRestrictedImports: the rule keeps route HANDLERS
// off Drizzle. This is a test, and the tables are what the fixtures are made of.

import {
  contracts,
  getDb,
  outboxEvents,
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
import { contractRoute } from './contracts'

/**
 * The NDA and IP transfer that bind the two sides of a work package.
 *
 * Both signatories are derived from the session and the assignment rather than
 * taken from the body, so the tests that matter are the ones proving the
 * derivation cannot be steered: an assignment that belongs to a different
 * project must not be attachable to this one, and a caller who is neither
 * party must not be able to sign.
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
  app.route('/', contractRoute)
  return app
}

type ErrorBody = { success: false; error: { code: string; message: string } }

function json(caller: SessionUser, path: string, method: string, body?: unknown) {
  return appAs(caller).request(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

runIf('contract routes against Postgres', () => {
  let handle: TestHandle

  let ownerId: string
  let talentUserId: string
  let talentId: string
  let strangerId: string

  let projectId: string
  let assignmentId: string
  let foreignProjectId: string
  let foreignAssignmentId: string

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

  /** Project with one work package and one active assignment on it. */
  async function makeProjectWithAssignment(
    owner: string,
    talent: string,
    status: 'active' | 'terminated' = 'active',
  ): Promise<{ projectId: string; assignmentId: string }> {
    const pid = uuidv7()
    await handle.db.insert(projects).values({
      id: pid,
      ownerId: owner,
      title: 'Contracted project',
      description: 'Exercises contract authorisation',
      category: 'web_app',
      budgetMin: 1_000_000,
      budgetMax: 10_000_000,
      estimatedTimelineDays: 60,
      status: 'matched',
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
      amount: 5_000_000,
      talentPayout: 3_575_000,
      status: 'assigned',
    })
    const aid = uuidv7()
    await handle.db.insert(projectAssignments).values({
      id: aid,
      projectId: pid,
      talentId: talent,
      workPackageId: wpId,
      roleLabel: 'Backend Developer',
      acceptanceStatus: 'accepted',
      status,
    })
    return { projectId: pid, assignmentId: aid }
  }

  beforeEach(async () => {
    await handle.truncate()

    ownerId = await makeUser('owner')
    talentUserId = await makeUser('talent')
    talentId = await makeTalent(talentUserId)
    strangerId = await makeUser('stranger')

    const main = await makeProjectWithAssignment(ownerId, talentId)
    projectId = main.projectId
    assignmentId = main.assignmentId

    const foreignOwner = await makeUser('foreign-owner')
    const foreignTalentUser = await makeUser('foreign-talent')
    const foreignTalent = await makeTalent(foreignTalentUser)
    const foreign = await makeProjectWithAssignment(foreignOwner, foreignTalent)
    foreignProjectId = foreign.projectId
    foreignAssignmentId = foreign.assignmentId
  })

  const content = {
    scope: 'Deliver the backend API described in the PRD',
    confidentiality: 'Both parties keep project information confidential',
    ipTransfer: 'All deliverables become the property of the owner on payment',
  }

  const body = (overrides: Record<string, unknown> = {}) => ({
    projectId,
    assignmentId,
    type: 'standard_nda' as const,
    content,
    ...overrides,
  })

  async function makeContract(type: 'standard_nda' | 'ip_transfer' = 'standard_nda') {
    const id = uuidv7()
    await handle.db.insert(contracts).values({
      id,
      projectId,
      assignmentId,
      type,
      content: { ...content, parties: { owner: 'Owner', talent: 'Talent' } },
    })
    return id
  }

  describe('POST /', () => {
    it('creates a contract naming both parties from the server side', async () => {
      const res = await json(session(ownerId, 'owner'), '/', 'POST', body())

      expect(res.status).toBe(201)
      const [row] = await handle.db.select().from(contracts)
      const content = row?.content as { parties: { owner: string; talent: string } } | undefined
      expect(content?.parties.talent).toBe('talent')
      expect(content?.parties.owner).toBe('owner')
      expect(row?.signedByOwner).toBe(false)
      expect(row?.signedByTalent).toBe(false)
    })

    it('records a contract.created outbox event', async () => {
      await json(session(ownerId, 'owner'), '/', 'POST', body())

      const events = await handle.db.select({ type: outboxEvents.eventType }).from(outboxEvents)
      expect(events).toEqual([{ type: 'contract.created' }])
    })

    /**
     * The forgery this guard exists to stop. Authorising the project and
     * resolving the assignment separately let an owner pair their own project
     * with a stranger's assignment, and GET and PATCH derive the talent party
     * from assignmentId - so that stranger became a signatory on an agreement
     * they never negotiated.
     */
    it('refuses an assignment that belongs to a different project', async () => {
      const res = await json(
        session(ownerId, 'owner'),
        '/',
        'POST',
        body({ assignmentId: foreignAssignmentId }),
      )

      expect(res.status).toBe(404)
      expect(((await res.json()) as ErrorBody).error.message).toContain('Assignment not found')
      expect(await handle.db.select().from(contracts)).toHaveLength(0)
    })

    it('refuses a project the caller does not own', async () => {
      const res = await json(
        session(ownerId, 'owner'),
        '/',
        'POST',
        body({ projectId: foreignProjectId, assignmentId: foreignAssignmentId }),
      )

      expect(res.status).toBe(403)
      expect(await handle.db.select().from(contracts)).toHaveLength(0)
    })

    /** The contract is the owner's instrument; the talent signs, not drafts. */
    it('refuses the assigned talent', async () => {
      const res = await json(session(talentUserId), '/', 'POST', body())

      expect(res.status).toBe(403)
    })

    it('refuses an assignment that is no longer live', async () => {
      await handle.db
        .update(projectAssignments)
        .set({ status: 'terminated' })
        .where(eq(projectAssignments.id, assignmentId))

      const res = await json(session(ownerId, 'owner'), '/', 'POST', body())

      expect(res.status).toBe(404)
    })

    it('refuses a second contract of the same type on one assignment', async () => {
      await json(session(ownerId, 'owner'), '/', 'POST', body())

      const res = await json(session(ownerId, 'owner'), '/', 'POST', body())

      expect(res.status).toBe(409)
      expect(((await res.json()) as ErrorBody).error.code).toBe('CONFLICT')
      expect(await handle.db.select().from(contracts)).toHaveLength(1)
    })

    it('allows the IP transfer alongside the NDA', async () => {
      await json(session(ownerId, 'owner'), '/', 'POST', body())

      const res = await json(session(ownerId, 'owner'), '/', 'POST', body({ type: 'ip_transfer' }))

      expect(res.status).toBe(201)
      expect(await handle.db.select().from(contracts)).toHaveLength(2)
    })

    /** Parties are not a body field; the terms are all the caller supplies. */
    it('rejects a body the schema does not accept', async () => {
      const res = await json(
        session(ownerId, 'owner'),
        '/',
        'POST',
        body({ content: { scope: '' } }),
      )

      expect(res.status).toBe(400)
      expect(((await res.json()) as ErrorBody).error.code).toBe('VALIDATION_ERROR')
    })
  })

  describe('GET /:id', () => {
    it('returns the contract to the owner', async () => {
      const id = await makeContract()

      const res = await appAs(session(ownerId, 'owner')).request(`/${id}`)

      expect(res.status).toBe(200)
    })

    it('returns it to the assigned talent', async () => {
      const id = await makeContract()

      const res = await appAs(session(talentUserId)).request(`/${id}`)

      expect(res.status).toBe(200)
    })

    it('refuses a signed-in stranger', async () => {
      const id = await makeContract()

      const res = await appAs(session(strangerId)).request(`/${id}`)

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.code).toBe('AUTH_FORBIDDEN')
    })

    it('reports an unknown contract as not found', async () => {
      const res = await appAs(session(ownerId, 'owner')).request(`/${uuidv7()}`)

      expect(res.status).toBe(404)
    })
  })

  describe('GET /project/:projectId', () => {
    it('lists the contracts for a party', async () => {
      await makeContract()

      const res = await appAs(session(talentUserId)).request(`/project/${projectId}`)

      expect(res.status).toBe(200)
      expect(((await res.json()) as { data: unknown[] }).data).toHaveLength(1)
    })

    it('refuses a stranger', async () => {
      const res = await appAs(session(strangerId)).request(`/project/${projectId}`)

      expect(res.status).toBe(403)
    })
  })

  describe('PATCH /:id/sign', () => {
    it('signs as the owner when the owner calls', async () => {
      const id = await makeContract()

      const res = await json(session(ownerId, 'owner'), `/${id}/sign`, 'PATCH')

      expect(res.status).toBe(200)
      const [row] = await handle.db.select().from(contracts).where(eq(contracts.id, id))
      expect(row?.signedByOwner).toBe(true)
      expect(row?.signedByTalent).toBe(false)
      expect(row?.signedAt).toBeNull()
    })

    /** Which party is signing follows from the session, never from the body. */
    it('signs as the talent when the talent calls', async () => {
      const id = await makeContract()

      await json(session(talentUserId), `/${id}/sign`, 'PATCH')

      const [row] = await handle.db.select().from(contracts).where(eq(contracts.id, id))
      expect(row?.signedByTalent).toBe(true)
      expect(row?.signedByOwner).toBe(false)
    })

    it('stamps signedAt and announces execution once both have signed', async () => {
      const id = await makeContract()

      await json(session(ownerId, 'owner'), `/${id}/sign`, 'PATCH')
      await json(session(talentUserId), `/${id}/sign`, 'PATCH')

      const [row] = await handle.db.select().from(contracts).where(eq(contracts.id, id))
      expect(row?.signedAt).not.toBeNull()
      const events = await handle.db.select({ type: outboxEvents.eventType }).from(outboxEvents)
      expect(events.map((e) => e.type)).toEqual([
        'contract.signed',
        'contract.signed',
        'contract.fully_executed',
      ])
    })

    it('refuses a signed-in stranger', async () => {
      const id = await makeContract()

      const res = await json(session(strangerId), `/${id}/sign`, 'PATCH')

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.message).toContain('owner or the assigned')
      const [row] = await handle.db.select().from(contracts).where(eq(contracts.id, id))
      expect(row?.signedByOwner).toBe(false)
      expect(row?.signedByTalent).toBe(false)
    })

    it('refuses a second signature from the same party', async () => {
      const id = await makeContract()
      await json(session(ownerId, 'owner'), `/${id}/sign`, 'PATCH')

      const res = await json(session(ownerId, 'owner'), `/${id}/sign`, 'PATCH')

      expect(res.status).toBe(409)
      expect(((await res.json()) as ErrorBody).error.message).toContain('already signed by owner')
    })

    it('refuses a second talent signature', async () => {
      const id = await makeContract()
      await json(session(talentUserId), `/${id}/sign`, 'PATCH')

      const res = await json(session(talentUserId), `/${id}/sign`, 'PATCH')

      expect(res.status).toBe(409)
      expect(((await res.json()) as ErrorBody).error.message).toContain('already signed by talent')
    })

    it('reports an unknown contract as not found', async () => {
      const res = await json(session(ownerId, 'owner'), `/${uuidv7()}/sign`, 'PATCH')

      expect(res.status).toBe(404)
    })
  })
})
