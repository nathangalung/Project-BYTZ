// biome-ignore-all lint/style/noRestrictedImports: the rule keeps route HANDLERS
// off Drizzle. This is a test, and the tables are what the fixtures are made of.

import {
  adminAuditLogs,
  brdDocuments,
  chatConversations,
  chatParticipants,
  contracts,
  disputes,
  getDb,
  milestones,
  outboxEvents,
  prdDocuments,
  projectAssignments,
  projectStatusLogs,
  projects as projectsTable,
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
import { projectsRoute } from './projects'

/**
 * POST /projects/:id/transition — the only door between project states.
 *
 * Three things happen here that happen nowhere else, and each is the kind that
 * is only noticed when it is wrong.
 *
 * Money moves BEFORE the status flip. A cancellation refunds the escrow that is
 * still held and only then writes `cancelled`, so a refund that fails leaves a
 * project the owner can cancel again rather than a cancelled project whose
 * escrow is trapped with no route out.
 *
 * Approving a BRD or PRD enqueues its embedding through the outbox, in the same
 * commit, because that vector is what later projects are scoped against; a
 * dropped event is a document that is silently never retrievable.
 *
 * And team projects must pass through team_forming: `matching -> matched`
 * direct would mint a matched project with unstaffed packages.
 *
 * The payment service and Temporal are stubbed - they are the true externals.
 * The database, the state machine and the outbox are real.
 */

const h = vi.hoisted(() => ({
  getEscrowBalance: vi.fn(async (_projectId: string) => 0),
  refundEscrow: vi.fn(async (_input: unknown) => {}),
  startTeamFormationWorkflow: vi.fn(async (_projectId: string) => {}),
  signalTeamComplete: vi.fn(async (_projectId: string) => {}),
}))

vi.mock('../lib/payment-client', () => ({
  getEscrowBalance: h.getEscrowBalance,
  refundEscrow: h.refundEscrow,
  releaseMilestoneEscrow: vi.fn(async () => {}),
}))

vi.mock('../lib/team-formation-workflow', () => ({
  startTeamFormationWorkflow: h.startTeamFormationWorkflow,
  signalTeamComplete: h.signalTeamComplete,
}))

const runIf = hasTestDatabase() ? describe : describe.skip
const INTEGRATION_LOCK = sql`SELECT pg_advisory_lock(20260813)`

function session(id: string, role = 'owner'): SessionUser {
  return { id, email: `${id}@example.test`, name: 'Caller', role }
}

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

function transition(caller: SessionUser | null, projectId: string, body: unknown) {
  return app(caller).request(`/${projectId}/transition`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Accepting a generated document.
 *
 * The approval used to ride the transition endpoint as brd_approved /
 * prd_approved. brd_review spans generated and approved, so the position can
 * no longer carry it and the document's own status does.
 */
function approveDocument(caller: SessionUser | null, projectId: string, kind: 'brd' | 'prd') {
  return app(caller).request(`/${projectId}/${kind}/approve`, { method: 'POST' })
}

/**
 * The fire-and-forget handlers settle after the response is written, so an
 * assertion on their side effect has to let the microtask queue drain first.
 */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

type ErrorBody = { success: false; error: { code: string; message: string } }

runIf('project status transitions against Postgres', () => {
  let handle: TestHandle
  let ownerId: string
  let strangerId: string
  let projectId: string
  let warned: ReturnType<typeof vi.spyOn>

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

  /**
   * Staff every seat so a project legitimately reaches matched. The matched
   * gate reads the work packages, so tests that only wanted to exercise the
   * Temporal signals still have to fill the positions first.
   */
  async function staffPackages(count: number): Promise<void> {
    for (let i = 0; i < count; i++) {
      const talentUserId = await makeUser(`seat-${i}`)
      const talentId = uuidv7()
      await handle.db
        .insert(talentProfiles)
        .values({ id: talentId, userId: talentUserId, verificationStatus: 'verified' })
      const wpId = uuidv7()
      await handle.db.insert(workPackages).values({
        id: wpId,
        projectId,
        title: `Package ${i}`,
        description: 'Package',
        orderIndex: i,
        requiredSkills: ['backend'],
        estimatedHours: 40,
        amount: 5_000_000,
        talentPayout: 3_575_000,
        status: 'assigned',
      })
      await handle.db.insert(projectAssignments).values({
        id: uuidv7(),
        projectId,
        talentId,
        workPackageId: wpId,
        roleLabel: `Developer ${i}`,
        status: 'active',
      })
    }
  }

  /**
   * Sign every agreement on the project, for tests about a different gate.
   *
   * Starting work needs both a full team and both signatures, and the two
   * gates used to sit on two different edges - the seat check on the way to
   * `matched`, the signature check on the way out of it. One position fewer
   * means one edge, so a test about seats has to get past signatures too.
   */
  async function signEverything(): Promise<void> {
    const rows = await handle.db
      .select({ id: projectAssignments.id })
      .from(projectAssignments)
      .where(eq(projectAssignments.projectId, projectId))
    for (const { id } of rows) {
      for (const type of ['standard_nda', 'ip_transfer'] as const) {
        await handle.db.insert(contracts).values({
          id: uuidv7(),
          projectId,
          assignmentId: id,
          type,
          content: { clauses: [] },
          signedByOwner: true,
          signedByTalent: true,
        })
      }
    }
  }

  /** Move the fixture project to a starting status without going through the route. */
  async function setStatus(
    status: (typeof projectsTable.$inferInsert)['status'],
    teamSize = 1,
  ): Promise<void> {
    await handle.db
      .update(projectsTable)
      .set({ status, teamSize })
      .where(eq(projectsTable.id, projectId))
  }

  async function statusOf(id = projectId): Promise<string | undefined> {
    const [row] = await handle.db
      .select({ status: projectsTable.status })
      .from(projectsTable)
      .where(eq(projectsTable.id, id))
    return row?.status
  }

  async function outboxTypes(): Promise<string[]> {
    const rows = await handle.db
      .select({ type: outboxEvents.eventType })
      .from(outboxEvents)
      .orderBy(outboxEvents.createdAt, outboxEvents.id)
    return rows.map((r) => r.type)
  }

  beforeEach(async () => {
    await handle.truncate()
    h.getEscrowBalance.mockReset().mockResolvedValue(0)
    h.refundEscrow.mockReset().mockResolvedValue(undefined)
    h.startTeamFormationWorkflow.mockReset().mockResolvedValue(undefined)
    h.signalTeamComplete.mockReset().mockResolvedValue(undefined)
    warned = vi.spyOn(console, 'warn').mockImplementation(() => {})

    ownerId = await makeUser('owner')
    strangerId = await makeUser('stranger')

    projectId = uuidv7()
    await handle.db.insert(projectsTable).values({
      id: projectId,
      ownerId,
      title: 'Transitioning project',
      description: 'Exercises the status machine',
      category: 'web_app',
      budgetMin: 1_000_000,
      budgetMax: 20_000_000,
      estimatedTimelineDays: 45,
      status: 'draft',
      teamSize: 1,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('who may ask, and for what', () => {
    it('rejects a status that is not a project status', async () => {
      const res = await transition(session(ownerId), projectId, { status: 'ascended' })

      expect(res.status).toBe(400)
      expect(((await res.json()) as ErrorBody).error.code).toBe('VALIDATION_ERROR')
      expect(await statusOf()).toBe('draft')
    })

    it('rejects a reason longer than the column allows', async () => {
      const res = await transition(session(ownerId), projectId, {
        status: 'scoping',
        reason: 'x'.repeat(1001),
      })

      expect(res.status).toBe(400)
      expect(await statusOf()).toBe('draft')
    })

    it('refuses a signed-in stranger', async () => {
      const res = await transition(session(strangerId), projectId, { status: 'scoping' })

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.code).toBe('AUTH_FORBIDDEN')
      expect(await statusOf()).toBe('draft')
    })

    /**
     * Same 403 as a stranger, deliberately: a project id that answers "no such
     * project" to anyone who asks is an enumeration oracle over ids that are
     * otherwise unguessable.
     */
    it('refuses an unknown project without distinguishing it from a forbidden one', async () => {
      const res = await transition(session(ownerId), uuidv7(), { status: 'scoping' })

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.code).toBe('AUTH_FORBIDDEN')
    })

    it('refuses a transition the state machine does not allow', async () => {
      const res = await transition(session(ownerId), projectId, { status: 'completed' })

      expect(res.status).toBe(400)
      expect(((await res.json()) as ErrorBody).error.code).toBe(
        'PROJECT_VALIDATION_INVALID_TRANSITION',
      )
      expect(await statusOf()).toBe('draft')
    })

    it('moves the project and logs where it came from', async () => {
      const res = await transition(session(ownerId), projectId, {
        status: 'scoping',
        reason: 'Owner started scoping',
      })

      expect(res.status).toBe(200)
      expect(await statusOf()).toBe('scoping')
      const logs = await handle.db
        .select({
          from: projectStatusLogs.fromStatus,
          to: projectStatusLogs.toStatus,
          by: projectStatusLogs.changedBy,
          reason: projectStatusLogs.reason,
        })
        .from(projectStatusLogs)
      expect(logs).toEqual([
        { from: 'draft', to: 'scoping', by: ownerId, reason: 'Owner started scoping' },
      ])
    })
  })

  /**
   * The platform promises admin intervention on a stuck project, and this route
   * was the only way to move a status while admitting the owner alone. An
   * operator had no way to unstick anything.
   */
  describe("an admin intervening on someone else's project", () => {
    it('may move a project the owner is not moving', async () => {
      const adminId = await makeUser('admin')
      const res = await transition(session(adminId, 'admin'), projectId, {
        status: 'scoping',
        reason: 'Support unstuck it',
      })

      expect(res.status).toBe(200)
      expect(await statusOf()).toBe('scoping')
    })

    it('records the intervention against the admin who made it', async () => {
      const adminId = await makeUser('admin')
      await transition(session(adminId, 'admin'), projectId, {
        status: 'scoping',
        reason: 'Support unstuck it',
      })

      const rows = await handle.db
        .select({
          adminId: adminAuditLogs.adminId,
          action: adminAuditLogs.action,
          targetId: adminAuditLogs.targetId,
        })
        .from(adminAuditLogs)
      expect(rows).toEqual([{ adminId, action: 'project.status_changed', targetId: projectId }])
    })

    /**
     * Cancellation refunds escrow through payment-service before the status
     * flips, so it spends the owner's money. That decision is not an operator's
     * to make, and the refusal is what keeps the audited power non-financial.
     */
    it('may not cancel, because cancelling refunds the owner escrow', async () => {
      const adminId = await makeUser('admin')
      await transition(session(ownerId), projectId, { status: 'scoping' })

      const res = await transition(session(adminId, 'admin'), projectId, { status: 'cancelled' })

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.code).toBe('AUTH_FORBIDDEN')
      expect(await statusOf()).toBe('scoping')
      expect(h.refundEscrow).not.toHaveBeenCalled()
    })

    it('leaves no audit row when the owner moves their own project', async () => {
      await transition(session(ownerId), projectId, { status: 'scoping' })

      expect(await handle.db.select().from(adminAuditLogs)).toEqual([])
    })
  })

  /**
   * Starting work is where the team has to be real.
   *
   * `matched` was the position that meant "every seat accepted", and the owner
   * transition was a second door to it beside the talent-accept path. The
   * position is gone - a complete team is team_completed_at and the packages
   * themselves - so the gate moved onto the edge that matters: work starting.
   * Without it an owner could start a project with seats still open, leaving
   * escrow under something nobody is building.
   */
  describe('starting work needs every seat filled', () => {
    it('refuses to start while a seat is still unfilled', async () => {
      await setStatus('matching', 3)
      await staffPackages(2)
      // A third, still-open package.
      await handle.db.insert(workPackages).values({
        id: uuidv7(),
        projectId,
        title: 'Unfilled package',
        description: 'Package',
        orderIndex: 2,
        requiredSkills: ['backend'],
        estimatedHours: 40,
        amount: 5_000_000,
        talentPayout: 3_575_000,
        status: 'unassigned',
      })

      const res = await transition(session(ownerId), projectId, { status: 'in_progress' })

      expect(res.status).toBe(400)
      expect(((await res.json()) as ErrorBody).error.message).toContain('filled')
      expect(await statusOf()).toBe('matching')
    })

    /** A project with no packages at all cannot start either. */
    it('refuses to start when the project has no packages', async () => {
      await setStatus('matching', 1)

      const res = await transition(session(ownerId), projectId, { status: 'in_progress' })

      expect(res.status).toBe(400)
      expect(await statusOf()).toBe('matching')
    })

    it('starts once every seat is filled and every agreement is signed', async () => {
      await setStatus('matching', 1)
      await staffPackages(1)
      await signEverything()

      const res = await transition(session(ownerId), projectId, { status: 'in_progress' })

      expect(res.status).toBe(200)
      expect(await statusOf()).toBe('in_progress')
    })

    /**
     * matching -> final_review would skip the work itself. The old machine had
     * four positions between matching and review to hide behind; the line has
     * none, so the skip is the whole test.
     */
    it('refuses to skip the work', async () => {
      await setStatus('matching', 1)
      await staffPackages(1)

      const res = await transition(session(ownerId), projectId, { status: 'final_review' })

      expect(res.status).toBe(400)
      expect(await statusOf()).toBe('matching')
    })

    it('signals the workflow when a team starts work', async () => {
      await setStatus('matching', 3)
      await staffPackages(3)
      await signEverything()

      const res = await transition(session(ownerId), projectId, { status: 'in_progress' })

      expect(res.status).toBe(200)
      await flush()
      expect(h.signalTeamComplete).toHaveBeenCalledWith(projectId)
    })

    it('sends no completion signal for a single-talent project', async () => {
      await setStatus('matching', 1)
      await staffPackages(1)
      await signEverything()

      const res = await transition(session(ownerId), projectId, { status: 'in_progress' })

      expect(res.status).toBe(200)
      await flush()
      expect(h.signalTeamComplete).not.toHaveBeenCalled()
    })

    /**
     * Temporal is a safety net, not part of the transaction. A broker that is
     * down must not fail a transition that has already committed.
     */
    it('still transitions when the completion signal fails', async () => {
      await setStatus('matching', 3)
      await staffPackages(3)
      await signEverything()
      h.signalTeamComplete.mockRejectedValue(new Error('temporal unreachable'))

      const res = await transition(session(ownerId), projectId, { status: 'in_progress' })

      expect(res.status).toBe(200)
      expect(await statusOf()).toBe('in_progress')
      await flush()
      expect(warned).toHaveBeenCalledWith(
        '[temporal] team complete signal failed',
        expect.objectContaining({ projectId }),
      )
    })
  })

  /**
   * A dispute freezes the project without moving it.
   *
   * It used to freeze by overwriting the status, and `disputed -> in_progress`
   * was a valid machine edge - so the owner, one of the two parties, could
   * lift the freeze alone while the case was still under review. The guard
   * reads the unresolved row instead, which also makes the freeze cover every
   * onward edge rather than only the one out of `disputed`.
   */
  describe('an open dispute keeps the project frozen', () => {
    async function openDispute(resolved: boolean): Promise<void> {
      const respondentId = await makeUser('respondent')
      await handle.db.insert(disputes).values({
        id: uuidv7(),
        projectId,
        initiatedBy: ownerId,
        againstUserId: respondentId,
        reason: 'Deliverable does not match the PRD',
        status: resolved ? 'resolved' : 'under_review',
        resolvedAt: resolved ? new Date() : null,
      })
    }

    it('refuses the owner moving the project while the dispute is live', async () => {
      await setStatus('in_progress')
      await openDispute(false)

      const res = await transition(session(ownerId), projectId, { status: 'final_review' })

      expect(res.status).toBe(409)
      expect(((await res.json()) as ErrorBody).error.code).toBe('CONFLICT')
      expect(await statusOf()).toBe('in_progress')
    })

    it('lets the owner move on once the dispute is resolved', async () => {
      await setStatus('in_progress')
      await openDispute(true)

      const res = await transition(session(ownerId), projectId, { status: 'final_review' })

      expect(res.status).toBe(200)
      expect(await statusOf()).toBe('final_review')
    })

    it('still lets an admin move a disputed project while mediating', async () => {
      const adminId = await makeUser('admin')
      await setStatus('in_progress')
      await openDispute(false)

      const res = await transition(session(adminId, 'admin'), projectId, {
        status: 'final_review',
        reason: 'Mediated',
      })

      expect(res.status).toBe(200)
      expect(await statusOf()).toBe('final_review')
    })
  })

  describe('cancelling refunds before it flips the status', () => {
    it('cancels without calling the gateway when no escrow is held', async () => {
      await setStatus('matching', 1)

      const res = await transition(session(ownerId), projectId, { status: 'cancelled' })

      expect(res.status).toBe(200)
      expect(await statusOf()).toBe('cancelled')
      expect(h.refundEscrow).not.toHaveBeenCalled()
    })

    it('refunds the remaining balance against the deposit that funded it', async () => {
      await setStatus('in_progress', 1)
      const depositId = uuidv7()
      await handle.db.insert(transactions).values({
        id: depositId,
        projectId,
        type: 'escrow_in',
        amount: 10_000_000,
        status: 'completed',
        idempotencyKey: `escrow:${depositId}`,
      })
      h.getEscrowBalance.mockResolvedValue(6_000_000)

      const res = await transition(session(ownerId), projectId, {
        status: 'cancelled',
        reason: 'Owner pulled out',
      })

      expect(res.status).toBe(200)
      expect(h.refundEscrow).toHaveBeenCalledTimes(1)
      expect(h.refundEscrow).toHaveBeenCalledWith(
        expect.objectContaining({
          originalTransactionId: depositId,
          amount: 6_000_000,
          ownerId,
          performedBy: ownerId,
          idempotencyKey: `refund:cancel:${projectId}:${depositId}`,
        }),
      )
      expect(await statusOf()).toBe('cancelled')
    })

    /**
     * The refund is capped per deposit, so a balance spanning two of them is
     * spread across both - and stops as soon as it is exhausted rather than
     * refunding every deposit its full face value.
     */
    it('spreads the balance over the deposits and stops once it is exhausted', async () => {
      await setStatus('in_progress', 1)
      const first = uuidv7()
      const second = uuidv7()
      for (const [id, amount] of [
        [first, 4_000_000],
        [second, 4_000_000],
      ] as const) {
        await handle.db.insert(transactions).values({
          id,
          projectId,
          type: 'escrow_in',
          amount,
          status: 'completed',
          idempotencyKey: `escrow:${id}`,
        })
      }
      h.getEscrowBalance.mockResolvedValue(4_000_000)

      const res = await transition(session(ownerId), projectId, { status: 'cancelled' })

      expect(res.status).toBe(200)
      expect(h.refundEscrow).toHaveBeenCalledTimes(1)
      expect(h.refundEscrow.mock.calls[0]?.[0]).toMatchObject({ amount: 4_000_000 })
    })

    /**
     * The refund commits in payment-service, in its own transaction, and a throw
     * on this side cannot roll it back. So a cancellation the state machine
     * forbids has to be refused before the money moves, not after.
     *
     * The from-state is 'completed' rather than 'final_review'. Review used to be the
     * example here, and is now the opposite case: completing is gated on an
     * empty ledger, so cancelling out of review is the exit that returns the
     * residue - covered by the test below. Completed is terminal, and a refund
     * against a project that has already paid out is the drain this guard
     * exists to refuse.
     */
    it('refuses a cancellation the state machine forbids without refunding', async () => {
      await setStatus('completed', 1)
      const depositId = uuidv7()
      await handle.db.insert(transactions).values({
        id: depositId,
        projectId,
        type: 'escrow_in',
        amount: 8_000_000,
        status: 'completed',
        idempotencyKey: `escrow:${depositId}`,
      })
      h.getEscrowBalance.mockResolvedValue(8_000_000)

      const res = await transition(session(ownerId), projectId, { status: 'cancelled' })

      expect(res.status).toBe(400)
      expect(((await res.json()) as ErrorBody).error.code).toBe(
        'PROJECT_VALIDATION_INVALID_TRANSITION',
      )
      expect(h.refundEscrow).not.toHaveBeenCalled()
      expect(await statusOf()).toBe('completed')
    })

    /**
     * The escape hatch the completion guard depends on. A project in final
     * review whose escrow cannot be settled through its milestones has to be
     * able to hand the money back, or the guard below turns a soft-lock into a
     * hard one.
     */
    it('cancels a project in final review and refunds what is left', async () => {
      await setStatus('final_review', 1)
      const depositId = uuidv7()
      await handle.db.insert(transactions).values({
        id: depositId,
        projectId,
        type: 'escrow_in',
        amount: 8_000_000,
        status: 'completed',
        idempotencyKey: `escrow:${depositId}`,
      })
      h.getEscrowBalance.mockResolvedValue(8_000_000)

      const res = await transition(session(ownerId), projectId, { status: 'cancelled' })

      expect(res.status).toBe(200)
      expect(h.refundEscrow).toHaveBeenCalledTimes(1)
      expect(h.refundEscrow.mock.calls[0]?.[0]).toMatchObject({ amount: 8_000_000 })
      expect(await statusOf()).toBe('cancelled')
    })

    /**
     * The ordering the route's comment claims, executed. A refund that throws
     * must leave the project cancellable, not cancelled-and-unrefundable.
     */
    it('leaves the project untouched when the refund fails', async () => {
      await setStatus('in_progress', 1)
      const depositId = uuidv7()
      await handle.db.insert(transactions).values({
        id: depositId,
        projectId,
        type: 'escrow_in',
        amount: 10_000_000,
        status: 'completed',
        idempotencyKey: `escrow:${depositId}`,
      })
      h.getEscrowBalance.mockResolvedValue(10_000_000)
      h.refundEscrow.mockRejectedValue(new Error('gateway declined'))

      const res = await transition(session(ownerId), projectId, { status: 'cancelled' })

      expect(res.status).toBeGreaterThanOrEqual(500)
      expect(await statusOf()).toBe('in_progress')
      expect(await outboxTypes()).not.toContain('project.status.changed')
    })
  })

  /**
   * 'completed' is terminal and nothing checked what the project still owed
   * before going there. An owner accepting while a milestone was unapproved,
   * or while the ledger still held escrow, closed the project over money with
   * no path to the talent and none back to themselves.
   */
  describe('completing a project', () => {
    async function makeMilestone(status: 'pending' | 'approved'): Promise<string> {
      const id = uuidv7()
      await handle.db.insert(milestones).values({
        id,
        projectId,
        title: 'Deliverable',
        description: 'The work under test',
        orderIndex: 0,
        amount: 3_000_000,
        status,
        dueDate: new Date(Date.now() + 86_400_000),
      })
      return id
    }

    it('refuses while a milestone is still unapproved', async () => {
      await setStatus('final_review', 1)
      await makeMilestone('approved')
      await makeMilestone('pending')

      const res = await transition(session(ownerId), projectId, { status: 'completed' })

      expect(res.status).toBe(400)
      const body = (await res.json()) as ErrorBody
      expect(body.error.code).toBe('PROJECT_VALIDATION_INVALID_TRANSITION')
      expect(body.error.message).toMatch(/unapproved milestone/)
      expect(await statusOf()).toBe('final_review')
    })

    it('refuses while the escrow ledger still holds money', async () => {
      await setStatus('final_review', 1)
      await makeMilestone('approved')
      h.getEscrowBalance.mockResolvedValue(2_500_000)

      const res = await transition(session(ownerId), projectId, { status: 'completed' })

      expect(res.status).toBe(400)
      expect(((await res.json()) as ErrorBody).error.message).toMatch(/escrow/)
      expect(await statusOf()).toBe('final_review')
    })

    /** Refusing is not settling: the guard reads the balance, it never spends it. */
    it('does not refund the balance it refuses over', async () => {
      await setStatus('final_review', 1)
      h.getEscrowBalance.mockResolvedValue(2_500_000)

      await transition(session(ownerId), projectId, { status: 'completed' })

      expect(h.refundEscrow).not.toHaveBeenCalled()
    })

    it('completes once every milestone is approved and the ledger is empty', async () => {
      await setStatus('final_review', 1)
      await makeMilestone('approved')
      h.getEscrowBalance.mockResolvedValue(0)

      const res = await transition(session(ownerId), projectId, { status: 'completed' })

      expect(res.status).toBe(200)
      expect(await statusOf()).toBe('completed')
    })

    /**
     * disputed -> completed is an admin resolving a dispute, which settles the
     * money on its own terms. Putting it behind a live payment-service call
     * would narrow the escape hatch the guard depends on.
     */
    /**
     * The guard is scoped to the final-review exit, which the collapse makes
     * the only way in to 'completed'. It used to have to dodge
     * `disputed -> completed`, an admin settling a case on its own terms -
     * and a dispute is not a position any more, so there is nothing to dodge.
     */
    it('refuses from anywhere that is not the final review', async () => {
      await setStatus('in_progress', 1)
      await makeMilestone('pending')

      const res = await transition(session(ownerId), projectId, { status: 'completed' })

      expect(res.status).toBe(400)
      expect(((await res.json()) as ErrorBody).error.code).toBe(
        'PROJECT_VALIDATION_INVALID_TRANSITION',
      )
      expect(await statusOf()).toBe('in_progress')
    })
  })

  /**
   * The platform promises an NDA and an IP transfer per talent before work
   * starts, and until this gate existed nothing created them and nothing read
   * the signature columns. A project could start work with an empty contracts
   * table.
   */
  describe('signed agreements gate the start of work', () => {
    async function staffOnePosition(): Promise<string> {
      const talentUserId = await makeUser('gate-talent')
      const talentId = uuidv7()
      await handle.db
        .insert(talentProfiles)
        .values({ id: talentId, userId: talentUserId, verificationStatus: 'verified' })
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
        status: 'assigned',
      })
      const aid = uuidv7()
      await handle.db.insert(projectAssignments).values({
        id: aid,
        projectId,
        talentId,
        workPackageId: wpId,
        roleLabel: 'Backend Developer',
        status: 'active',
      })
      return aid
    }

    /**
     * The owner-driven door, taken when the team was staffed through
     * applications rather than matching confirm. It has to produce the same
     * agreements and the same threads as the accept path, or the gate below
     * would find nothing pending and wave a project through with no NDA on
     * file - and the two sides would have nowhere to talk.
     *
     * They used to be written on arrival at `matched`. There is no such
     * arrival any more, so they are written on the edge that needs them.
     */
    it('writes the agreements and opens the thread when work starts', async () => {
      await setStatus('matching', 1)
      const assignmentId = await staffOnePosition()

      // Refused, because nothing is signed yet - but the agreements this
      // asserts on are created before the gate runs, which is the point.
      const refused = await transition(session(ownerId), projectId, { status: 'in_progress' })
      expect(refused.status).toBe(422)

      const agreements = await handle.db
        .select({ type: contracts.type })
        .from(contracts)
        .where(eq(contracts.assignmentId, assignmentId))
      expect(agreements.map((a) => a.type).sort()).toEqual(['ip_transfer', 'standard_nda'])

      const [thread] = await handle.db
        .select({ id: chatConversations.id })
        .from(chatConversations)
        .where(eq(chatConversations.assignmentId, assignmentId))
      expect(thread).toBeDefined()
      const members = await handle.db
        .select({ userId: chatParticipants.userId })
        .from(chatParticipants)
        .where(eq(chatParticipants.conversationId, thread?.id ?? ''))
      expect(members).toHaveLength(2)
    })

    it('refuses to start work while an agreement is unsigned', async () => {
      await setStatus('matching', 1)
      await staffOnePosition()

      const res = await transition(session(ownerId), projectId, { status: 'in_progress' })

      expect(res.status).toBe(422)
      const body = (await res.json()) as { error: { code: string; message: string } }
      expect(body.error.code).toBe('CONTRACT_NOT_SIGNED')
      expect(body.error.message).toContain('Backend Developer')
      expect(await statusOf()).toBe('matching')
    })

    it('still refuses when only the owner has signed', async () => {
      await setStatus('matching', 1)
      const assignmentId = await staffOnePosition()
      await seedContracts(assignmentId, { owner: true, talent: false })

      const res = await transition(session(ownerId), projectId, { status: 'in_progress' })

      expect(res.status).toBe(422)
      expect(await statusOf()).toBe('matching')
    })

    it('starts work once both parties have signed both agreements', async () => {
      await setStatus('matching', 1)
      const assignmentId = await staffOnePosition()
      await seedContracts(assignmentId, { owner: true, talent: true })

      const res = await transition(session(ownerId), projectId, { status: 'in_progress' })

      expect(res.status).toBe(200)
      expect(await statusOf()).toBe('in_progress')
    })

    async function seedContracts(
      assignmentId: string,
      signed: { owner: boolean; talent: boolean },
    ): Promise<void> {
      for (const type of ['standard_nda', 'ip_transfer'] as const) {
        await handle.db.insert(contracts).values({
          id: uuidv7(),
          projectId,
          assignmentId,
          type,
          content: { clauses: [] },
          signedByOwner: signed.owner,
          signedByTalent: signed.talent,
        })
      }
    }
  })

  /**
   * A hold is a column, and the console is the only thing that writes it.
   *
   * `on_hold` used to be a status reached by a transition, which is why a
   * paused project forgot where it was paused. Leaving the column with no
   * writer would have been worse: the operator could no longer stop a project
   * short of a cancellation that spends the owner's money.
   */
  describe('holding a project', () => {
    let adminId: string

    beforeEach(async () => {
      adminId = await makeUser('hold-admin')
    })

    function hold(caller: SessionUser | null, body: unknown) {
      return app(caller).request(`/${projectId}/hold`, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
      })
    }

    async function onHoldAt(): Promise<Date | null | undefined> {
      const [row] = await handle.db
        .select({ onHoldAt: projectsTable.onHoldAt })
        .from(projectsTable)
        .where(eq(projectsTable.id, projectId))
      return row?.onHoldAt
    }

    it('pauses without moving the project', async () => {
      await setStatus('in_progress', 1)

      const res = await hold(session(adminId, 'admin'), { onHold: true })

      expect(res.status).toBe(200)
      expect(await onHoldAt()).toBeInstanceOf(Date)
      expect(await statusOf()).toBe('in_progress')
    })

    it('resumes by clearing the column, still without moving it', async () => {
      await setStatus('final_review', 1)
      await hold(session(adminId, 'admin'), { onHold: true })

      const res = await hold(session(adminId, 'admin'), { onHold: false })

      expect(res.status).toBe(200)
      expect(await onHoldAt()).toBeNull()
      expect(await statusOf()).toBe('final_review')
    })

    /** Holding twice must not move the clock the hold started. */
    it('keeps the original moment on a second hold', async () => {
      await setStatus('in_progress', 1)
      await hold(session(adminId, 'admin'), { onHold: true })
      const first = await onHoldAt()

      await hold(session(adminId, 'admin'), { onHold: true })

      expect(await onHoldAt()).toEqual(first)
    })

    it('refuses an owner, because a hold is an operator intervention', async () => {
      await setStatus('in_progress', 1)

      const res = await hold(session(ownerId), { onHold: true })

      expect(res.status).toBe(403)
      expect(await onHoldAt()).toBeNull()
    })

    it('refuses to pause a project that has already stopped', async () => {
      await setStatus('completed', 1)

      const res = await hold(session(adminId, 'admin'), { onHold: true })

      expect(res.status).toBe(409)
      expect(await onHoldAt()).toBeNull()
    })
  })

  describe('approval enqueues the document embedding', () => {
    async function insertBrd(version: number): Promise<string> {
      const id = uuidv7()
      await handle.db.insert(brdDocuments).values({
        id,
        projectId,
        content: { summary: 'A business requirement' },
        version,
        status: 'review',
        price: 500_000,
      })
      return id
    }

    it('enqueues the BRD embedding on approval', async () => {
      await setStatus('brd_review', 1)
      const docId = await insertBrd(1)

      const res = await approveDocument(session(ownerId), projectId, 'brd')

      expect(res.status).toBe(200)
      const [row] = await handle.db
        .select({
          type: outboxEvents.eventType,
          aggregateType: outboxEvents.aggregateType,
          aggregateId: outboxEvents.aggregateId,
          payload: outboxEvents.payload,
        })
        .from(outboxEvents)
        .where(eq(outboxEvents.eventType, 'ai.brd.embed_requested'))
      expect(row).toMatchObject({
        aggregateType: 'brd_document',
        aggregateId: docId,
      })
      expect(row?.payload).toMatchObject({
        projectId,
        documentId: docId,
        documentType: 'brd',
        content: { summary: 'A business requirement' },
      })
    })

    it('enqueues the PRD embedding on approval', async () => {
      await setStatus('prd_review', 1)
      const docId = uuidv7()
      await handle.db.insert(prdDocuments).values({
        id: docId,
        projectId,
        content: { techStack: ['hono'] },
        version: 2,
        status: 'review',
        price: 1_500_000,
      })

      const res = await approveDocument(session(ownerId), projectId, 'prd')

      expect(res.status).toBe(200)
      const [row] = await handle.db
        .select({
          aggregateType: outboxEvents.aggregateType,
          aggregateId: outboxEvents.aggregateId,
          payload: outboxEvents.payload,
        })
        .from(outboxEvents)
        .where(eq(outboxEvents.eventType, 'ai.prd.embed_requested'))
      expect(row).toMatchObject({ aggregateType: 'prd_document', aggregateId: docId })
      expect(row?.payload).toMatchObject({ documentType: 'prd' })
    })

    /**
     * There is nothing to approve without a document, and saying so is better
     * than the silent success the old status-only approval gave: the owner
     * would have been told their BRD was accepted when none had been written.
     */
    it('refuses to approve a document that does not exist', async () => {
      await setStatus('brd_review', 1)

      const res = await approveDocument(session(ownerId), projectId, 'brd')

      expect(res.status).toBe(404)
      expect(await statusOf()).toBe('brd_review')
      expect(await outboxTypes()).not.toContain('ai.brd.embed_requested')
    })

    /** Approving is idempotent: a double-click must not 409 the owner. */
    it('accepts a second approval without enqueueing a second embedding', async () => {
      await setStatus('brd_review', 1)
      await insertBrd(1)
      await approveDocument(session(ownerId), projectId, 'brd')

      const res = await approveDocument(session(ownerId), projectId, 'brd')

      expect(res.status).toBe(200)
      const requests = (await outboxTypes()).filter((t) => t === 'ai.brd.embed_requested')
      expect(requests).toHaveLength(1)
    })

    /** A transition is not an approval, so it enqueues nothing. */
    it('enqueues no embedding for an unrelated transition', async () => {
      await setStatus('draft', 1)

      const res = await transition(session(ownerId), projectId, { status: 'scoping' })

      expect(res.status).toBe(200)
      const types = await outboxTypes()
      expect(types).not.toContain('ai.brd.embed_requested')
      expect(types).not.toContain('ai.prd.embed_requested')
    })
  })

  /**
   * The audit trail those transitions leave, and who may read it.
   *
   * The log names the users who moved the project, when, and the reason they
   * typed, so it is not public to anyone holding a session - only the owner and
   * the talents assigned to it, which is what assertProjectAccess enforces.
   */
  describe('GET /:id/status-logs', () => {
    function statusLogs(caller: SessionUser | null, id = projectId) {
      return app(caller).request(`/${id}/status-logs`)
    }

    /** Newest first: the audit view opens on what just happened. */
    it('returns the transitions most recent first', async () => {
      await transition(session(ownerId), projectId, { status: 'scoping' })
      await transition(session(ownerId), projectId, {
        status: 'brd_review',
        reason: 'Model produced the document',
      })

      const res = await statusLogs(session(ownerId))

      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        data: { fromStatus: string; toStatus: string; reason: string | null }[]
      }
      expect(body.data.map((l) => [l.fromStatus, l.toStatus])).toEqual([
        ['scoping', 'brd_review'],
        ['draft', 'scoping'],
      ])
      expect(body.data[0]?.reason).toBe('Model produced the document')
    })

    it('refuses a signed-in stranger', async () => {
      const res = await statusLogs(session(strangerId))

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.code).toBe('AUTH_FORBIDDEN')
    })

    it('refuses an anonymous reader', async () => {
      const res = await statusLogs(null)

      expect(res.status).toBe(401)
    })

    it('reports an unknown project as not found', async () => {
      const res = await statusLogs(session(ownerId), uuidv7())

      expect(res.status).toBe(404)
    })
  })
})
