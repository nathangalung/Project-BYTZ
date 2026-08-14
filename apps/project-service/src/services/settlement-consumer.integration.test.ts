import {
  brdDocuments,
  getDb,
  milestones,
  prdDocuments,
  projectStatusLogs,
  projects,
  revisionRequests,
  transactions,
  user,
} from '@kerjacus/db'
import { connectTestDatabase, hasTestDatabase, type TestHandle } from '@kerjacus/db/testing'
import { eq, sql } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The consumer that stops a paid document staying locked.
 *
 * payment-service POSTs /payment-callback once with no retry, and the webhook's
 * monotonic status guard short-circuits every Midtrans redelivery after the row
 * is completed, so a lost callback means the owner paid and the BRD never
 * unlocked. This consumer is the durable half. Both paths land in the same
 * PaymentSettlementService, so what has to hold is that a second delivery
 * changes nothing - and that is only provable by delivering twice against a
 * real database and a real unique index.
 *
 * NATS is the only thing stubbed. `handle` is not exported, so the stub keeps
 * the callback the consumer registers and messages are fed to it directly;
 * everything from JSON parse through the settlement write is the real code.
 */

type Handler = (msg: FakeMsg) => void

let registeredHandler: Handler | null = null
let consumerAdds: unknown[] = []
let addError: Error | null = null
let connectError: Error | null = null
const closeSpy = vi.fn(async () => {})
const drainSpy = vi.fn(async () => {})

vi.mock('@nats-io/transport-node', () => ({
  connect: async () => {
    if (connectError) throw connectError
    return { drain: drainSpy, close: async () => {} }
  },
}))

vi.mock('@nats-io/jetstream', () => ({
  AckPolicy: { Explicit: 'explicit' },
  jetstream: () => ({
    consumers: {
      get: async () => ({
        consume: async ({ callback }: { callback: Handler }) => {
          registeredHandler = callback
          return { close: closeSpy }
        },
      }),
    },
  }),
  jetstreamManager: async () => ({
    consumers: {
      add: async (stream: string, config: unknown) => {
        consumerAdds.push({ stream, config })
        if (addError) throw addError
      },
    },
  }),
}))

const { startSettlementConsumer, stopSettlementConsumer } = await import('./settlement-consumer')

const runIf = hasTestDatabase() ? describe : describe.skip
const INTEGRATION_LOCK = sql`SELECT pg_advisory_lock(20260813)`

type FakeMsg = {
  subject: string
  data: Uint8Array
  headers: undefined
  ack: ReturnType<typeof vi.fn>
  nak: ReturnType<typeof vi.fn>
  term: ReturnType<typeof vi.fn>
  /** Resolves once the handler has disposed of this message. */
  settled: Promise<void>
}

/**
 * The consumer registers `(m) => void handle(m)`, so the callback returns
 * before the settlement write finishes and there is no promise to await.
 * Every path through `handle` ends in exactly one of ack, nak or term, so the
 * message reports its own completion through whichever one fires.
 */
function message(payload: unknown): FakeMsg {
  let done: () => void = () => {}
  const settled = new Promise<void>((resolve) => {
    done = resolve
  })
  return {
    subject: 'payment.settled',
    data: new TextEncoder().encode(typeof payload === 'string' ? payload : JSON.stringify(payload)),
    headers: undefined,
    ack: vi.fn(() => done()),
    nak: vi.fn(() => done()),
    term: vi.fn(() => done()),
    settled,
  }
}

function settledEvent(data: Record<string, unknown>) {
  return { id: uuidv7(), type: 'payment.settled', data }
}

