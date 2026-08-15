import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The poll loop around the outbox, as opposed to what one pass does with a row.
 *
 * outbox-claim.test.ts owns the claiming and the retry bookkeeping. What only
 * exists here is the loop's relationship to failure: a broker that is down at
 * boot must leave the service running and the rows waiting, a pass that throws
 * must not end the loop, and shutdown must reach the drain even when the
 * connection is already broken - the drain is what flushes publishes that have
 * been handed to the client but not yet sent, and skipping it loses them.
 */

type Row = {
  id: string
  eventType: string
  payload: unknown
  traceContext: unknown
  published: boolean
  retryCount: number
  createdAt: Date
}

const h = vi.hoisted(() => ({
  connect: vi.fn(),
  drain: vi.fn(),
  close: vi.fn(),
  publish: vi.fn(),
  /** Rows the next pass will find. Empty means an idle tick. */
  rows: [] as Row[],
  /** When set, every candidate read throws this instead of answering. */
  readError: null as Error | null,
}))

function tx() {
  const node: Record<string, unknown> = {
    select: () => node,
    from: () => node,
    where: () => node,
    orderBy: () => node,
    update: () => node,
    set: () => node,
    insert: () => node,
    values: async () => undefined,
    limit: () =>
      Object.assign(Promise.resolve(h.rows.map((r) => ({ id: r.id }))), {
        for: async () => h.rows,
      }),
  }
  return node
}

vi.mock('@kerjacus/db', () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => {
              if (h.readError) throw h.readError
              return h.rows.map((r) => ({ id: r.id }))
            },
          }),
        }),
      }),
    }),
    transaction: async (fn: (t: unknown) => Promise<unknown>) => await fn(tx()),
  }),
  outboxEvents: {
    published: 'published',
    retryCount: 'retryCount',
    createdAt: 'createdAt',
    id: 'id',
  },
  deadLetterEvents: {},
}))

// `headers` stays real: publishEvent builds one to carry the trace context, and
// a stub that returns undefined turns every publish into a caught TypeError,
// which reads as a broker fault rather than a broken mock.
vi.mock('@nats-io/transport-node', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@nats-io/transport-node')>()),
  connect: h.connect,
}))
vi.mock('@nats-io/jetstream', () => ({ jetstream: () => ({ publish: h.publish }) }))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => args),
  eq: vi.fn((a: unknown, b: unknown) => ({ type: 'eq', a, b })),
  lt: vi.fn((a: unknown, b: unknown) => ({ type: 'lt', a, b })),
}))

import { startOutboxProcessor, stopOutboxProcessor } from './outbox-worker'

function row(id: string): Row {
  return {
    id,
    eventType: 'project.created',
    payload: { projectId: id },
    traceContext: null,
    published: false,
    retryCount: 0,
    createdAt: new Date(),
  }
}

