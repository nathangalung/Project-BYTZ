// biome-ignore-all lint/style/noRestrictedImports: the rule keeps route HANDLERS
// off Drizzle. This is a test, and the tables are what the fixtures are made of.

import {
  disputes,
  getDb,
  projectAssignments,
  projectStatusLogs,
  projects,
  talentProfiles,
  transactions,
  user,
  workPackages,
} from '@kerjacus/db'
import { connectTestDatabase, hasTestDatabase, type TestHandle } from '@kerjacus/db/testing'
import { eq, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { uuidv7 } from 'uuidv7'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { errorHandler } from '../middleware/error-handler'
import type { SessionUser } from '../middleware/session'
import { disputeRoute } from './disputes'

/**
 * Disputes freeze a project and then move its escrow, so every guard here is
 * either an access-control decision or a money decision.
 *
 * Temporal is stubbed because the workflow start is fire-and-forget and a real
 * connect attempt would add a multi-second failure to every create. The payment
 * service is stubbed at `fetch`, one level below payment-client.ts, so the
 * refund request the service actually builds - amounts, idempotency keys, one
 * call per escrow deposit - is what gets asserted.
 */

vi.mock('../lib/temporal-client', () => ({
  getTemporalClient: async () => null,
  TEMPORAL_TASK_QUEUE: 'test',
  disputeResolutionWorkflowId: (id: string) => `dispute-${id}`,
  milestoneAutoReleaseWorkflowId: (id: string) => `auto-release-${id}`,
  teamFormationWorkflowId: (id: string) => `team-formation-${id}`,
}))

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
  app.route('/', disputeRoute)
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

/** Requests the payment service saw, in order. */
type PaymentCall = { url: string; body: Record<string, unknown> | null }

runIf('dispute routes against Postgres', () => {
  let handle: TestHandle
  let payments: PaymentCall[]
  let escrowBalance: number

  let ownerId: string
  let talentUserId: string
  let talentId: string
  let otherTalentUserId: string
  let otherTalentId: string
  let strangerId: string
  let adminId: string

  let projectId: string
  let packageId: string
  let otherPackageId: string

  beforeAll(async () => {
    handle = await connectTestDatabase()
    await handle.db.execute(INTEGRATION_LOCK)
    getDb(process.env.TEST_DATABASE_URL)
  }, 120_000)

  afterAll(async () => {
    await handle.close()
  })

  beforeEach(async () => {
    await handle.truncate()
    payments = []
    escrowBalance = 0

    vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url)
      payments.push({
        url: href,
        body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
      })
      if (href.includes('/escrow-balance/')) {
        return new Response(JSON.stringify({ success: true, data: { balance: escrowBalance } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    ownerId = await makeUser('owner')
    talentUserId = await makeUser('talent')
    talentId = await makeTalent(talentUserId)
    otherTalentUserId = await makeUser('other-talent')
    otherTalentId = await makeTalent(otherTalentUserId)
    strangerId = await makeUser('stranger')
    adminId = await makeUser('admin')

    projectId = uuidv7()
    await handle.db.insert(projects).values({
      id: projectId,
      ownerId,
      title: 'Disputed project',
      description: 'Exercises the dispute guards',
      category: 'web_app',
      budgetMin: 1_000_000,
      budgetMax: 10_000_000,
      estimatedTimelineDays: 60,
      status: 'in_progress',
      teamSize: 2,
    })

    packageId = await makePackage('Backend API', 0)
    otherPackageId = await makePackage('Frontend', 1)

    await handle.db.insert(projectAssignments).values({
      id: uuidv7(),
      projectId,
      talentId,
      workPackageId: packageId,
      acceptanceStatus: 'accepted',
      status: 'active',
    })
    await handle.db.insert(projectAssignments).values({
      id: uuidv7(),
      projectId,
      talentId: otherTalentId,
      workPackageId: otherPackageId,
      acceptanceStatus: 'accepted',
      status: 'active',
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
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

  async function makePackage(title: string, order: number): Promise<string> {
    const id = uuidv7()
    await handle.db.insert(workPackages).values({
      id,
      projectId,
      title,
      description: 'Package',
      orderIndex: order,
      requiredSkills: ['backend'],
      estimatedHours: 40,
      amount: 3_000_000,
      talentPayout: 2_145_000,
      status: 'assigned',
    })
    return id
  }

  async function makeDispute(overrides: Partial<typeof disputes.$inferInsert> = {}) {
    const id = uuidv7()
    await handle.db.insert(disputes).values({
      id,
      projectId,
      initiatedBy: ownerId,
      againstUserId: talentUserId,
      reason: 'Deliverable does not match the PRD at all',
      status: 'open',
      ...overrides,
    })
    return id
  }

  const validBody = () => ({
    projectId,
    againstUserId: talentUserId,
    reason: 'The deliverable does not match the agreed specification',
  })

  describe('POST /', () => {
    it('opens a dispute and freezes the project in the same transaction', async () => {
      const res = await json(session(ownerId, 'owner'), '/', 'POST', validBody())

      expect(res.status).toBe(201)
      const [project] = await handle.db
        .select({ status: projects.status })
        .from(projects)
        .where(eq(projects.id, projectId))
      expect(project?.status).toBe('disputed')
      const logs = await handle.db
        .select({ from: projectStatusLogs.fromStatus, to: projectStatusLogs.toStatus })
        .from(projectStatusLogs)
      expect(logs).toEqual([{ from: 'in_progress', to: 'disputed' }])
    })

    it('rejects a reason shorter than the schema allows', async () => {
      const res = await json(session(ownerId, 'owner'), '/', 'POST', {
        ...validBody(),
        reason: 'nope',
      })

      expect(res.status).toBe(400)
      expect(((await res.json()) as ErrorBody).error.code).toBe('VALIDATION_ERROR')
      expect(await handle.db.select().from(disputes)).toHaveLength(0)
    })

    it('refuses a signed-in stranger to the project', async () => {
      const res = await json(session(strangerId), '/', 'POST', validBody())

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.code).toBe('AUTH_FORBIDDEN')
    })

    it('refuses a dispute opened against yourself', async () => {
      const res = await json(session(ownerId, 'owner'), '/', 'POST', {
        ...validBody(),
        againstUserId: ownerId,
      })

      expect(res.status).toBe(400)
      expect(((await res.json()) as ErrorBody).error.message).toContain('against yourself')
    })

    /**
     * changeStatus treats againstUserId as standing, so an unchecked id here
     * would let any user in the system be made a party to a case they have no
     * connection to.
     */
    it('refuses a respondent who was never a party to the project', async () => {
      const res = await json(session(ownerId, 'owner'), '/', 'POST', {
        ...validBody(),
        againstUserId: strangerId,
      })

      expect(res.status).toBe(400)
      expect(((await res.json()) as ErrorBody).error.message).toContain('not a party')
      expect(await handle.db.select().from(disputes)).toHaveLength(0)
    })

    /**
     * The package decides whose escrow a resolution refunds. A talent scoping
     * their dispute to a teammate's package aims the outcome at that
     * teammate's money.
     */
    it("refuses a talent scoping a dispute to a teammate's work package", async () => {
      const res = await json(session(talentUserId), '/', 'POST', {
        projectId,
        againstUserId: ownerId,
        reason: 'The owner has not responded to my submissions for two weeks',
        workPackageId: otherPackageId,
      })

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.code).toBe('AUTH_FORBIDDEN')
      expect(await handle.db.select().from(disputes)).toHaveLength(0)
    })

    it('lets a talent scope a dispute to their own work package', async () => {
      const res = await json(session(talentUserId), '/', 'POST', {
        projectId,
        againstUserId: ownerId,
        reason: 'The owner has not responded to my submissions for two weeks',
        workPackageId: packageId,
      })

      expect(res.status).toBe(201)
    })

    it('reports a work package from another project as not found', async () => {
      const foreignOwner = await makeUser('foreign-owner')
      const foreignProject = uuidv7()
      await handle.db.insert(projects).values({
        id: foreignProject,
        ownerId: foreignOwner,
        title: 'Elsewhere',
        description: 'Another project entirely',
        category: 'web_app',
        budgetMin: 1_000_000,
        budgetMax: 2_000_000,
        estimatedTimelineDays: 10,
      })
      const foreignPackage = uuidv7()
      await handle.db.insert(workPackages).values({
        id: foreignPackage,
        projectId: foreignProject,
        title: 'Foreign package',
        description: 'Package',
        orderIndex: 0,
        requiredSkills: [],
        estimatedHours: 1,
        amount: 1_000_000,
        talentPayout: 815_000,
      })

      const res = await json(session(ownerId, 'owner'), '/', 'POST', {
        ...validBody(),
        workPackageId: foreignPackage,
      })

      expect(res.status).toBe(404)
    })

    /** A dispute freezes the project, so it is only meaningful from a live state. */
    it('refuses to open a dispute on a project that has not started', async () => {
      await handle.db.update(projects).set({ status: 'draft' }).where(eq(projects.id, projectId))

      const res = await json(session(ownerId, 'owner'), '/', 'POST', validBody())

      expect(res.status).toBe(409)
      expect(((await res.json()) as ErrorBody).error.code).toBe('CONFLICT')
    })

    it('refuses a second dispute while the project is already disputed', async () => {
      await json(session(ownerId, 'owner'), '/', 'POST', validBody())

      const res = await json(session(ownerId, 'owner'), '/', 'POST', validBody())

      expect(res.status).toBe(409)
      expect(await handle.db.select().from(disputes)).toHaveLength(1)
    })
  })

  describe('GET /', () => {
    it('returns every dispute to an admin', async () => {
      await makeDispute()

      const res = await appAs(session(adminId, 'admin')).request('/')

      expect(res.status).toBe(200)
      const body = (await res.json()) as { data: { items: unknown[]; total: number } }
      expect(body.data.total).toBe(1)
    })

    /** The platform-wide list carries evidence links and both parties on every case. */
    it('refuses the project owner', async () => {
      const res = await appAs(session(ownerId, 'owner')).request('/')

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.code).toBe('AUTH_FORBIDDEN')
    })

    it('rejects a page that is not a number rather than passing NaN to the offset', async () => {
      const res = await appAs(session(adminId, 'admin')).request('/?page=abc')

      expect(res.status).toBe(400)
      expect(((await res.json()) as ErrorBody).error.code).toBe('VALIDATION_ERROR')
    })

    it('filters by status', async () => {
      await makeDispute()
      await makeDispute({ status: 'resolved' })

      const res = await appAs(session(adminId, 'admin')).request('/?status=resolved')

      const body = (await res.json()) as { data: { total: number } }
      expect(body.data.total).toBe(1)
    })
  })

  describe('GET /:id', () => {
    it('reports an unknown dispute as not found', async () => {
      const res = await appAs(session(adminId, 'admin')).request(`/${uuidv7()}`)

      expect(res.status).toBe(404)
      expect(((await res.json()) as ErrorBody).error.code).toBe('DISPUTE_NOT_FOUND')
    })

    it('returns it to the talent it was raised against', async () => {
      const id = await makeDispute()

      const res = await appAs(session(talentUserId)).request(`/${id}`)

      expect(res.status).toBe(200)
    })

    it('returns it to a teammate on the project', async () => {
      const id = await makeDispute()

      const res = await appAs(session(otherTalentUserId)).request(`/${id}`)

      expect(res.status).toBe(200)
    })

    it('refuses a signed-in stranger', async () => {
      const id = await makeDispute()

      const res = await appAs(session(strangerId)).request(`/${id}`)

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.code).toBe('AUTH_FORBIDDEN')
    })
  })

  describe('GET /project/:projectId', () => {
    it('lists them for a party', async () => {
      await makeDispute()

      const res = await appAs(session(talentUserId)).request(`/project/${projectId}`)

      expect(res.status).toBe(200)
      expect(((await res.json()) as { data: unknown[] }).data).toHaveLength(1)
    })

    it('lists them for an admin who is not a party', async () => {
      await makeDispute()

      const res = await appAs(session(adminId, 'admin')).request(`/project/${projectId}`)

      expect(res.status).toBe(200)
    })

    it('refuses a stranger', async () => {
      const res = await appAs(session(strangerId)).request(`/project/${projectId}`)

      expect(res.status).toBe(403)
    })
  })

  describe('PATCH /:id/status', () => {
    it('lets an admin move an open dispute to review', async () => {
      const id = await makeDispute()

      const res = await json(session(adminId, 'admin'), `/${id}/status`, 'PATCH', {
        status: 'under_review',
      })

      expect(res.status).toBe(200)
      const [row] = await handle.db.select().from(disputes).where(eq(disputes.id, id))
      expect(row?.status).toBe('under_review')
    })

    /**
     * A party moving their own case to review would be putting the platform in
     * the middle on their own say-so, and `resolved` reached this way settles
     * the case without the refund that PATCH /resolve performs.
     */
    it('refuses a party the admin-only steps', async () => {
      const id = await makeDispute()

      const res = await json(session(ownerId, 'owner'), `/${id}/status`, 'PATCH', {
        status: 'under_review',
      })

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.message).toContain('admin')
      const [row] = await handle.db.select().from(disputes).where(eq(disputes.id, id))
      expect(row?.status).toBe('open')
    })

    it('refuses a user who is not a party to the dispute at all', async () => {
      const id = await makeDispute()

      const res = await json(session(strangerId), `/${id}/status`, 'PATCH', {
        status: 'under_review',
      })

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.message).toContain('Not a party')
    })

    it('refuses a transition the table does not allow', async () => {
      const id = await makeDispute()

      const res = await json(session(adminId, 'admin'), `/${id}/status`, 'PATCH', {
        status: 'escalated',
      })

      expect(res.status).toBe(400)
      expect(((await res.json()) as ErrorBody).error.code).toBe('DISPUTE_INVALID_STATUS')
    })

    it('refuses to move a dispute that is already resolved', async () => {
      const id = await makeDispute({ status: 'resolved' })

      const res = await json(session(adminId, 'admin'), `/${id}/status`, 'PATCH', {
        status: 'under_review',
      })

      expect(res.status).toBe(409)
      expect(((await res.json()) as ErrorBody).error.code).toBe('DISPUTE_ALREADY_RESOLVED')
    })

    it('reports an unknown dispute as not found', async () => {
      const res = await json(session(adminId, 'admin'), `/${uuidv7()}/status`, 'PATCH', {
        status: 'under_review',
      })

      expect(res.status).toBe(404)
    })

    it('rejects a status outside the enum', async () => {
      const id = await makeDispute()

      const res = await json(session(adminId, 'admin'), `/${id}/status`, 'PATCH', {
        status: 'made_up',
      })

      expect(res.status).toBe(400)
      expect(((await res.json()) as ErrorBody).error.code).toBe('VALIDATION_ERROR')
    })
  })

  describe('PATCH /:id/resolve', () => {
    const resolution = {
      resolution: 'Split the remaining escrow evenly between the parties',
      resolutionType: 'funds_to_owner' as const,
    }

    async function fundEscrow(...amounts: number[]) {
      for (const amount of amounts) {
        await handle.db.insert(transactions).values({
          id: uuidv7(),
          projectId,
          type: 'escrow_in',
          amount,
          status: 'completed',
          idempotencyKey: `escrow-${uuidv7()}`,
        })
      }
      escrowBalance = amounts.reduce((a, b) => a + b, 0)
    }

    it('refuses a party who is not an admin', async () => {
      const id = await makeDispute()

      const res = await json(session(ownerId, 'owner'), `/${id}/resolve`, 'PATCH', resolution)

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.message).toContain('admin')
      expect(payments).toHaveLength(0)
    })

    it('resolves in the talent favour without calling the payment service', async () => {
      const id = await makeDispute()
      await fundEscrow(5_000_000)

      const res = await json(session(adminId, 'admin'), `/${id}/resolve`, 'PATCH', {
        ...resolution,
        resolutionType: 'funds_to_talent',
      })

      expect(res.status).toBe(200)
      expect(payments).toHaveLength(0)
      const [row] = await handle.db.select().from(disputes).where(eq(disputes.id, id))
      expect(row?.status).toBe('resolved')
      expect(row?.resolvedBy).toBe(adminId)
    })

    /**
     * The refund is sized from the ledger balance and spread across every
     * settled deposit, because the payment service caps each refund at its own
     * transaction's amount. A single-deposit refund stranded the rest.
     */
    it('spreads a full refund across every escrow deposit, capped at each amount', async () => {
      const id = await makeDispute()
      await fundEscrow(4_000_000, 3_000_000)

      const res = await json(session(adminId, 'admin'), `/${id}/resolve`, 'PATCH', resolution)

      expect(res.status).toBe(200)
      const refunds = payments.filter((p) => p.url.includes('/payments/refund'))
      expect(refunds).toHaveLength(2)
      expect(refunds.map((r) => r.body?.amount)).toEqual([4_000_000, 3_000_000])
      // Dispute-and-deposit scoped, so a retried resolution replays.
      expect(refunds[0]?.body?.idempotencyKey).toContain(`refund:dispute:${id}:`)
      expect(refunds[0]?.body?.ownerId).toBe(ownerId)
    })

    it('refunds only half the balance on a split outcome', async () => {
      const id = await makeDispute()
      await fundEscrow(4_000_000)

      await json(session(adminId, 'admin'), `/${id}/resolve`, 'PATCH', {
        ...resolution,
        resolutionType: 'split',
      })

      const refunds = payments.filter((p) => p.url.includes('/payments/refund'))
      expect(refunds).toHaveLength(1)
      expect(refunds[0]?.body?.amount).toBe(2_000_000)
    })

    it('makes no refund call when the escrow ledger is already empty', async () => {
      const id = await makeDispute()

      const res = await json(session(adminId, 'admin'), `/${id}/resolve`, 'PATCH', resolution)

      expect(res.status).toBe(200)
      expect(payments.filter((p) => p.url.includes('/payments/refund'))).toHaveLength(0)
    })

    /**
     * Escrow is deposited per project, never per package, so a package-scoped
     * refund cannot be sized. Resolving anyway marked the case terminal while
     * the money stayed frozen, and showed the admin a success.
     */
    it('refuses to resolve a package-scoped dispute in the owner favour', async () => {
      const id = await makeDispute({ workPackageId: packageId })
      await fundEscrow(4_000_000)

      const res = await json(session(adminId, 'admin'), `/${id}/resolve`, 'PATCH', resolution)

      expect(res.status).toBe(501)
      expect(((await res.json()) as ErrorBody).error.code).toBe('DISPUTE_SCOPE_UNSUPPORTED')
      const [row] = await handle.db.select().from(disputes).where(eq(disputes.id, id))
      expect(row?.status).toBe('open')
      expect(payments.filter((p) => p.url.includes('/payments/refund'))).toHaveLength(0)
    })

    /**
     * Money moves before the row is marked resolved. The other order leaves a
     * dispute recorded as settled whose refund silently never happened.
     */
    // refundEscrow opts into retryTransient, so a 500 is retried three times
    // with exponential backoff and jitter before it surfaces. That is real
    // elapsed time and it overruns the 5s default.
    it('leaves the dispute unresolved when the refund call fails', {
      timeout: 30_000,
    }, async () => {
      const id = await makeDispute()
      await fundEscrow(4_000_000)
      vi.stubGlobal('fetch', async (url: string | URL | Request) =>
        String(url).includes('/escrow-balance/')
          ? new Response(JSON.stringify({ success: true, data: { balance: 4_000_000 } }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            })
          : new Response(JSON.stringify({ error: { message: 'gateway down' } }), { status: 500 }),
      )

      const res = await json(session(adminId, 'admin'), `/${id}/resolve`, 'PATCH', resolution)

      expect(res.status).toBeGreaterThanOrEqual(500)
      const [row] = await handle.db.select().from(disputes).where(eq(disputes.id, id))
      expect(row?.status).toBe('open')
      expect(row?.resolvedAt).toBeNull()
    })

    it('refuses to resolve the same dispute twice', async () => {
      const id = await makeDispute({ status: 'resolved' })

      const res = await json(session(adminId, 'admin'), `/${id}/resolve`, 'PATCH', resolution)

      expect(res.status).toBe(409)
      expect(((await res.json()) as ErrorBody).error.code).toBe('DISPUTE_ALREADY_RESOLVED')
    })

    it('rejects a resolution the schema does not accept', async () => {
      const id = await makeDispute()

      const res = await json(session(adminId, 'admin'), `/${id}/resolve`, 'PATCH', {
        resolution: 'no',
        resolutionType: 'funds_to_owner',
      })

      expect(res.status).toBe(400)
      expect(((await res.json()) as ErrorBody).error.code).toBe('VALIDATION_ERROR')
    })
  })
})
