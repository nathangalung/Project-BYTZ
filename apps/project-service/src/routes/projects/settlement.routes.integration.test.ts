// biome-ignore-all lint/style/noRestrictedImports: the rule keeps route HANDLERS
// off Drizzle. This is a test, and the tables are what the fixtures are made of.

import { brdDocuments, getDb, projects as projectsTable, transactions, user } from '@kerjacus/db'
import { connectTestDatabase, hasTestDatabase, type TestHandle } from '@kerjacus/db/testing'
import { eq, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { errorHandler } from '../../middleware/error-handler'
import { settlementRoutes } from './settlement.routes'

/**
 * The one handler payment-service calls rather than a browser.
 *
 * It authenticates with the shared inter-service secret instead of a session,
 * which makes the auth check the entire boundary: everything behind it moves a
 * project's status on the strength of a claim that money arrived. An unguarded
 * or weakly guarded callback lets anyone who can reach the container mark a
 * BRD paid.
 *
 * Midtrans retries a notification up to five times and may deliver out of
 * order, so a repeat delivery of the same order id is routine rather than a
 * fault, and the second one must not do the work twice.
 */

const runIf = hasTestDatabase() ? describe : describe.skip
const INTEGRATION_LOCK = sql`SELECT pg_advisory_lock(20260813)`

// Pinned by vitest.setup.ts, so the literal is deterministic.
const SECRET = 'test-service-auth-secret'

function app() {
  const a = new Hono()
  a.onError(errorHandler)
  a.route('/', settlementRoutes)
  return a
}

type ErrorBody = { success: false; error: { code: string; message: string } }
type OkBody = { success: true; data: { processed: boolean; reason?: string; type?: string } }

runIf('payment callback against Postgres', () => {
  let handle: TestHandle
  let ownerId: string
  let projectId: string

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

    ownerId = uuidv7()
    await handle.db.insert(user).values({
      id: ownerId,
      email: `${ownerId}@example.test`,
      name: 'Owner',
      emailVerified: false,
    })

    projectId = uuidv7()
    await handle.db.insert(projectsTable).values({
      id: projectId,
      ownerId,
      title: 'Marketplace',
      description: 'A managed marketplace for digital projects',
      category: 'web_app',
      budgetMin: 5_000_000,
      budgetMax: 20_000_000,
      estimatedTimelineDays: 60,
      status: 'brd_approved',
    })
  })

  function callback(body: unknown, auth: string | null = SECRET) {
    return app().request(`/${projectId}/payment-callback`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: {
        'Content-Type': 'application/json',
        ...(auth === null ? {} : { 'X-Service-Auth': auth }),
      },
    })
  }

  async function approvedBrd(): Promise<void> {
    await handle.db.insert(brdDocuments).values({
      id: uuidv7(),
      projectId,
      content: { executive_summary: 'A marketplace' },
      version: 1,
      status: 'approved',
      price: 99_000,
    })
  }

  describe('service authentication', () => {
    it('refuses a caller with no service secret', async () => {
      const res = await callback({ orderId: `BRD-${projectId}`, status: 'completed' }, null)

      expect(res.status).toBe(401)
      expect(((await res.json()) as ErrorBody).error.code).toBe('AUTH_UNAUTHORIZED')
    })

    it('refuses a caller with the wrong secret', async () => {
      const res = await callback({ orderId: `BRD-${projectId}`, status: 'completed' }, 'guessed')

      expect(res.status).toBe(401)
      expect(((await res.json()) as ErrorBody).error.code).toBe('AUTH_UNAUTHORIZED')
    })

    /** The auth check runs before the body is even parsed. */
    it('refuses an unauthenticated caller before validating the body', async () => {
      const res = await callback({ garbage: true }, null)

      expect(res.status).toBe(401)
    })
  })

  describe('request validation', () => {
    it('rejects a callback with no order id', async () => {
      const res = await callback({ status: 'completed' })

      expect(res.status).toBe(400)
      expect(((await res.json()) as ErrorBody).error.code).toBe('VALIDATION_ERROR')
    })

    it('rejects a callback with an empty order id', async () => {
      const res = await callback({ orderId: '', status: 'completed' })

      expect(res.status).toBe(400)
    })

    it('rejects a callback with no status', async () => {
      const res = await callback({ orderId: `BRD-${projectId}` })

      expect(res.status).toBe(400)
    })
  })

  describe('settlement', () => {
    /**
     * Midtrans reports every state change, not only the terminal one. A
     * pending or denied notification must be acknowledged and ignored, never
     * settled.
     */
    it.each(['pending', 'denied', 'expire', 'failure'])(
      'acknowledges a %s notification without settling',
      async (status) => {
        await approvedBrd()

        const res = await callback({ orderId: `BRD-${projectId}`, status })

        expect(res.status).toBe(200)
        expect((await res.json()) as OkBody).toMatchObject({
          data: { processed: false, reason: 'non-completed status' },
        })
        const [brd] = await handle.db
          .select({ paidAt: brdDocuments.paidAt })
          .from(brdDocuments)
          .where(eq(brdDocuments.projectId, projectId))
        expect(brd.paidAt).toBeNull()
      },
    )

    it('settles a completed BRD payment and marks the document paid', async () => {
      await approvedBrd()

      const res = await callback({ orderId: `BRD-${projectId}`, status: 'completed' })

      expect(res.status).toBe(200)
      expect((await res.json()) as OkBody).toMatchObject({ data: { processed: true, type: 'brd' } })
      const [brd] = await handle.db
        .select({ paidAt: brdDocuments.paidAt })
        .from(brdDocuments)
        .where(eq(brdDocuments.projectId, projectId))
      expect(brd.paidAt).not.toBeNull()
    })

    /**
     * Paying for a document must NOT advance the project, and the absence is
     * deliberate rather than an omission: BRD_APPROVED -> BRD_PURCHASED is the
     * owner exiting with the document (Opsi A), and Opsi B and C continue from
     * the same paid state. Moving the project here would take that choice away
     * from an owner who paid intending to carry on to the PRD.
     */
    it('unlocks the document without deciding whether the owner is leaving', async () => {
      await approvedBrd()

      await callback({ orderId: `BRD-${projectId}`, status: 'completed' })

      const [project] = await handle.db
        .select({ status: projectsTable.status })
        .from(projectsTable)
        .where(eq(projectsTable.id, projectId))
      expect(project.status).toBe('brd_approved')
    })

    /**
     * A retried notification is routine, not a fault. The UPDATE is the guard
     * rather than the SELECT above it, so the second delivery reports nothing
     * fresh instead of recording a second sale.
     */
    it('is idempotent across a redelivered notification', async () => {
      await approvedBrd()
      await callback({ orderId: `BRD-${projectId}`, status: 'completed' })
      const [first] = await handle.db
        .select({ paidAt: brdDocuments.paidAt })
        .from(brdDocuments)
        .where(eq(brdDocuments.projectId, projectId))

      const res = await callback({ orderId: `BRD-${projectId}`, status: 'completed' })

      expect(res.status).toBe(200)
      expect((await res.json()) as OkBody).toMatchObject({
        data: { processed: false, reason: 'already processed' },
      })
      const [second] = await handle.db
        .select({ paidAt: brdDocuments.paidAt })
        .from(brdDocuments)
        .where(eq(brdDocuments.projectId, projectId))
      // The sale keeps the instant it was first recorded at.
      expect(second.paidAt).toEqual(first.paidAt)
    })

    it('refuses a document payment for a project that has no such document', async () => {
      const res = await callback({ orderId: `PRD-${projectId}`, status: 'completed' })

      expect(res.status).toBe(404)
      expect(((await res.json()) as ErrorBody).error.code).toBe('NOT_FOUND')
    })

    /**
     * Every checkout attempt mints a fresh order id, so an abandoned one
     * leaves a pending escrow_in row behind. The callback used to match on
     * project + type + pending with no order filter, so one real payment
     * flipped all of them to completed: phantom deposits with no ledger
     * entries behind them, each counted into the owner's total spend.
     *
     * The order id is stored as the transaction's idempotency key when the
     * Snap token is minted, which is what lets the callback name its own row.
     */
    it('completes only the escrow transaction the callback names', async () => {
      const paid = `ESC-${projectId}-paid`
      const abandoned = `ESC-${projectId}-abandoned`
      for (const key of [paid, abandoned]) {
        await handle.db.insert(transactions).values({
          id: uuidv7(),
          projectId,
          type: 'escrow_in',
          amount: 10_000_000,
          status: 'pending',
          idempotencyKey: key,
        })
      }

      const res = await callback({ orderId: paid, status: 'completed' })

      expect(res.status).toBe(200)
      expect((await res.json()) as OkBody).toMatchObject({
        data: { processed: true, type: 'escrow' },
      })
      const rows = await handle.db
        .select({ key: transactions.idempotencyKey, status: transactions.status })
        .from(transactions)
        .where(eq(transactions.projectId, projectId))
      expect(rows).toEqual(
        expect.arrayContaining([
          { key: paid, status: 'completed' },
          // The abandoned checkout must stay pending, not become a deposit.
          { key: abandoned, status: 'pending' },
        ]),
      )
    })

    it('leaves an escrow row alone when a different order settles', async () => {
      await handle.db.insert(transactions).values({
        id: uuidv7(),
        projectId,
        type: 'escrow_in',
        amount: 10_000_000,
        status: 'pending',
        idempotencyKey: `ESC-${projectId}-one`,
      })

      await callback({ orderId: `ESC-${projectId}-two`, status: 'completed' })

      const [row] = await handle.db
        .select({ status: transactions.status })
        .from(transactions)
        .where(eq(transactions.projectId, projectId))
      expect(row.status).toBe('pending')
    })

    /**
     * An order id whose prefix names nothing must be reported, not guessed at.
     * Silently treating it as an escrow top-up would move money against the
     * wrong ledger.
     */
    it('refuses to guess at an unrecognised order prefix', async () => {
      const res = await callback({ orderId: `XYZ-${projectId}`, status: 'completed' })

      expect(res.status).toBe(200)
      expect((await res.json()) as OkBody).toMatchObject({
        data: { processed: false, reason: 'unknown order prefix' },
      })
    })

    it('passes the amount through to the settlement service', async () => {
      const res = await callback({
        orderId: `REV-${uuidv7()}-1700000000-abc`,
        status: 'completed',
        amount: 250_000,
      })

      // No such milestone, so nothing settles - what is asserted is that an
      // amount-bearing revision order is routed rather than rejected.
      expect(res.status).toBe(200)
      expect(((await res.json()) as OkBody).data.processed).toBe(false)
    })
  })
})