describe('the outbox poll loop', () => {
  let logged: ReturnType<typeof vi.spyOn>
  let errored: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    h.connect.mockReset().mockResolvedValue({ drain: h.drain, close: h.close })
    h.drain.mockReset().mockResolvedValue(undefined)
    h.close.mockReset().mockResolvedValue(undefined)
    h.publish.mockReset().mockResolvedValue({})
    h.rows = []
    h.readError = null
    logged = vi.spyOn(console, 'log').mockImplementation(() => {})
    errored = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(async () => {
    await stopOutboxProcessor()
    vi.restoreAllMocks()
  })

  it('connects and reports itself started', async () => {
    await startOutboxProcessor()

    expect(h.connect).toHaveBeenCalledTimes(1)
    expect(logged).toHaveBeenCalledWith('[Outbox] Connected to NATS')
    expect(logged).toHaveBeenCalledWith('[Outbox] Processor started')
  })

  /**
   * The rows are durable and the broker will come back. A service that refuses
   * to boot without NATS takes every HTTP route down with it for the duration.
   */
  it('starts anyway when the broker is unreachable', async () => {
    h.connect.mockRejectedValue(new Error('ECONNREFUSED'))

    await expect(startOutboxProcessor()).resolves.toBeUndefined()

    expect(errored).toHaveBeenCalledWith('[Outbox] NATS connection failed:', expect.any(Error))
    expect(logged).toHaveBeenCalledWith('[Outbox] Processor started')
  })

  it('publishes the rows it finds and says how many', async () => {
    h.rows = [row('e1'), row('e2')]

    await startOutboxProcessor()
    await vi.waitFor(() => expect(h.publish).toHaveBeenCalledTimes(2))

    expect(logged).toHaveBeenCalledWith('[Outbox] Published 2 events')
  })

  /** An idle tick is silent; a log line per second would bury the real ones. */
  it('says nothing on a pass that found no rows', async () => {
    await startOutboxProcessor()

    await vi.waitFor(() => expect(logged).toHaveBeenCalledWith('[Outbox] Processor started'))
    expect(logged).not.toHaveBeenCalledWith(expect.stringContaining('Published'))
  })

  /**
   * A pass that throws must be one lost second, not the end of the loop: the
   * worker is the only thing publishing, so a loop that exits silently stops
   * every event in the system with no error after the first.
   */
  it('logs a failed pass and keeps polling', async () => {
    h.readError = new Error('connection terminated unexpectedly')

    await startOutboxProcessor()
    await vi.waitFor(() =>
      expect(errored).toHaveBeenCalledWith('[Outbox] Poll error:', expect.any(Error)),
    )

    // Still alive: clearing the fault lets the next tick publish.
    h.readError = null
    h.rows = [row('e1')]
    await vi.waitFor(() => expect(h.publish).toHaveBeenCalledTimes(1), { timeout: 4000 })
  })
})

describe('outbox shutdown', () => {
  let errored: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    h.connect.mockReset().mockResolvedValue({ drain: h.drain, close: h.close })
    h.drain.mockReset().mockResolvedValue(undefined)
    h.close.mockReset().mockResolvedValue(undefined)
    h.publish.mockReset().mockResolvedValue({})
    h.rows = []
    h.readError = null
    vi.spyOn(console, 'log').mockImplementation(() => {})
    errored = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('drains rather than closing, so in-flight publishes are flushed', async () => {
    await startOutboxProcessor()

    await stopOutboxProcessor()

    expect(h.drain).toHaveBeenCalledTimes(1)
    expect(h.close).not.toHaveBeenCalled()
  })

  /** A connection too broken to drain still has to be released. */
  it('forces a close when the drain fails', async () => {
    await startOutboxProcessor()
    h.drain.mockRejectedValue(new Error('connection reset'))

    await expect(stopOutboxProcessor()).resolves.toBeUndefined()

    expect(errored).toHaveBeenCalledWith(
      '[Outbox] NATS drain error, forcing close:',
      expect.any(Error),
    )
    expect(h.close).toHaveBeenCalledTimes(1)
  })

  /** Already closed is the expected case here, not an error worth raising. */
  it('completes shutdown when even the forced close fails', async () => {
    await startOutboxProcessor()
    h.drain.mockRejectedValue(new Error('connection reset'))
    h.close.mockRejectedValue(new Error('already closed'))

    await expect(stopOutboxProcessor()).resolves.toBeUndefined()
  })

  /** index.ts calls this on every SIGTERM, including one that beat the start. */
  it('is a no-op when the processor never started', async () => {
    await expect(stopOutboxProcessor()).resolves.toBeUndefined()
    expect(h.drain).not.toHaveBeenCalled()
  })

  it('is a no-op when called twice', async () => {
    await startOutboxProcessor()
    await stopOutboxProcessor()

    await stopOutboxProcessor()

    expect(h.drain).toHaveBeenCalledTimes(1)
  })
})
