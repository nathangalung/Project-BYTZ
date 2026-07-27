import { outboxEvents } from '@kerjacus/db'
import type { JetStreamClient } from '@nats-io/jetstream'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The poller selected unpublished rows with no lock, so every replica claimed
 * the same batch and published every event once per replica. JetStream's
 * msgID dedup absorbed it inside a 2-minute window, which made it wasted work
 * rather than duplicate delivery - but it is what stops the service running
 * more than one instance.
 *
 * The fake Postgres below implements just enough of FOR UPDATE SKIP LOCKED to
 * show the claim working: a row locked by an open transaction is invisible to
 * anyone else's locking read, and the lock lifts when that transaction ends.
 */

type Row = {
  id: string
  eventType: string
  payload: unknown
  traceContext: unknown
  published: boolean
  retryCount: number
  errorMessage: string | null
  publishedAt: Date | null
  createdAt: Date
}

type Condition =
  | { op: 'and'; parts: Condition[] }
  | { op: 'eq'; col: unknown; val: unknown }
  | { op: 'lt'; col: unknown; val: number }

vi.mock('drizzle-orm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('drizzle-orm')>()),
  and: (...parts: Condition[]) => ({ op: 'and', parts }),
  eq: (col: unknown, val: unknown) => ({ op: 'eq', col, val }),
  lt: (col: unknown, val: number) => ({ op: 'lt', col, val }),
}))

let rows: Row[] = []
const lockedRows = new Set<string>()

/** The id a claim query pins itself to, if any. */
function targetId(cond: Condition | undefined): string | undefined {
  if (!cond) return undefined
  if (cond.op === 'and') {
    for (const part of cond.parts) {
      const found = targetId(part)
      if (found) return found
    }
    return undefined
  }
  return cond.op === 'eq' && cond.col === outboxEvents.id ? String(cond.val) : undefined
}

const pending = (row: Row) => !row.published && row.retryCount < 3

function selectFrom(heldLocks: Set<string> | null) {
  let where: Condition | undefined
  const result = (locking: boolean): Row[] => {
    const id = targetId(where)
    const candidates = rows.filter((row) => pending(row) && (!id || row.id === id))
    if (!locking) return candidates
    const free = candidates.filter((row) => !lockedRows.has(row.id))
    for (const row of free) {
      lockedRows.add(row.id)
      heldLocks?.add(row.id)
    }
    return free
  }
  // Drizzle queries are awaitable, and `.for()` turns one into a locking read.
  const limitNode = Object.assign(Promise.resolve(result(false)), {
    for: async () => result(true),
  })
  const node: Record<string, unknown> = {
    where: (cond: Condition) => {
      where = cond
      return node
    },
    orderBy: () => node,
    limit: () => limitNode,
  }
  return node
}

function client(heldLocks: Set<string> | null) {
  return {
    select: () => ({ from: () => selectFrom(heldLocks) }),
    update: () => ({
      set: (values: Partial<Row>) => ({
        where: async (cond: Condition) => {
          const id = targetId(cond)
          const row = rows.find((r) => r.id === id)
          if (row) Object.assign(row, values)
        },
      }),
    }),
    insert: () => ({ values: async () => undefined }),
  }
}

vi.mock('@kerjacus/db', async (importOriginal) => {
  const original = await importOriginal<typeof import('@kerjacus/db')>()
  return {
    ...original,
    getDb: () => ({
      ...client(null),
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        const held = new Set<string>()
        try {
          return await fn(client(held))
        } finally {
          for (const id of held) lockedRows.delete(id)
        }
      },
    }),
  }
})

const { pollAndPublish } = await import('./outbox-worker')

const published: string[] = []
// Stall the publish of one event so the other poller runs while its row is
// locked, which is the interleaving the claim has to survive.
let holdOn: string | null = null
let releaseHold: (() => void) | null = null
let reached: (() => void) | null = null
let reachedHold: Promise<void> = Promise.resolve()

function jetStream(): JetStreamClient {
  return {
    publish: async (_subject: string, _data: string, opts: { msgID: string }) => {
      published.push(opts.msgID)
      if (opts.msgID === holdOn) {
        holdOn = null
        await new Promise<void>((resolve) => {
          releaseHold = resolve
          reached?.()
        })
      }
      return {}
    },
  } as unknown as JetStreamClient
}

function row(id: string): Row {
  return {
    id,
    eventType: 'project.created',
    payload: { projectId: id },
    traceContext: null,
    published: false,
    retryCount: 0,
    errorMessage: null,
    publishedAt: null,
    createdAt: new Date(),
  }
}

beforeEach(() => {
  rows = [row('e1'), row('e2'), row('e3')]
  lockedRows.clear()
  published.length = 0
  holdOn = null
  releaseHold = null
  reached = null
  reachedHold = new Promise<void>((resolve) => {
    reached = resolve
  })
})

describe('two pollers over one outbox', () => {
  it('claims disjoint batches and publishes each event once', async () => {
    // Poller A stalls mid-publish of e1, holding its row lock.
    holdOn = 'e1'
    const a = pollAndPublish(jetStream())
    await reachedHold

    // B runs to completion while A holds e1.
    const bCount = await pollAndPublish(jetStream())

    releaseHold?.()
    const aCount = await a

    expect(published).toEqual(['e1', 'e2', 'e3'])
    expect(bCount).toBe(2)
    expect(aCount).toBe(1)
  })

  it('leaves the row locked by the other poller alone rather than waiting for it', async () => {
    holdOn = 'e1'
    const a = pollAndPublish(jetStream())
    await reachedHold

    await pollAndPublish(jetStream())

    // B got past e1 without blocking on it, which is what SKIP LOCKED buys.
    expect(published).toEqual(['e1', 'e2', 'e3'])
    expect(rows.find((r) => r.id === 'e1')?.published).toBe(false)

    releaseHold?.()
    await a
    expect(rows.every((r) => r.published)).toBe(true)
  })

  // The batch select takes no lock, so by the time a row is claimed another
  // replica may already have published it.
  it('re-checks under the lock and skips what was published meanwhile', async () => {
    holdOn = 'e1'
    const a = pollAndPublish(jetStream())
    await reachedHold
    await pollAndPublish(jetStream())
    releaseHold?.()

    // A's own batch still lists e2 and e3; it must publish neither again.
    expect(await a).toBe(1)
    expect(published.filter((id) => id === 'e2')).toHaveLength(1)
  })
})

describe('a publish that fails', () => {
  it('bumps retry_count and leaves the row unpublished', async () => {
    const failing = {
      publish: async () => {
        throw new Error('nats down')
      },
    } as unknown as JetStreamClient

    expect(await pollAndPublish(failing)).toBe(0)

    // The claim rolled back with the publish, so the bookkeeping had to run
    // outside it or it would have rolled back too.
    expect(rows.every((r) => r.retryCount === 1)).toBe(true)
    expect(rows.every((r) => !r.published)).toBe(true)
    expect(rows.every((r) => r.errorMessage === 'nats down')).toBe(true)
    expect(lockedRows.size).toBe(0)
  })

  it('stops claiming a row once its retry budget is spent', async () => {
    for (const r of rows) r.retryCount = 3

    expect(await pollAndPublish(jetStream())).toBe(0)
    expect(published).toEqual([])
  })
})
