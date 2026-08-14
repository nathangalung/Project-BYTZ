// biome-ignore-all lint/style/noRestrictedImports: the rule keeps route HANDLERS
// off Drizzle. This is a test, and the tables are what the fixtures are made of.

import {
  brdDocuments,
  getDb,
  milestones,
  prdDocuments,
  projectAssignments,
  projects as projectsTable,
  talentProfiles,
  tasks,
  transactions,
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
import { projectsRoute } from './projects'

/**
 * What each class of viewer may read of a project.
 *
 * GET /projects/:id answers without a session so public project pages work,
 * which makes the visibility gate the only thing between a project id and the
 * whole row - including final_price, platform_fee and talent_payout, the three
 * columns the platform's fee framing depends on staying hidden. Four viewer
 * classes have to be distinguished on every read: owner, assigned talent,
 * signed-in stranger and anonymous.
 *
 * Driven through the mounted route with the real database, so the SQL-level
 * filters (deleted_at, visibility, status) are exercised rather than the
 * pure functions alone, which already have unit tests.
 */

const runIf = hasTestDatabase() ? describe : describe.skip
const INTEGRATION_LOCK = sql`SELECT pg_advisory_lock(20260813)`

function session(id: string, role = 'owner'): SessionUser {
  return { id, email: `${id}@example.test`, name: 'Caller', role }
}

/** Mounted route, optionally with a caller. No caller means an anonymous read. */
function app(caller: SessionUser | null) {
  const a = new Hono()
  a.onError(errorHandler)
  a.use('*', async (c, next) => {
    if (caller) c.set('user' as never, caller as never)
    await next()
  })
  a.route('/', projectsRoute)
  return a
}

type ErrorBody = { success: false; error: { code: string; message: string } }
type DetailBody = {
  data: Record<string, unknown> & {
    brd: unknown
    prd: unknown
    scope: unknown
    assignments: unknown[]
  }
}

runIf('project read routes against Postgres', () => {
  let handle: TestHandle

  let ownerId: string
  let talentUserId: string
  let talentId: string
  let strangerId: string

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

  async function makeProject(
    overrides: Partial<typeof projectsTable.$inferInsert> = {},
  ): Promise<string> {
    const id = uuidv7()
    await handle.db.insert(projectsTable).values({
      id,
      ownerId,
      title: 'Marketplace build',
      description: 'A'.repeat(300),
      category: 'web_app',
      budgetMin: 5_000_000,
      budgetMax: 15_000_000,
      estimatedTimelineDays: 60,
      status: 'in_progress',
      visibility: 'public_summary',
      finalPrice: 10_000_000,
      platformFee: 2_850_000,
      talentPayout: 7_150_000,
      projectType: 'company',
      companyName: 'Acme Sdn Bhd',
      companyRole: 'CTO',
      documentFileUrl: 'https://storage.test/spec.pdf',
      documentType: 'pdf',
      preferences: { minExperience: 3 },
      ...overrides,
    })
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

    projectId = await makeProject()

    packageId = uuidv7()
    await handle.db.insert(workPackages).values({
      id: packageId,
      projectId,
      title: 'Backend API',
      description: 'Package',
      orderIndex: 0,
      requiredSkills: ['backend'],
      estimatedHours: 40,
      amount: 10_000_000,
      talentPayout: 7_150_000,
      status: 'assigned',
    })
    await handle.db.insert(projectAssignments).values({
      id: uuidv7(),
      projectId,
      talentId,
      workPackageId: packageId,
      roleLabel: 'Backend Developer',
      acceptanceStatus: 'accepted',
      status: 'active',
    })
  })

  async function makeBrd(overrides: Partial<typeof brdDocuments.$inferInsert> = {}) {
    await handle.db.insert(brdDocuments).values({
      id: uuidv7(),
      projectId,
      content: { executiveSummary: 'Build a marketplace', language: 'id' },
      price: 500_000,
      status: 'approved',
      ...overrides,
    })
  }

  async function makePrd(overrides: Partial<typeof prdDocuments.$inferInsert> = {}) {
    await handle.db.insert(prdDocuments).values({
      id: uuidv7(),
      projectId,
      content: {
        architecture: 'Modular monolith',
        teamSize: 2,
        workPackages: [
          {
            name: 'Backend API',
            requiredSkills: ['backend'],
            estimatedHours: 40,
            amount: 10_000_000,
          },
        ],
      },
      price: 1_500_000,
      status: 'approved',
      ...overrides,
    })
  }

  describe('GET /stats', () => {
    it('counts only projects that have not been deleted', async () => {
      await makeProject({ status: 'completed' })
      const deleted = await makeProject({ status: 'completed' })
      await handle.db
        .update(projectsTable)
        .set({ deletedAt: new Date() })
        .where(eq(projectsTable.id, deleted))

      const res = await app(null).request('/stats')

      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        data: { total: number; completed: number; active: number }
      }
      expect(body.data).toEqual({ total: 2, completed: 1, active: 1 })
    })
  })

  describe('GET /public', () => {
    it('lists a live public project without its owner or money columns', async () => {
      const res = await app(null).request('/public')

      const body = (await res.json()) as { data: { items: Record<string, unknown>[] } }
      expect(body.data.items).toHaveLength(1)
      const item = body.data.items[0] as Record<string, unknown>
      expect(item).not.toHaveProperty('finalPrice')
      expect(item).not.toHaveProperty('platformFee')
      expect(item).not.toHaveProperty('talentPayout')
      expect(item).not.toHaveProperty('ownerId')
      // public_summary truncates the brief and drops the talent preferences.
      expect(String(item.description)).toHaveLength(123)
      expect(item.preferences).toBeNull()
    })

    /** Default visibility is public_summary, so status is what hides drafts. */
    it('hides a project that has not reached a live status', async () => {
      await handle.db
        .update(projectsTable)
        .set({ status: 'scoping' })
        .where(eq(projectsTable.id, projectId))

      const res = await app(null).request('/public')

      expect(((await res.json()) as { data: { total: number } }).data.total).toBe(0)
    })

    it('hides a project the owner marked private', async () => {
      await handle.db
        .update(projectsTable)
        .set({ visibility: 'private' })
        .where(eq(projectsTable.id, projectId))

      const res = await app(null).request('/public')

      expect(((await res.json()) as { data: { total: number } }).data.total).toBe(0)
    })

    it('hides a soft-deleted project', async () => {
      await handle.db
        .update(projectsTable)
        .set({ deletedAt: new Date() })
        .where(eq(projectsTable.id, projectId))

      const res = await app(null).request('/public')

      expect(((await res.json()) as { data: { total: number } }).data.total).toBe(0)
    })

    it('filters by category', async () => {
      const res = await app(null).request('/public?category=mobile_app')

      expect(((await res.json()) as { data: { total: number } }).data.total).toBe(0)
    })

    /** LIMIT and OFFSET came straight off the query string on this route. */
    it('rejects a page that is not a number', async () => {
      const res = await app(null).request('/public?page=abc')

      expect(res.status).toBe(400)
      expect(((await res.json()) as ErrorBody).error.code).toBe('VALIDATION_ERROR')
    })

    it('rejects a category outside the enum rather than letting Postgres answer', async () => {
      const res = await app(null).request('/public?category=nonsense')

      expect(res.status).toBe(400)
    })
  })

  describe('GET /available', () => {
    it('lists only projects still looking for talent', async () => {
      const res = await app(null).request('/available')

      // The fixture is in_progress, so it is not available to apply to.
      expect(((await res.json()) as { data: { total: number } }).data.total).toBe(0)
    })

    it('includes a project in matching, without its money columns', async () => {
      await handle.db
        .update(projectsTable)
        .set({ status: 'matching' })
        .where(eq(projectsTable.id, projectId))

      const res = await app(null).request('/available')

      const body = (await res.json()) as { data: { items: Record<string, unknown>[] } }
      expect(body.data.items).toHaveLength(1)
      expect(body.data.items[0]).not.toHaveProperty('talentPayout')
    })

    it('excludes a private project even though this route needs no session', async () => {
      await handle.db
        .update(projectsTable)
        .set({ status: 'matching', visibility: 'private' })
        .where(eq(projectsTable.id, projectId))

      const res = await app(null).request('/available')

      expect(((await res.json()) as { data: { total: number } }).data.total).toBe(0)
    })

    it('rejects an out-of-range page size', async () => {
      const res = await app(null).request('/available?pageSize=99999')

      expect(res.status).toBe(400)
    })
  })

  describe('GET /', () => {
    it('returns the owner their own project with the money columns intact', async () => {
      const res = await app(session(ownerId)).request('/')

      const body = (await res.json()) as { data: { items: Record<string, unknown>[] } }
      expect(body.data.items[0]?.finalPrice).toBe(10_000_000)
      expect(body.data.items[0]?.platformFee).toBe(2_850_000)
    })

    it('strips the money columns for a signed-in stranger', async () => {
      const res = await app(session(strangerId, 'talent')).request('/')

      const body = (await res.json()) as { data: { items: Record<string, unknown>[] } }
      expect(body.data.items[0]).not.toHaveProperty('finalPrice')
      expect(body.data.items[0]).not.toHaveProperty('talentPayout')
    })

    it('rejects an invalid status filter', async () => {
      const res = await app(session(ownerId)).request('/?status=not_a_status')

      expect(res.status).toBe(400)
      expect(((await res.json()) as ErrorBody).error.code).toBe('VALIDATION_ERROR')
    })
  })

  describe('GET /:id', () => {
    it('gives the owner the whole row', async () => {
      const res = await app(session(ownerId)).request(`/${projectId}`)

      expect(res.status).toBe(200)
      const body = (await res.json()) as DetailBody
      expect(body.data.finalPrice).toBe(10_000_000)
      expect(body.data.companyName).toBe('Acme Sdn Bhd')
    })

    /**
     * A stranger reading a public project must not learn who bought it: ownerId
     * is the join key into every user-scoped route, and the company fields name
     * the buyer outright.
     */
    it('withholds the buyer identity from an anonymous reader', async () => {
      const res = await app(null).request(`/${projectId}`)

      expect(res.status).toBe(200)
      const body = (await res.json()) as DetailBody
      expect(body.data).not.toHaveProperty('ownerId')
      expect(body.data).not.toHaveProperty('companyName')
      expect(body.data).not.toHaveProperty('companyRole')
      expect(body.data).not.toHaveProperty('documentFileUrl')
      expect(body.data).not.toHaveProperty('finalPrice')
    })

    it('gives an assigned talent the full brief but no money', async () => {
      const res = await app(session(talentUserId, 'talent')).request(`/${projectId}`)

      const body = (await res.json()) as DetailBody
      expect(body.data.description).toHaveLength(300)
      expect(body.data.ownerId).toBe(ownerId)
      expect(body.data).not.toHaveProperty('talentPayout')
      expect(body.data).not.toHaveProperty('platformFee')
    })

    /** private answers NOT_FOUND so the response never confirms the id exists. */
    it('reports a private project as not found to a stranger', async () => {
      await handle.db
        .update(projectsTable)
        .set({ visibility: 'private' })
        .where(eq(projectsTable.id, projectId))

      const res = await app(session(strangerId, 'talent')).request(`/${projectId}`)

      expect(res.status).toBe(404)
      expect(((await res.json()) as ErrorBody).error.code).toBe('PROJECT_NOT_FOUND')
    })

    it('still shows a private project to its assigned talent', async () => {
      await handle.db
        .update(projectsTable)
        .set({ visibility: 'private' })
        .where(eq(projectsTable.id, projectId))

      const res = await app(session(talentUserId, 'talent')).request(`/${projectId}`)

      expect(res.status).toBe(200)
    })

    /**
     * The browse lists hide pre-live projects; a direct link has to hide them
     * too or the owner's private workspace is one guessed id away.
     */
    it('reports a pre-live project as not found to a stranger', async () => {
      await handle.db
        .update(projectsTable)
        .set({ status: 'scoping' })
        .where(eq(projectsTable.id, projectId))

      const res = await app(null).request(`/${projectId}`)

      expect(res.status).toBe(404)
    })

    it('still shows a pre-live project to its owner', async () => {
      await handle.db
        .update(projectsTable)
        .set({ status: 'scoping' })
        .where(eq(projectsTable.id, projectId))

      const res = await app(session(ownerId)).request(`/${projectId}`)

      expect(res.status).toBe(200)
    })

    it('withholds both documents from an anonymous reader', async () => {
      await makeBrd()
      await makePrd()

      const res = await app(null).request(`/${projectId}`)

      const body = (await res.json()) as DetailBody
      expect(body.data.brd).toBeNull()
      expect(body.data.prd).toBeNull()
    })

    it('returns both documents to the owner', async () => {
      await makeBrd()
      await makePrd()

      const res = await app(session(ownerId)).request(`/${projectId}`)

      const body = (await res.json()) as DetailBody
      expect(body.data.brd).not.toBeNull()
      expect(body.data.prd).not.toBeNull()
    })

    it('returns both documents to an assigned talent as their brief', async () => {
      await makeBrd()
      await makePrd()

      const res = await app(session(talentUserId, 'talent')).request(`/${projectId}`)

      const body = (await res.json()) as DetailBody
      expect(body.data.brd).not.toBeNull()
      expect(body.data.prd).not.toBeNull()
    })

    /**
     * A row reserving an in-flight generation carries version 0 and no content;
     * reporting it as a document shows an empty one.
     */
    it('ignores a document row still reserving a generation', async () => {
      await makeBrd({ version: 0, content: {} })

      const res = await app(session(ownerId)).request(`/${projectId}`)

      expect(((await res.json()) as DetailBody).data.brd).toBeNull()
    })

    /**
     * On public_detail the owner chose to advertise the work. The stranger gets
     * a scope projection built as an allowlist, never the priced document.
     */
    it('offers a stranger the scope projection on a public_detail project', async () => {
      await handle.db
        .update(projectsTable)
        .set({ visibility: 'public_detail' })
        .where(eq(projectsTable.id, projectId))
      await makePrd()

      const res = await app(null).request(`/${projectId}`)

      const body = (await res.json()) as DetailBody
      expect(body.data.prd).toBeNull()
      const scope = body.data.scope as { workPackages: Record<string, unknown>[] }
      expect(scope.workPackages[0]?.name).toBe('Backend API')
      // The bracket table is published, so an amount reconstructs the payout.
      expect(scope.workPackages[0]).not.toHaveProperty('amount')
    })

    it('offers no scope projection on a public_summary project', async () => {
      await makePrd()

      const res = await app(null).request(`/${projectId}`)

      expect(((await res.json()) as DetailBody).data.scope).toBeNull()
    })

    it('lists the team to the owner and to nobody outside it', async () => {
      const ownerRes = await app(session(ownerId)).request(`/${projectId}`)
      const strangerRes = await app(null).request(`/${projectId}`)

      const ownerBody = (await ownerRes.json()) as DetailBody
      expect(ownerBody.data.assignments).toHaveLength(1)
      expect((ownerBody.data.assignments[0] as { talentUserId: string }).talentUserId).toBe(
        talentUserId,
      )
      expect(((await strangerRes.json()) as DetailBody).data.assignments).toEqual([])
    })

    it('reports an unknown id as not found', async () => {
      const res = await app(session(ownerId)).request(`/${uuidv7()}`)

      expect(res.status).toBe(404)
      expect(((await res.json()) as ErrorBody).error.code).toBe('PROJECT_NOT_FOUND')
    })
  })

  describe('GET /:id/brd', () => {
    it('returns the BRD to the owner', async () => {
      await makeBrd()

      const res = await app(session(ownerId)).request(`/${projectId}/brd`)

      expect(res.status).toBe(200)
      expect(((await res.json()) as { data: unknown }).data).not.toBeNull()
    })

    it('returns null when no BRD has been generated', async () => {
      const res = await app(session(ownerId)).request(`/${projectId}/brd`)

      expect(res.status).toBe(200)
      expect(((await res.json()) as { data: unknown }).data).toBeNull()
    })

    /** The BRD is the owner's business brief, not the talent's brief. */
    it('refuses the assigned talent', async () => {
      await makeBrd()

      const res = await app(session(talentUserId, 'talent')).request(`/${projectId}/brd`)

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.message).toContain('owner')
    })

    it('refuses a signed-in stranger', async () => {
      await makeBrd()

      const res = await app(session(strangerId, 'talent')).request(`/${projectId}/brd`)

      expect(res.status).toBe(403)
    })
  })

  describe('GET /:id/prd', () => {
    it('returns the PRD to the owner', async () => {
      await makePrd()

      const res = await app(session(ownerId)).request(`/${projectId}/prd`)

      expect(res.status).toBe(200)
      expect(((await res.json()) as { data: unknown }).data).not.toBeNull()
    })

    /** Deliverables and acceptance criteria are what the talent works from. */
    it('returns the PRD to an assigned talent', async () => {
      await makePrd()

      const res = await app(session(talentUserId, 'talent')).request(`/${projectId}/prd`)

      expect(res.status).toBe(200)
      expect(((await res.json()) as { data: unknown }).data).not.toBeNull()
    })

    it('refuses a signed-in stranger', async () => {
      await makePrd()

      const res = await app(session(strangerId, 'talent')).request(`/${projectId}/prd`)

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.code).toBe('AUTH_FORBIDDEN')
    })

    it('reports an unknown project as not found', async () => {
      const res = await app(session(ownerId)).request(`/${uuidv7()}/prd`)

      expect(res.status).toBe(404)
    })
  })

  describe('document PDF downloads', () => {
    async function pay(kind: 'brd' | 'prd') {
      await handle.db.insert(transactions).values({
        id: uuidv7(),
        projectId,
        type: kind === 'brd' ? 'brd_payment' : 'prd_payment',
        amount: 500_000,
        status: 'completed',
        idempotencyKey: `${kind}-${uuidv7()}`,
      })
    }

    it('renders the clean BRD PDF once it has been paid for', async () => {
      await makeBrd()
      await pay('brd')

      const res = await app(session(ownerId)).request(`/${projectId}/brd/pdf`)

      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Type')).toBe('application/pdf')
      expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0)
    })

    /** The clean download is the paid deliverable; the preview is watermarked. */
    it('refuses the BRD PDF before payment', async () => {
      await makeBrd()

      const res = await app(session(ownerId)).request(`/${projectId}/brd/pdf`)

      expect(res.status).toBe(402)
      expect(((await res.json()) as ErrorBody).error.code).toBe('DOCUMENT_NOT_PAID')
    })

    it('backfills paid_at from a completed payment whose callback was dropped', async () => {
      await makeBrd()
      await pay('brd')

      await app(session(ownerId)).request(`/${projectId}/brd/pdf`)

      const [row] = await handle.db
        .select({ paidAt: brdDocuments.paidAt })
        .from(brdDocuments)
        .where(eq(brdDocuments.projectId, projectId))
      expect(row?.paidAt).not.toBeNull()
    })

    /**
     * The negative half of the PRD access rule: the document is readable by an
     * assigned talent, the clean download is not.
     */
    it('refuses the PRD PDF to an assigned talent even after payment', async () => {
      await makePrd()
      await pay('prd')

      const res = await app(session(talentUserId, 'talent')).request(`/${projectId}/prd/pdf`)

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.message).toContain(
        'Only the project owner can download the PRD',
      )
    })

    it('refuses the BRD PDF to an assigned talent', async () => {
      await makeBrd()
      await pay('brd')

      const res = await app(session(talentUserId, 'talent')).request(`/${projectId}/brd/pdf`)

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.message).toContain(
        'Only the project owner can download the BRD',
      )
    })

    it('renders the clean PRD PDF for a paid owner', async () => {
      await makePrd()
      await pay('prd')

      const res = await app(session(ownerId)).request(`/${projectId}/prd/pdf`)

      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Type')).toBe('application/pdf')
    })

    it('reports a missing document rather than rendering an empty PDF', async () => {
      const res = await app(session(ownerId)).request(`/${projectId}/prd/pdf`)

      expect(res.status).toBe(404)
      expect(((await res.json()) as ErrorBody).error.code).toBe('NOT_FOUND')
    })
  })

  describe('GET /:id/tasks', () => {
    beforeEach(async () => {
      const milestoneId = uuidv7()
      await handle.db.insert(milestones).values({
        id: milestoneId,
        projectId,
        workPackageId: packageId,
        assignedTalentId: talentId,
        title: 'Milestone one',
        description: 'First',
        orderIndex: 0,
        amount: 5_000_000,
        dueDate: new Date(Date.now() + 86_400_000),
      })
      await handle.db.insert(tasks).values({
        id: uuidv7(),
        milestoneId,
        title: 'Build the endpoint',
        orderIndex: 0,
        estimatedHours: 8,
      })
    })

    it('returns the Gantt data to the owner', async () => {
      const res = await app(session(ownerId)).request(`/${projectId}/tasks`)

      expect(res.status).toBe(200)
      const body = (await res.json()) as { data: { tasks: unknown[]; dependencies: unknown[] } }
      expect(body.data.tasks).toHaveLength(1)
    })

    it('returns it to an assigned talent', async () => {
      const res = await app(session(talentUserId, 'talent')).request(`/${projectId}/tasks`)

      expect(res.status).toBe(200)
    })

    it('refuses a signed-in stranger', async () => {
      const res = await app(session(strangerId, 'talent')).request(`/${projectId}/tasks`)

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.code).toBe('AUTH_FORBIDDEN')
    })

    it('reports an unknown project as not found', async () => {
      const res = await app(session(ownerId)).request(`/${uuidv7()}/tasks`)

      expect(res.status).toBe(404)
    })
  })

  describe('POST /', () => {
    const body = {
      title: 'New marketplace',
      description: 'Build a curated marketplace for local businesses',
      category: 'web_app' as const,
      budgetMin: 5_000_000,
      budgetMax: 15_000_000,
      estimatedTimelineDays: 60,
    }

    function post(caller: SessionUser, payload: unknown) {
      return app(caller).request('/', {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      })
    }

    it('creates a draft owned by the caller', async () => {
      const res = await post(session(strangerId), body)

      expect(res.status).toBe(201)
      const created = (await res.json()) as { data: { id: string; status: string } }
      const [row] = await handle.db
        .select()
        .from(projectsTable)
        .where(eq(projectsTable.id, created.data.id))
      expect(row?.ownerId).toBe(strangerId)
      expect(row?.status).toBe('draft')
    })

    /** Dropping this made private unreachable outside the seed. */
    it('persists the visibility the owner chose', async () => {
      const res = await post(session(strangerId), { ...body, visibility: 'private' })

      const created = (await res.json()) as { data: { id: string } }
      const [row] = await handle.db
        .select({ visibility: projectsTable.visibility })
        .from(projectsTable)
        .where(eq(projectsTable.id, created.data.id))
      expect(row?.visibility).toBe('private')
    })

    it('rejects a body the schema does not accept', async () => {
      const res = await post(session(strangerId), { ...body, title: 'no' })

      expect(res.status).toBe(400)
      expect(((await res.json()) as ErrorBody).error.code).toBe('VALIDATION_ERROR')
    })

    it('rejects a budget range that runs backwards', async () => {
      const res = await post(session(strangerId), {
        ...body,
        budgetMin: 10_000_000,
        budgetMax: 1_000_000,
      })

      expect(res.status).toBeGreaterThanOrEqual(400)
    })
  })

  describe('PATCH /:id', () => {
    function patch(caller: SessionUser, payload: unknown, id = projectId) {
      return app(caller).request(`/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      })
    }

    it('refuses a signed-in stranger', async () => {
      const res = await patch(session(strangerId), { title: 'Hijacked' })

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.message).toContain('owner')
    })

    it('refuses the assigned talent', async () => {
      const res = await patch(session(talentUserId, 'talent'), { title: 'Renamed' })

      expect(res.status).toBe(403)
    })

    /** Scope is frozen once work has started. */
    it('refuses a scope edit on a live project', async () => {
      const res = await patch(session(ownerId), { title: 'Renamed mid-flight' })

      expect(res.status).toBe(400)
      expect(((await res.json()) as ErrorBody).error.code).toBe('PROJECT_VALIDATION_INVALID_STATUS')
    })

    /**
     * Visibility is a privacy flag, not a scope edit, so the owner has to be
     * able to retract a live public project.
     */
    it('allows a visibility-only change on a live project', async () => {
      const res = await patch(session(ownerId), { visibility: 'private' })

      expect(res.status).toBe(200)
      const [row] = await handle.db
        .select({ visibility: projectsTable.visibility })
        .from(projectsTable)
        .where(eq(projectsTable.id, projectId))
      expect(row?.visibility).toBe('private')
    })

    it('allows a scope edit while the project is still editable', async () => {
      await handle.db
        .update(projectsTable)
        .set({ status: 'draft' })
        .where(eq(projectsTable.id, projectId))

      const res = await patch(session(ownerId), { title: 'Renamed while draft' })

      expect(res.status).toBe(200)
    })

    it('rejects a budget range that runs backwards', async () => {
      await handle.db
        .update(projectsTable)
        .set({ status: 'draft' })
        .where(eq(projectsTable.id, projectId))

      const res = await patch(session(ownerId), { budgetMin: 9_000_000, budgetMax: 1_000_000 })

      expect(res.status).toBe(400)
    })

    it('reports an unknown project as not found', async () => {
      const res = await patch(session(ownerId), { visibility: 'private' }, uuidv7())

      expect(res.status).toBe(404)
    })

    it('rejects an update the schema does not accept', async () => {
      const res = await patch(session(ownerId), { budgetMin: -5 })

      expect(res.status).toBe(400)
      expect(((await res.json()) as ErrorBody).error.code).toBe('VALIDATION_ERROR')
    })
  })
})
