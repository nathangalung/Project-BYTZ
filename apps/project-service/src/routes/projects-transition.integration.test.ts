// biome-ignore-all lint/style/noRestrictedImports: the rule keeps route HANDLERS
// off Drizzle. This is a test, and the tables are what the fixtures are made of.

import {
  brdDocuments,
  getDb,
  outboxEvents,
  prdDocuments,
  projectStatusLogs,
  projects as projectsTable,
  transactions,
  user,
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

  describe('team projects reach matched only through team_forming', () => {
    it('refuses matching straight to matched when the team is larger than one', async () => {
      await setStatus('matching', 3)

      const res = await transition(session(ownerId), projectId, { status: 'matched' })

      expect(res.status).toBe(400)
      expect(((await res.json()) as ErrorBody).error.message).toContain('team_forming')
      expect(await statusOf()).toBe('matching')
    })

    /** One talent has no team to form, so the direct hop is the whole flow. */
    it('allows matching straight to matched for a single-talent project', async () => {
      await setStatus('matching', 1)

      const res = await transition(session(ownerId), projectId, { status: 'matched' })

      expect(res.status).toBe(200)
      expect(await statusOf()).toBe('matched')
    })

    it('starts the escalation timer when a team enters team_forming', async () => {
      await setStatus('matching', 3)

      const res = await transition(session(ownerId), projectId, { status: 'team_forming' })

      expect(res.status).toBe(200)
      await flush()
      expect(h.startTeamFormationWorkflow).toHaveBeenCalledWith(projectId)
    })

    it('starts no timer for a single-talent project entering team_forming', async () => {
      await setStatus('matching', 1)

      const res = await transition(session(ownerId), projectId, { status: 'team_forming' })

      expect(res.status).toBe(200)
      await flush()
      expect(h.startTeamFormationWorkflow).not.toHaveBeenCalled()
    })

    /**
     * Temporal is a safety net, not part of the transaction. A broker that is
     * down must not fail a transition that has already committed.
     */
    it('still transitions when the escalation timer cannot be started', async () => {
      await setStatus('matching', 3)
      h.startTeamFormationWorkflow.mockRejectedValue(new Error('temporal unreachable'))

      const res = await transition(session(ownerId), projectId, { status: 'team_forming' })

      expect(res.status).toBe(200)
      expect(await statusOf()).toBe('team_forming')
      await flush()
      expect(warned).toHaveBeenCalledWith(
        '[temporal] team formation workflow start failed',
        expect.objectContaining({ projectId }),
      )
    })

    it('signals the workflow when a team reaches matched', async () => {
      await setStatus('team_forming', 3)

      const res = await transition(session(ownerId), projectId, { status: 'matched' })

      expect(res.status).toBe(200)
      await flush()
      expect(h.signalTeamComplete).toHaveBeenCalledWith(projectId)
    })

    it('sends no completion signal for a single-talent project', async () => {
      await setStatus('team_forming', 1)

      const res = await transition(session(ownerId), projectId, { status: 'matched' })

      expect(res.status).toBe(200)
      await flush()
      expect(h.signalTeamComplete).not.toHaveBeenCalled()
    })

    it('still transitions when the completion signal fails', async () => {
      await setStatus('team_forming', 3)
      h.signalTeamComplete.mockRejectedValue(new Error('temporal unreachable'))

      const res = await transition(session(ownerId), projectId, { status: 'matched' })

      expect(res.status).toBe(200)
      expect(await statusOf()).toBe('matched')
      await flush()
      expect(warned).toHaveBeenCalledWith(
        '[temporal] team complete signal failed',
        expect.objectContaining({ projectId }),
      )
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
      await setStatus('brd_generated', 1)
      const docId = await insertBrd(1)

      const res = await transition(session(ownerId), projectId, { status: 'brd_approved' })

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
      await setStatus('prd_generated', 1)
      const docId = uuidv7()
      await handle.db.insert(prdDocuments).values({
        id: docId,
        projectId,
        content: { techStack: ['hono'] },
        version: 2,
        status: 'review',
        price: 1_500_000,
      })

      const res = await transition(session(ownerId), projectId, { status: 'prd_approved' })

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
     * Approving with no document row is a no-op rather than an error: the
     * status change is the owner's decision and must not be held hostage to a
     * document the embedding pipeline has nothing to say about.
     */
    it('approves without an embedding request when no document exists', async () => {
      await setStatus('brd_generated', 1)

      const res = await transition(session(ownerId), projectId, { status: 'brd_approved' })

      expect(res.status).toBe(200)
      expect(await statusOf()).toBe('brd_approved')
      expect(await outboxTypes()).not.toContain('ai.brd.embed_requested')
    })

    /** A transition that is neither approval enqueues nothing. */
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
        status: 'brd_generated',
        reason: 'Model produced the document',
      })

      const res = await statusLogs(session(ownerId))

      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        data: { fromStatus: string; toStatus: string; reason: string | null }[]
      }
      expect(body.data.map((l) => [l.fromStatus, l.toStatus])).toEqual([
        ['scoping', 'brd_generated'],
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
