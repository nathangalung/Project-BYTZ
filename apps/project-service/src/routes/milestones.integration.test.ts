// biome-ignore-all lint/style/noRestrictedImports: the rule keeps route HANDLERS
// off Drizzle. This is a test, and the tables are what the fixtures are made of.

import {
  getDb,
  milestoneComments,
  milestoneFiles,
  milestones as milestonesTable,
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
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { errorHandler } from '../middleware/error-handler'
import type { SessionUser } from '../middleware/session'
import { milestonesRoute } from './milestones'

/**
 * Who may move a milestone, and what it costs when they do.
 *
 * Two separate rules run on PATCH /status. The first is access: owner or the
 * talent holding this milestone, with integration milestones - which carry no
 * assignee - falling back to any talent on the project. The second is role: a
 * talent may submit but not approve, an owner may approve but not submit. The
 * second is the one that decides whether a talent can approve their own work
 * and pay themselves.
 *
 * Approval settles escrow before it records the approval, so the fee split
 * sent to the payment service is asserted here too - it is computed from the
 * work package ratio, and it is the number that decides what the talent is
 * actually paid.
 */

vi.mock('../lib/temporal-client', () => ({
  getTemporalClient: async () => null,
  TEMPORAL_TASK_QUEUE: 'test',
  milestoneAutoReleaseWorkflowId: (id: string) => `auto-release-${id}`,
  disputeResolutionWorkflowId: (id: string) => `dispute-${id}`,
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
  app.route('/', milestonesRoute)
  return app
}

type ErrorBody = { success: false; error: { code: string; message: string } }
type ReleaseCall = { url: string; body: Record<string, unknown> }

function json(caller: SessionUser, path: string, method: string, body: unknown) {
  return appAs(caller).request(path, {
    method,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

runIf('milestone routes against Postgres', () => {
  let handle: TestHandle
  let releases: ReleaseCall[]
  let paymentStatus: number

  let ownerId: string
  let talentUserId: string
  let talentId: string
  let otherTalentUserId: string
  let otherTalentId: string
  let strangerId: string

  let projectId: string
  let packageId: string
  let milestoneId: string

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
    releases = []
    paymentStatus = 200

    vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url)
      if (href.includes('/payments/release')) {
        releases.push({
          url: href,
          body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
        })
      }
      if (paymentStatus !== 200) {
        return new Response(JSON.stringify({ error: { message: 'escrow unavailable' } }), {
          status: paymentStatus,
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

    projectId = uuidv7()
    await handle.db.insert(projects).values({
      id: projectId,
      ownerId,
      title: 'Milestone project',
      description: 'Exercises milestone authorisation',
      category: 'web_app',
      budgetMin: 1_000_000,
      budgetMax: 20_000_000,
      estimatedTimelineDays: 60,
      status: 'in_progress',
      teamSize: 2,
      finalPrice: 10_000_000,
      talentPayout: 7_150_000,
      platformFee: 2_850_000,
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
      amount: 10_000_000,
      talentPayout: 7_150_000,
      status: 'in_progress',
    })

    await handle.db.insert(projectAssignments).values({
      id: uuidv7(),
      projectId,
      talentId,
      workPackageId: packageId,
      acceptanceStatus: 'accepted',
      status: 'active',
    })

    milestoneId = await makeMilestone({ status: 'submitted', submittedAt: new Date() })
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
    await handle.db.insert(talentProfiles).values({ id, userId, verificationStatus: 'verified' })
    return id
  }

  async function makeMilestone(
    overrides: Partial<typeof milestonesTable.$inferInsert> = {},
  ): Promise<string> {
    const id = uuidv7()
    await handle.db.insert(milestonesTable).values({
      id,
      projectId,
      workPackageId: packageId,
      assignedTalentId: talentId,
      title: 'Milestone one',
      description: 'Deliver the API',
      orderIndex: 0,
      amount: 4_000_000,
      dueDate: new Date(Date.now() + 7 * 86_400_000),
      ...overrides,
    })
    return id
  }

  describe('GET /projects/:projectId/milestones', () => {
    it('returns the payment schedule to the owner', async () => {
      const res = await appAs(session(ownerId, 'owner')).request(
        `/projects/${projectId}/milestones`,
      )

      expect(res.status).toBe(200)
      expect(((await res.json()) as { data: unknown[] }).data).toHaveLength(1)
    })

    it('returns it to an assigned talent', async () => {
      const res = await appAs(session(talentUserId)).request(`/projects/${projectId}/milestones`)

      expect(res.status).toBe(200)
    })

    /** Milestones carry the amounts, so this is the whole payment schedule. */
    it('refuses a signed-in stranger', async () => {
      const res = await appAs(session(strangerId)).request(`/projects/${projectId}/milestones`)

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.code).toBe('AUTH_FORBIDDEN')
    })
  })

  describe('POST /projects/:projectId/milestones', () => {
    const body = {
      title: 'Milestone two',
      description: 'Deliver the front end',
      orderIndex: 1,
      amount: 3_000_000,
      dueDate: new Date(Date.now() + 14 * 86_400_000).toISOString(),
    }

    it('creates a milestone for the owner and records it in the outbox', async () => {
      const res = await json(
        session(ownerId, 'owner'),
        `/projects/${projectId}/milestones`,
        'POST',
        body,
      )

      expect(res.status).toBe(201)
      expect(await handle.db.select().from(milestonesTable)).toHaveLength(2)
      const events = await handle.db.select({ type: outboxEvents.eventType }).from(outboxEvents)
      expect(events).toContainEqual({ type: 'milestone.created' })
    })

    /** The schedule is the owner's; a talent cannot add work to their own plan. */
    it('refuses the assigned talent', async () => {
      const res = await json(
        session(talentUserId),
        `/projects/${projectId}/milestones`,
        'POST',
        body,
      )

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.message).toContain('owner')
      expect(await handle.db.select().from(milestonesTable)).toHaveLength(1)
    })

    it('rejects a body the schema does not accept', async () => {
      const res = await json(
        session(ownerId, 'owner'),
        `/projects/${projectId}/milestones`,
        'POST',
        {
          ...body,
          title: 'no',
        },
      )

      expect(res.status).toBe(400)
      expect(((await res.json()) as ErrorBody).error.code).toBe('VALIDATION_ERROR')
    })

    it('reports an unknown project as not found', async () => {
      const res = await json(
        session(ownerId, 'owner'),
        `/projects/${uuidv7()}/milestones`,
        'POST',
        body,
      )

      expect(res.status).toBe(404)
    })
  })

  describe('PATCH /milestones/:id/status', () => {
    it('lets the assigned talent submit', async () => {
      const id = await makeMilestone({ status: 'in_progress', orderIndex: 1 })

      const res = await json(session(talentUserId), `/milestones/${id}/status`, 'PATCH', {
        status: 'submitted',
      })

      expect(res.status).toBe(200)
      const [row] = await handle.db
        .select({ status: milestonesTable.status })
        .from(milestonesTable)
        .where(eq(milestonesTable.id, id))
      expect(row?.status).toBe('submitted')
    })

    /**
     * The rule that stops a talent approving their own work. Approval is what
     * releases escrow, so without it a talent pays themselves.
     */
    it('refuses to let the assigned talent approve their own milestone', async () => {
      const res = await json(session(talentUserId), `/milestones/${milestoneId}/status`, 'PATCH', {
        status: 'approved',
      })

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.message).toContain('owner')
      expect(releases).toHaveLength(0)
      const [row] = await handle.db
        .select({ status: milestonesTable.status })
        .from(milestonesTable)
        .where(eq(milestonesTable.id, milestoneId))
      expect(row?.status).toBe('submitted')
    })

    it('refuses to let the owner submit on the talent behalf', async () => {
      const id = await makeMilestone({ status: 'in_progress', orderIndex: 1 })

      const res = await json(session(ownerId, 'owner'), `/milestones/${id}/status`, 'PATCH', {
        status: 'submitted',
      })

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.message).toContain('assigned talent')
    })

    it('refuses a talent assigned to a different milestone on the same project', async () => {
      await handle.db.insert(projectAssignments).values({
        id: uuidv7(),
        projectId,
        talentId: otherTalentId,
        workPackageId: packageId,
        acceptanceStatus: 'accepted',
        status: 'terminated',
      })

      const res = await json(
        session(otherTalentUserId),
        `/milestones/${milestoneId}/status`,
        'PATCH',
        {
          status: 'submitted',
        },
      )

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.code).toBe('AUTH_FORBIDDEN')
    })

    it('refuses a signed-in stranger', async () => {
      const res = await json(session(strangerId), `/milestones/${milestoneId}/status`, 'PATCH', {
        status: 'approved',
      })

      expect(res.status).toBe(403)
    })

    it('reports an unknown milestone as not found', async () => {
      const res = await json(session(ownerId, 'owner'), `/milestones/${uuidv7()}/status`, 'PATCH', {
        status: 'approved',
      })

      expect(res.status).toBe(404)
    })

    it('rejects a status outside the enum', async () => {
      const res = await json(
        session(ownerId, 'owner'),
        `/milestones/${milestoneId}/status`,
        'PATCH',
        {
          status: 'invented',
        },
      )

      expect(res.status).toBe(400)
      expect(((await res.json()) as ErrorBody).error.code).toBe('VALIDATION_ERROR')
    })

    /**
     * An integration milestone carries no assignee, so the single-assignee
     * check recognises nobody and every contributing talent would be refused.
     * A project-level talent check stands in.
     */
    it('lets any talent on the project submit an integration milestone', async () => {
      const id = await makeMilestone({
        status: 'in_progress',
        orderIndex: 1,
        milestoneType: 'integration',
        assignedTalentId: null,
      })

      const res = await json(session(talentUserId), `/milestones/${id}/status`, 'PATCH', {
        status: 'submitted',
      })

      expect(res.status).toBe(200)
    })

    it('still refuses a stranger on an integration milestone', async () => {
      const id = await makeMilestone({
        status: 'in_progress',
        orderIndex: 1,
        milestoneType: 'integration',
        assignedTalentId: null,
      })

      const res = await json(session(strangerId), `/milestones/${id}/status`, 'PATCH', {
        status: 'submitted',
      })

      expect(res.status).toBe(403)
    })

    describe('approval settles escrow', () => {
      it('pays the talent before recording the approval', async () => {
        const res = await json(
          session(ownerId, 'owner'),
          `/milestones/${milestoneId}/status`,
          'PATCH',
          {
            status: 'approved',
          },
        )

        expect(res.status).toBe(200)
        expect(releases).toHaveLength(1)
        const [row] = await handle.db
          .select({ status: milestonesTable.status })
          .from(milestonesTable)
          .where(eq(milestonesTable.id, milestoneId))
        expect(row?.status).toBe('approved')
      })

      /**
       * The fee is the platform slice of the gross, taken at the work package
       * ratio: payout 7,150,000 of 10,000,000 leaves 28.5%, so 4,000,000 gross
       * splits into 1,140,000 fee. Getting this wrong mispays the talent.
       */
      it('splits the milestone at the work package payout ratio', async () => {
        await json(session(ownerId, 'owner'), `/milestones/${milestoneId}/status`, 'PATCH', {
          status: 'approved',
        })

        expect(releases[0]?.body).toMatchObject({
          milestoneId,
          amount: 4_000_000,
          feeAmount: 1_140_000,
          // Milestone-keyed so the owner-approve path and the auto-release
          // cannot pay twice.
          idempotencyKey: `release:${milestoneId}`,
        })
      })

      /**
       * Approval is terminal and is what tells the talent they were paid, so a
       * failed payout must not leave it behind.
       */
      // releaseMilestoneEscrow opts into retryTransient, so a 500 is retried
      // three times with exponential backoff before it surfaces. That is real
      // elapsed time, and a test that times out mid-retry leaves the remaining
      // attempts to land during the next one.
      it('refuses the approval when the payment service rejects the release', {
        timeout: 30_000,
      }, async () => {
        paymentStatus = 500

        const res = await json(
          session(ownerId, 'owner'),
          `/milestones/${milestoneId}/status`,
          'PATCH',
          {
            status: 'approved',
          },
        )

        expect(res.status).toBeGreaterThanOrEqual(500)
        const [row] = await handle.db
          .select({ status: milestonesTable.status })
          .from(milestonesTable)
          .where(eq(milestonesTable.id, milestoneId))
        expect(row?.status).toBe('submitted')
      })

      /**
       * Escrow is held per work package, so a milestone priced above its
       * package can only be paid out of a teammate's escrow.
       */
      it('refuses to release a milestone priced above its work package', async () => {
        const id = await makeMilestone({
          status: 'submitted',
          orderIndex: 1,
          amount: 50_000_000,
          submittedAt: new Date(),
        })

        const res = await json(session(ownerId, 'owner'), `/milestones/${id}/status`, 'PATCH', {
          status: 'approved',
        })

        expect(res.status).toBe(400)
        expect(((await res.json()) as ErrorBody).error.message).toContain(
          'exceeds its work package',
        )
        expect(releases).toHaveLength(0)
      })

      /** Last approval moves the project to review, so the rating step is reachable. */
      it('moves the project to review once every milestone is approved', async () => {
        await json(session(ownerId, 'owner'), `/milestones/${milestoneId}/status`, 'PATCH', {
          status: 'approved',
        })

        const [row] = await handle.db
          .select({ status: projects.status })
          .from(projects)
          .where(eq(projects.id, projectId))
        expect(row?.status).toBe('review')
      })

      it('leaves the project in progress while a milestone is still open', async () => {
        await makeMilestone({ status: 'in_progress', orderIndex: 1 })

        await json(session(ownerId, 'owner'), `/milestones/${milestoneId}/status`, 'PATCH', {
          status: 'approved',
        })

        const [row] = await handle.db
          .select({ status: projects.status })
          .from(projects)
          .where(eq(projects.id, projectId))
        expect(row?.status).toBe('in_progress')
      })
    })

    /** The owner's reason used to be parsed and then discarded. */
    it('keeps the rejection reason on the milestone thread', async () => {
      await json(session(ownerId, 'owner'), `/milestones/${milestoneId}/status`, 'PATCH', {
        status: 'rejected',
        reason: 'The endpoint does not match the PRD contract',
      })

      const comments = await handle.db.select().from(milestoneComments)
      expect(comments).toHaveLength(1)
      expect(comments[0]?.content).toBe('The endpoint does not match the PRD contract')
      expect(comments[0]?.userId).toBe(ownerId)
    })

    it('keeps the revision reason too', async () => {
      await json(session(ownerId, 'owner'), `/milestones/${milestoneId}/status`, 'PATCH', {
        status: 'revision_requested',
        reason: 'Please add the pagination the PRD specifies',
      })

      expect(await handle.db.select().from(milestoneComments)).toHaveLength(1)
    })

    it('stores no comment for an approval that carries a reason', async () => {
      await json(session(ownerId, 'owner'), `/milestones/${milestoneId}/status`, 'PATCH', {
        status: 'approved',
        reason: 'Looks good',
      })

      expect(await handle.db.select().from(milestoneComments)).toHaveLength(0)
    })

    it('stores no comment for a blank reason', async () => {
      await json(session(ownerId, 'owner'), `/milestones/${milestoneId}/status`, 'PATCH', {
        status: 'rejected',
        reason: '   ',
      })

      expect(await handle.db.select().from(milestoneComments)).toHaveLength(0)
    })
  })

  describe('GET /milestones/:id/files', () => {
    beforeEach(async () => {
      await handle.db.insert(milestoneFiles).values({
        id: uuidv7(),
        milestoneId,
        fileName: 'api-spec.pdf',
        fileUrl: 'milestones/api-spec.pdf',
        fileSize: 1024,
        mimeType: 'application/pdf',
        uploadedBy: talentUserId,
      })
    })

    /** The bucket is private, so a bare URL 403s; reads come back signed. */
    it('hands a party a signed read rather than the stored key', async () => {
      const res = await appAs(session(ownerId, 'owner')).request(`/milestones/${milestoneId}/files`)

      expect(res.status).toBe(200)
      const body = (await res.json()) as { data: { fileUrl: string }[] }
      expect(body.data[0]?.fileUrl).toContain('X-Amz-Signature')
    })

    it('refuses a signed-in stranger', async () => {
      const res = await appAs(session(strangerId)).request(`/milestones/${milestoneId}/files`)

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.code).toBe('AUTH_FORBIDDEN')
    })

    it('reports an unknown milestone as not found', async () => {
      const res = await appAs(session(ownerId, 'owner')).request(`/milestones/${uuidv7()}/files`)

      expect(res.status).toBe(404)
    })
  })

  describe('GET /milestones/:id/comments', () => {
    it('returns the feedback thread to a party', async () => {
      await handle.db.insert(milestoneComments).values({
        id: uuidv7(),
        milestoneId,
        userId: ownerId,
        content: 'Needs the pagination',
      })

      const res = await appAs(session(talentUserId)).request(`/milestones/${milestoneId}/comments`)

      expect(res.status).toBe(200)
      expect(((await res.json()) as { data: unknown[] }).data).toHaveLength(1)
    })

    it('refuses a signed-in stranger', async () => {
      const res = await appAs(session(strangerId)).request(`/milestones/${milestoneId}/comments`)

      expect(res.status).toBe(403)
    })

    it('reports an unknown milestone as not found', async () => {
      const res = await appAs(session(ownerId, 'owner')).request(`/milestones/${uuidv7()}/comments`)

      expect(res.status).toBe(404)
    })
  })

  describe('POST /milestones/:id/files', () => {
    const body = {
      fileName: 'deliverable.zip',
      fileUrl: 'milestones/deliverable.zip',
      fileSize: 2048,
      mimeType: 'application/zip',
    }

    it('records an attachment for the assigned talent', async () => {
      const res = await json(
        session(talentUserId),
        `/milestones/${milestoneId}/files`,
        'POST',
        body,
      )

      expect(res.status).toBe(201)
      const rows = await handle.db.select().from(milestoneFiles)
      expect(rows).toHaveLength(1)
      expect(rows[0]?.uploadedBy).toBe(talentUserId)
    })

    it('refuses a signed-in stranger', async () => {
      const res = await json(session(strangerId), `/milestones/${milestoneId}/files`, 'POST', body)

      expect(res.status).toBe(403)
      expect(await handle.db.select().from(milestoneFiles)).toHaveLength(0)
    })

    it('rejects a body the schema does not accept', async () => {
      const res = await json(session(talentUserId), `/milestones/${milestoneId}/files`, 'POST', {
        ...body,
        fileSize: -1,
      })

      expect(res.status).toBe(400)
      expect(((await res.json()) as ErrorBody).error.code).toBe('VALIDATION_ERROR')
    })

    it('reports an unknown milestone as not found', async () => {
      const res = await json(session(talentUserId), `/milestones/${uuidv7()}/files`, 'POST', body)

      expect(res.status).toBe(404)
    })
  })
})
