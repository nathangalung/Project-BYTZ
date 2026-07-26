import type { Database } from '@kerjacus/db'
import { describe, expect, it, vi } from 'vitest'
import { PaymentSettlementService } from './payment-settlement.service'

/**
 * Settling a payment used to be a hundred and fifty lines inside a route
 * handler, reachable only over HTTP with a live database - so none of these
 * cases had ever been asserted, and one of them was wrong.
 *
 * Midtrans retries a notification up to five times and may deliver out of
 * order. Every branch therefore has to be idempotent by construction, not by
 * luck: the same order id arriving twice is normal traffic.
 */

// Minimal stand-in for the Drizzle chain. Each select() shifts one queued
// result, so a test states what the database returns in call order.
function fakeDb(rows: unknown[][]) {
  const queued = [...rows]
  const inserted: unknown[] = []
  const updated: unknown[] = []

  const selectChain = () => {
    const chain: Record<string, unknown> = {}
    for (const key of ['from', 'where', 'innerJoin']) {
      chain[key] = () => chain
    }
    // Every read in the service ends in .limit(1), so the chain never needs
    // to be awaitable itself - which keeps this out of thenable territory.
    chain.limit = async () => queued.shift() ?? []
    return chain
  }

  const db = {
    select: selectChain,
    insert: () => ({
      values: async (v: unknown) => {
        inserted.push(v)
      },
    }),
    update: () => ({
      set: (v: unknown) => ({
        where: async () => {
          updated.push(v)
        },
      }),
    }),
  }
  return { db: db as unknown as Database, inserted, updated }
}

const noTransition = vi.fn(async () => undefined)

describe('document payments', () => {
  it('marks an unpaid BRD as paid', async () => {
    const { db, updated } = fakeDb([[{ paidAt: null }]])
    const result = await new PaymentSettlementService(db, noTransition).settle('p1', 'BRD-1-2')
    expect(result).toEqual({ processed: true, type: 'brd' })
    expect(updated).toHaveLength(1)
  })

  /**
   * paidAt survives a later revision resetting the document's status, so it
   * is the durable record of the sale rather than a view of current state.
   */
  it('does nothing the second time the same BRD payment arrives', async () => {
    const { db, updated } = fakeDb([[{ paidAt: new Date() }]])
    const result = await new PaymentSettlementService(db, noTransition).settle('p1', 'BRD-1-2')
    expect(result).toEqual({ processed: false, reason: 'already processed' })
    expect(updated).toHaveLength(0)
  })

  it('refuses a payment for a document that does not exist', async () => {
    const { db } = fakeDb([[]])
    await expect(
      new PaymentSettlementService(db, noTransition).settle('p1', 'PRD-1-2'),
    ).rejects.toThrow(/not found/i)
  })
})

describe('escrow payments', () => {
  it('settles the transaction and moves the project to matching', async () => {
    const transition = vi.fn(async () => undefined)
    const { db, updated } = fakeDb([])
    const result = await new PaymentSettlementService(db, transition).settle('p1', 'ESC-9')
    expect(result).toEqual({ processed: true, type: 'escrow' })
    expect(updated).toHaveLength(1)
    expect(transition).toHaveBeenCalledWith('p1', 'matching', 'system', expect.any(String))
  })

  /**
   * The money is settled whether or not the project can move. A project
   * already past matching must not turn a successful payment into a failed
   * callback, which Midtrans would then retry.
   */
  it('still reports success when the project cannot transition', async () => {
    const transition = vi.fn(async () => {
      throw new Error('invalid transition')
    })
    const { db } = fakeDb([])
    const result = await new PaymentSettlementService(db, transition).settle('p1', 'ESC-9')
    expect(result).toEqual({ processed: true, type: 'escrow' })
  })
})

describe('revision credits', () => {
  const MS = '0195f2a1-4b3c-7d8e-9f01-23456789abcd'
  const order = `REV-${MS}-1712345678-x9f2`

  it('mints one credit against the transaction that paid for it', async () => {
    const { db, inserted } = fakeDb([
      [{ projectId: 'p1' }], // milestone
      [{ id: 'tx-1' }], // paying transaction
      [], // no existing credit
      [{ ownerId: 'owner-1' }], // project
    ])
    const result = await new PaymentSettlementService(db, noTransition).settle('p1', order, 250_000)
    expect(result).toEqual({ processed: true, type: 'revision' })
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({
      milestoneId: MS,
      isPaid: true,
      feeAmount: 250_000,
      feeTransactionId: 'tx-1',
      requestedBy: 'owner-1',
    })
  })

  /**
   * The bug this extraction was for. A retried notification minted a second
   * credit off a single payment, so an owner got free revisions by doing
   * nothing - and Midtrans retrying is routine traffic, not a fault.
   */
  it('does not mint a second credit when the notification is retried', async () => {
    const { db, inserted } = fakeDb([
      [{ projectId: 'p1' }], // milestone
      [{ id: 'tx-1' }], // paying transaction
      [{ id: 'rev-1' }], // credit already minted for it
    ])
    const result = await new PaymentSettlementService(db, noTransition).settle('p1', order)
    expect(result).toEqual({ processed: false, reason: 'already processed' })
    expect(inserted).toHaveLength(0)
  })

  it('ignores a revision order aimed at another project', async () => {
    const { db, inserted } = fakeDb([[{ projectId: 'other' }]])
    const result = await new PaymentSettlementService(db, noTransition).settle('p1', order)
    expect(result).toEqual({ processed: false, reason: 'unknown milestone' })
    expect(inserted).toHaveLength(0)
  })
})

describe('unrecognised orders', () => {
  it('reports the prefix rather than acting on a guess', async () => {
    const { db, inserted, updated } = fakeDb([])
    const result = await new PaymentSettlementService(db, noTransition).settle('p1', 'SUB-1')
    expect(result).toEqual({ processed: false, reason: 'unknown order prefix' })
    expect(inserted).toHaveLength(0)
    expect(updated).toHaveLength(0)
  })

  // A malformed REV- order is not a revision, so it must not reach a lookup.
  it('treats a revision order with an unreadable uuid as unrecognised', async () => {
    const { db } = fakeDb([])
    const result = await new PaymentSettlementService(db, noTransition).settle('p1', 'REV-nope')
    expect(result).toEqual({ processed: false, reason: 'unknown order prefix' })
  })
})