runIf('settlement consumer against Postgres', () => {
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
    registeredHandler = null
    consumerAdds = []
    addError = null
    connectError = null
    closeSpy.mockClear()
    drainSpy.mockClear()

    ownerId = uuidv7()
    await handle.db.insert(user).values({
      id: ownerId,
      email: `${ownerId}@example.test`,
      name: 'Owner',
      emailVerified: false,
    })

    projectId = uuidv7()
    await handle.db.insert(projects).values({
      id: projectId,
      ownerId,
      title: 'Paid project',
      description: 'Exercises payment settlement',
      category: 'web_app',
      budgetMin: 1_000_000,
      budgetMax: 5_000_000,
      estimatedTimelineDays: 30,
      status: 'prd_approved',
    })
  })

  afterEach(async () => {
    await stopSettlementConsumer()
  })

  /** Start the consumer and hand back the handler it registered. */
  async function started(): Promise<(payload: unknown) => Promise<FakeMsg>> {
    await startSettlementConsumer()
    const handler = registeredHandler
    if (!handler) throw new Error('consumer registered no handler')
    return async (payload: unknown) => {
      const msg = message(payload)
      handler(msg)
      await msg.settled
      return msg
    }
  }

  it('subscribes to payment.settled on PAYMENT_EVENTS with five deliveries', async () => {
    await startSettlementConsumer()

    expect(consumerAdds).toEqual([
      {
        stream: 'PAYMENT_EVENTS',
        config: {
          durable_name: 'project-payment-settlement',
          ack_policy: 'explicit',
          ack_wait: 30 * 1_000_000_000,
          max_deliver: 5,
          filter_subject: 'payment.settled',
        },
      },
    ])
  })

  it('tolerates a durable consumer that already exists', async () => {
    addError = new Error('consumer name already in use')

    await startSettlementConsumer()

    expect(registeredHandler).not.toBeNull()
  })

  it('survives an unreachable broker without taking the service down', async () => {
    connectError = new Error('connection refused')

    await expect(startSettlementConsumer()).resolves.toBeUndefined()
    expect(registeredHandler).toBeNull()
    // running stayed false, so stop has nothing to close.
    await stopSettlementConsumer()
    expect(drainSpy).not.toHaveBeenCalled()
  })

  it('drains the connection and closes the iterator on shutdown', async () => {
    await startSettlementConsumer()

    await stopSettlementConsumer()

    expect(closeSpy).toHaveBeenCalledTimes(1)
    expect(drainSpy).toHaveBeenCalledTimes(1)
  })

  describe('document settlement', () => {
    async function makeBrd() {
      await handle.db.insert(brdDocuments).values({
        id: uuidv7(),
        projectId,
        content: { summary: 'x' },
        price: 500_000,
        status: 'approved',
      })
    }

    it('unlocks the BRD the owner paid for', async () => {
      await makeBrd()
      const deliver = await started()

      const msg = await deliver(settledEvent({ projectId, orderId: `BRD-${uuidv7()}` }))

      expect(msg.ack).toHaveBeenCalledTimes(1)
      const [doc] = await handle.db
        .select({ paidAt: brdDocuments.paidAt })
        .from(brdDocuments)
        .where(eq(brdDocuments.projectId, projectId))
      expect(doc?.paidAt).not.toBeNull()
    })

    /**
     * Midtrans retries a notification up to five times and the consumer has
     * max_deliver 5 of its own, so the same event arriving twice is routine
     * rather than a fault. The second delivery must not re-stamp the sale.
     */
    it('leaves the original payment timestamp alone on redelivery', async () => {
      await makeBrd()
      const deliver = await started()
      const orderId = `BRD-${uuidv7()}`

      await deliver(settledEvent({ projectId, orderId }))
      const [first] = await handle.db
        .select({ paidAt: brdDocuments.paidAt })
        .from(brdDocuments)
        .where(eq(brdDocuments.projectId, projectId))

      const msg = await deliver(settledEvent({ projectId, orderId }))

      expect(msg.ack).toHaveBeenCalledTimes(1)
      const [second] = await handle.db
        .select({ paidAt: brdDocuments.paidAt })
        .from(brdDocuments)
        .where(eq(brdDocuments.projectId, projectId))
      expect(second?.paidAt?.toISOString()).toBe(first?.paidAt?.toISOString())
    })

    it('unlocks the PRD on a PRD order', async () => {
      await handle.db.insert(prdDocuments).values({
        id: uuidv7(),
        projectId,
        content: { stack: 'x' },
        price: 1_500_000,
        status: 'approved',
      })
      const deliver = await started()

      await deliver(settledEvent({ projectId, orderId: `PRD-${uuidv7()}` }))

      const [doc] = await handle.db
        .select({ paidAt: prdDocuments.paidAt })
        .from(prdDocuments)
        .where(eq(prdDocuments.projectId, projectId))
      expect(doc?.paidAt).not.toBeNull()
    })

    /** No document to unlock is a retryable fault, not a message to drop. */
    it('naks a payment for a document that is not there', async () => {
      const deliver = await started()

      const msg = await deliver(settledEvent({ projectId, orderId: `BRD-${uuidv7()}` }))

      expect(msg.nak).toHaveBeenCalledWith(5_000)
      expect(msg.ack).not.toHaveBeenCalled()
    })
  })

  describe('escrow settlement', () => {
    it('completes only the deposit whose order id this callback names', async () => {
      const paidOrder = `ESC-${uuidv7()}`
      const abandonedOrder = `ESC-${uuidv7()}`
      for (const key of [paidOrder, abandonedOrder]) {
        await handle.db.insert(transactions).values({
          id: uuidv7(),
          projectId,
          type: 'escrow_in',
          amount: 5_000_000,
          status: 'pending',
          idempotencyKey: key,
        })
      }
      const deliver = await started()

      await deliver(settledEvent({ projectId, orderId: paidOrder, amount: 5_000_000 }))

      const rows = await handle.db
        .select({ key: transactions.idempotencyKey, status: transactions.status })
        .from(transactions)
      expect(rows.find((r) => r.key === paidOrder)?.status).toBe('completed')
      // The abandoned checkout stays pending rather than becoming a phantom
      // deposit counted into the owner's spend.
      expect(rows.find((r) => r.key === abandonedOrder)?.status).toBe('pending')
    })

    /**
     * The defect this pinned is fixed, so the expectation is inverted.
     *
     * settleEscrow passed changedBy 'system' into a column that is a foreign
     * key to user, so the insert raised a violation inside the repository
     * transaction and the bare catch swallowed it: escrow settled and the
     * project never started matching, with no log row and nothing reported.
     * changed_by is nullable now and a platform transition writes null.
     */
    it('reaches matching and records the transition with no actor', async () => {
      const orderId = `ESC-${uuidv7()}`
      await handle.db.insert(transactions).values({
        id: uuidv7(),
        projectId,
        type: 'escrow_in',
        amount: 5_000_000,
        status: 'pending',
        idempotencyKey: orderId,
      })
      const deliver = await started()

      const msg = await deliver(settledEvent({ projectId, orderId }))

      // The deposit settles and the message is acked, so nothing surfaces.
      expect(msg.ack).toHaveBeenCalledTimes(1)
      const [txn] = await handle.db
        .select({ status: transactions.status })
        .from(transactions)
        .where(eq(transactions.idempotencyKey, orderId))
      expect(txn?.status).toBe('completed')

      const [project] = await handle.db
        .select({ status: projects.status })
        .from(projects)
        .where(eq(projects.id, projectId))
      expect(project?.status).toBe('matching')
      const logs = await handle.db.select().from(projectStatusLogs)
      expect(logs).toHaveLength(1)
      expect(logs[0]?.toStatus).toBe('matching')
      // Null, because the platform did this and no user did.
      expect(logs[0]?.changedBy).toBeNull()
    })

    /** The money is settled either way; the project's phase must not fail the callback. */
    it('still acks when the project is already past matching', async () => {
      await handle.db
        .update(projects)
        .set({ status: 'in_progress' })
        .where(eq(projects.id, projectId))
      const deliver = await started()

      const msg = await deliver(settledEvent({ projectId, orderId: `ESC-${uuidv7()}` }))

      expect(msg.ack).toHaveBeenCalledTimes(1)
      const [project] = await handle.db
        .select({ status: projects.status })
        .from(projects)
        .where(eq(projects.id, projectId))
      expect(project?.status).toBe('in_progress')
    })
  })

  describe('revision credit', () => {
    let milestoneId: string

    beforeEach(async () => {
      milestoneId = uuidv7()
      await handle.db.insert(milestones).values({
        id: milestoneId,
        projectId,
        title: 'Milestone one',
        description: 'First',
        orderIndex: 0,
        amount: 2_000_000,
        dueDate: new Date(Date.now() + 86_400_000),
      })
    })

    async function fee(orderId: string) {
      await handle.db.insert(transactions).values({
        id: uuidv7(),
        projectId,
        type: 'revision_fee',
        amount: 150_000,
        status: 'completed',
        idempotencyKey: orderId,
      })
    }

    it('mints one credit for a paid revision fee', async () => {
      const orderId = `REV-${milestoneId}-${Date.now()}-abc`
      await fee(orderId)
      const deliver = await started()

      await deliver(settledEvent({ projectId, orderId, amount: 150_000 }))

      const rows = await handle.db.select().from(revisionRequests)
      expect(rows).toHaveLength(1)
      expect(rows[0]?.isPaid).toBe(true)
      expect(rows[0]?.feeAmount).toBe(150_000)
      expect(rows[0]?.requestedBy).toBe(ownerId)
    })

    /**
     * The credit is keyed to the transaction that paid for it, backed by
     * revision_requests_fee_transaction_unique. Without that a redelivery
     * minted a second credit off one payment - a free revision for doing
     * nothing.
     */
    it('mints no second credit when the same fee settles twice', async () => {
      const orderId = `REV-${milestoneId}-${Date.now()}-abc`
      await fee(orderId)
      const deliver = await started()

      await deliver(settledEvent({ projectId, orderId, amount: 150_000 }))
      const msg = await deliver(settledEvent({ projectId, orderId, amount: 150_000 }))

      expect(msg.ack).toHaveBeenCalledTimes(1)
      expect(await handle.db.select().from(revisionRequests)).toHaveLength(1)
    })

    it('mints no credit for a milestone on another project', async () => {
      const orderId = `REV-${uuidv7()}-${Date.now()}-abc`
      await fee(orderId)
      const deliver = await started()

      const msg = await deliver(settledEvent({ projectId, orderId }))

      expect(msg.ack).toHaveBeenCalledTimes(1)
      expect(await handle.db.select().from(revisionRequests)).toHaveLength(0)
    })

    /** A REV- order whose uuid will not parse is malformed, not a missing milestone. */
    it('treats a malformed revision order as an unknown prefix', async () => {
      const deliver = await started()

      const msg = await deliver(settledEvent({ projectId, orderId: 'REV-not-a-uuid' }))

      expect(msg.ack).toHaveBeenCalledTimes(1)
      expect(await handle.db.select().from(revisionRequests)).toHaveLength(0)
    })
  })

  describe('unroutable messages', () => {
    it('terminates an event with no projectId rather than retrying it forever', async () => {
      const deliver = await started()

      const msg = await deliver(settledEvent({ orderId: `BRD-${uuidv7()}` }))

      expect(msg.term).toHaveBeenCalledWith('missing projectId or orderId')
      expect(msg.ack).not.toHaveBeenCalled()
      expect(msg.nak).not.toHaveBeenCalled()
    })

    it('terminates an event with no orderId', async () => {
      const deliver = await started()

      const msg = await deliver(settledEvent({ projectId }))

      expect(msg.term).toHaveBeenCalledWith('missing projectId or orderId')
    })

    it('terminates an event whose data is missing entirely', async () => {
      const deliver = await started()

      const msg = await deliver({ id: uuidv7(), type: 'payment.settled' })

      expect(msg.term).toHaveBeenCalledTimes(1)
    })

    it('naks a body that is not JSON so the delivery is retried', async () => {
      const deliver = await started()

      const msg = await deliver('not json at all')

      expect(msg.nak).toHaveBeenCalledWith(5_000)
      expect(msg.ack).not.toHaveBeenCalled()
    })

    it('acks an order prefix it does not recognise instead of looping on it', async () => {
      const deliver = await started()

      const msg = await deliver(settledEvent({ projectId, orderId: 'WAT-123' }))

      expect(msg.ack).toHaveBeenCalledTimes(1)
    })
  })
})
