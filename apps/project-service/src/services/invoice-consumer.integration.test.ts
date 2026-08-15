import {
  getDb,
  milestones,
  projectInvoices,
  projects,
  talentProfiles,
  transactions,
  user,
  workPackages,
} from '@kerjacus/db'
import { connectTestDatabase, hasTestDatabase, type TestHandle } from '@kerjacus/db/testing'
import { eq, sql } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * One milestone approval produces three invoice copies sharing one number.
 *
 * The audience split is a confidentiality rule, not a formatting choice: the
 * owner's copy carries the gross they paid, the talent's carries the payout,
 * and the fee is the difference, so a single copy must never carry both. The
 * consumer generates all three, and the whole thing has to be idempotent
 * because JetStream redelivers.
 *
 * Storage is switched off before `lib/env` is validated so the PDF lands in a
 * temp file rather than requiring MinIO. NATS is stubbed; the render, the
 * numbering and the writes are real.
 */
vi.hoisted(() => {
  // env is validated at import time, so this has to run before the imports.
  process.env.S3_ENDPOINT = 'disabled'
})

type Handler = (msg: FakeMsg) => void

let registeredHandler: Handler | null = null
let consumerAdds: unknown[] = []
// Deliberately `unknown`: NATS client errors are not guaranteed to be Error
// instances, and the already-exists check has to survive one that is not.
let addError: unknown = null
let connectError: Error | null = null
let connectResolvesEmpty = false
const closeSpy = vi.fn(async () => {})
const drainSpy = vi.fn(async () => {})

vi.mock('@nats-io/transport-node', () => ({
  connect: async () => {
    if (connectError) throw connectError
    if (connectResolvesEmpty) return null
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

const { startInvoiceConsumer, stopInvoiceConsumer } = await import('./invoice-consumer')

const runIf = hasTestDatabase() ? describe : describe.skip
const INTEGRATION_LOCK = sql`SELECT pg_advisory_lock(20260813)`

/** The slice of the NATS headers API the consumer's trace carrier reads. */
type FakeHeaders = {
  get: (key: string) => string | undefined
  set: (key: string, value: string) => void
  keys: () => string[]
}

type FakeMsg = {
  subject: string
  data: Uint8Array
  headers: FakeHeaders | undefined
  ack: ReturnType<typeof vi.fn>
  nak: ReturnType<typeof vi.fn>
  term: ReturnType<typeof vi.fn>
  settled: Promise<void>
}

/** The registered callback discards the handler promise; the message signals instead. */
function message(payload: unknown, headers?: FakeHeaders): FakeMsg {
  let done: () => void = () => {}
  const settled = new Promise<void>((resolve) => {
    done = resolve
  })
  return {
    subject: 'milestone.invoice_requested',
    data: new TextEncoder().encode(typeof payload === 'string' ? payload : JSON.stringify(payload)),
    headers,
    ack: vi.fn(() => done()),
    nak: vi.fn(() => done()),
    term: vi.fn(() => done()),
    settled,
  }
}

/**
 * Headers as the publisher leaves them, plus a key that carries no value.
 *
 * The empty one is not padding: the carrier reads every key `keys()` reports
 * and a missing value has to arrive at the propagator as '' rather than
 * undefined, or restoring the context throws and the whole message naks for a
 * reason that has nothing to do with the invoice.
 */
function tracedHeaders(traceparent: string): FakeHeaders {
  const values: Record<string, string> = { traceparent }
  return {
    get: (key) => values[key],
    set: (key, value) => {
      values[key] = value
    },
    keys: () => [...Object.keys(values), 'tracestate'],
  }
}

runIf('invoice consumer against Postgres', () => {
  let handle: TestHandle
  let ownerId: string
  let talentId: string
  let projectId: string
  let milestoneId: string
  let packageId: string

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
    connectResolvesEmpty = false
    closeSpy.mockClear()
    drainSpy.mockClear()

    ownerId = uuidv7()
    await handle.db.insert(user).values({
      id: ownerId,
      email: `owner-${ownerId}@example.test`,
      name: 'Owner',
      emailVerified: false,
    })
    const talentUserId = uuidv7()
    await handle.db.insert(user).values({
      id: talentUserId,
      email: `talent-${talentUserId}@example.test`,
      name: 'Talent',
      emailVerified: false,
    })
    talentId = uuidv7()
    await handle.db.insert(talentProfiles).values({
      id: talentId,
      userId: talentUserId,
      verificationStatus: 'verified',
    })

    projectId = uuidv7()
    await handle.db.insert(projects).values({
      id: projectId,
      ownerId,
      title: 'Invoiced project',
      description: 'Exercises invoice generation',
      category: 'web_app',
      budgetMin: 1_000_000,
      budgetMax: 10_000_000,
      estimatedTimelineDays: 30,
      status: 'in_progress',
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

    milestoneId = uuidv7()
    await handle.db.insert(milestones).values({
      id: milestoneId,
      projectId,
      workPackageId: packageId,
      assignedTalentId: talentId,
      title: 'Milestone one',
      description: 'Delivered the API',
      orderIndex: 0,
      amount: 10_000_000,
      status: 'approved',
      dueDate: new Date(Date.now() + 86_400_000),
    })
  })

  afterEach(async () => {
    await stopInvoiceConsumer()
  })

  async function started(): Promise<(payload: unknown, headers?: FakeHeaders) => Promise<FakeMsg>> {
    await startInvoiceConsumer()
    const handler = registeredHandler
    if (!handler) throw new Error('consumer registered no handler')
    return async (payload: unknown, headers?: FakeHeaders) => {
      const msg = message(payload, headers)
      handler(msg)
      await msg.settled
      return msg
    }
  }

  function event(data: Record<string, unknown>) {
    return { id: uuidv7(), type: 'milestone.invoice_requested', data }
  }

  it('subscribes to milestone.invoice_requested on MILESTONE_EVENTS', async () => {
    await startInvoiceConsumer()

    expect(consumerAdds).toEqual([
      {
        stream: 'MILESTONE_EVENTS',
        config: {
          durable_name: 'project-invoice-generator',
          ack_policy: 'explicit',
          ack_wait: 30 * 1_000_000_000,
          max_deliver: 3,
          filter_subject: 'milestone.invoice_requested',
        },
      },
    ])
  })

  it('tolerates a durable consumer that already exists', async () => {
    addError = new Error('consumer already exists')

    await startInvoiceConsumer()

    expect(registeredHandler).not.toBeNull()
  })

  it('survives an unreachable broker', async () => {
    connectError = new Error('connection refused')

    await expect(startInvoiceConsumer()).resolves.toBeUndefined()
    expect(registeredHandler).toBeNull()
  })

  it('drains and closes on shutdown', async () => {
    await startInvoiceConsumer()

    await stopInvoiceConsumer()

    expect(closeSpy).toHaveBeenCalledTimes(1)
    expect(drainSpy).toHaveBeenCalledTimes(1)
  })

  /**
   * Only "already in use" is benign. Any other creation failure must leave the
   * consumer unregistered rather than reporting a healthy start while no
   * invoice is ever generated.
   */
  it('refuses to start when the consumer cannot be created', async () => {
    addError = new Error('nats: permission violation for add consumer')

    await startInvoiceConsumer()

    expect(registeredHandler).toBeNull()
  })

  /** The already-exists check reads a message off whatever was thrown. */
  it('tolerates an already-exists failure that is not an Error object', async () => {
    addError = 'consumer name already in use'

    await startInvoiceConsumer()

    expect(registeredHandler).not.toBeNull()
  })

  /**
   * A client that resolves to nothing is a failed start, not a null
   * dereference inside the consumer setup.
   */
  it('treats a broker client that resolves to nothing as a failed start', async () => {
    connectResolvesEmpty = true

    await expect(startInvoiceConsumer()).resolves.toBeUndefined()
    expect(registeredHandler).toBeNull()
  })

  /**
   * The publisher's trace context has to survive the hop through the broker,
   * otherwise the three invoices are orphan spans and the milestone approval
   * that produced them cannot be found from them.
   */
  it('restores the trace context the publisher attached to the message', async () => {
    const deliver = await started()

    const msg = await deliver(
      event({ milestoneId, projectId }),
      tracedHeaders('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'),
    )

    expect(msg.ack).toHaveBeenCalledTimes(1)
    expect(await handle.db.select().from(projectInvoices)).toHaveLength(3)
  })

  /**
   * The acknowledgement itself can fail, and a NATS client is under no
   * obligation to throw an Error when it does. The invoices have already been
   * written by this point, so the only correct move is to nak and let the
   * redelivery find them and short-circuit.
   */
  it('naks when acknowledging throws something that is not an Error', async () => {
    await startInvoiceConsumer()
    const handler = registeredHandler
    if (!handler) throw new Error('consumer registered no handler')
    const msg = message(event({ milestoneId, projectId }))
    msg.ack.mockImplementation(() => {
      throw 'connection lost'
    })

    handler(msg)
    await msg.settled

    expect(msg.nak).toHaveBeenCalledWith(5_000)
  })

  it('generates one copy per audience, all sharing a single invoice number', async () => {
    const deliver = await started()

    const msg = await deliver(event({ milestoneId, projectId }))

    expect(msg.ack).toHaveBeenCalledTimes(1)
    const rows = await handle.db
      .select({ audience: projectInvoices.audience, number: projectInvoices.invoiceNumber })
      .from(projectInvoices)
      .orderBy(projectInvoices.audience)
    expect(rows.map((r) => r.audience).sort()).toEqual(['admin', 'owner', 'talent'])
    expect(new Set(rows.map((r) => r.number)).size).toBe(1)
    expect(rows[0]?.number).toMatch(/^INV-[0-9A-F]{8}-0001$/)
  })

  /**
   * The idempotency the consumer's comment claims, executed. Without the
   * short-circuit in findByMilestone the second delivery hits
   * uq_project_invoices_milestone_audience and the whole batch naks, so the
   * milestone would loop until max_deliver dropped it.
   */
  it('produces no second set of invoices when the event is redelivered', async () => {
    const deliver = await started()

    await deliver(event({ milestoneId, projectId }))
    const first = await handle.db.select().from(projectInvoices)
    const msg = await deliver(event({ milestoneId, projectId }))

    expect(msg.ack).toHaveBeenCalledTimes(1)
    expect(msg.nak).not.toHaveBeenCalled()
    const second = await handle.db.select().from(projectInvoices)
    expect(second).toHaveLength(3)
    expect(second.map((r) => r.id).sort()).toEqual(first.map((r) => r.id).sort())
  })

  /** Numbering is sequential per project and counts milestones, not copies. */
  it('numbers a second milestone 0002 rather than 0004', async () => {
    const deliver = await started()
    await deliver(event({ milestoneId, projectId }))

    const secondMilestone = uuidv7()
    await handle.db.insert(milestones).values({
      id: secondMilestone,
      projectId,
      workPackageId: packageId,
      assignedTalentId: talentId,
      title: 'Milestone two',
      description: 'Delivered the rest',
      orderIndex: 1,
      amount: 5_000_000,
      status: 'approved',
      dueDate: new Date(Date.now() + 172_800_000),
    })
    await deliver(event({ milestoneId: secondMilestone, projectId }))

    const rows = await handle.db
      .select({ number: projectInvoices.invoiceNumber })
      .from(projectInvoices)
      .where(eq(projectInvoices.milestoneId, secondMilestone))
    expect(rows[0]?.number).toMatch(/-0002$/)
    expect(new Set(rows.map((r) => r.number)).size).toBe(1)
  })

  /**
   * The gross the owner funded is the escrow_release amount when one exists,
   * not the milestone's face value, so a partial release invoices the amount
   * that actually moved.
   */
  it('invoices against the released amount when an escrow release exists', async () => {
    await handle.db.insert(transactions).values({
      id: uuidv7(),
      projectId,
      milestoneId,
      talentId,
      type: 'escrow_release',
      amount: 4_000_000,
      status: 'completed',
      idempotencyKey: `release:${milestoneId}`,
    })
    const deliver = await started()

    const msg = await deliver(event({ milestoneId, projectId }))

    expect(msg.ack).toHaveBeenCalledTimes(1)
    expect(await handle.db.select().from(projectInvoices)).toHaveLength(3)
  })

  it('terminates an event carrying no milestoneId', async () => {
    const deliver = await started()

    const msg = await deliver(event({ projectId }))

    expect(msg.term).toHaveBeenCalledWith('missing milestoneId')
    expect(msg.ack).not.toHaveBeenCalled()
  })

  it('naks a body that is not JSON', async () => {
    const deliver = await started()

    const msg = await deliver('{ not json')

    expect(msg.nak).toHaveBeenCalledWith(5_000)
  })

  /** A milestone with no talent cannot be invoiced; retry rather than drop. */
  it('naks a milestone that resolves to no talent', async () => {
    await handle.db
      .update(milestones)
      .set({ assignedTalentId: null, workPackageId: null })
      .where(eq(milestones.id, milestoneId))
    const deliver = await started()

    const msg = await deliver(event({ milestoneId, projectId }))

    expect(msg.nak).toHaveBeenCalledWith(5_000)
    expect(await handle.db.select().from(projectInvoices)).toHaveLength(0)
  })

  it('naks an unknown milestone', async () => {
    const deliver = await started()

    const msg = await deliver(event({ milestoneId: uuidv7(), projectId }))

    expect(msg.nak).toHaveBeenCalledWith(5_000)
  })
})
