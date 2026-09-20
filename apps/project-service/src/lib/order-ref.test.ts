import { describe, expect, it } from 'vitest'
import { parseOrderRef } from './order-ref'

/**
 * Every checkout mints an order id whose prefix says what was bought. The
 * payment callback branched on those prefixes inline, and the revision case
 * pulled a milestone uuid back out of the string with a regex - which is what
 * made a REV- order 61 characters, past the 50 Midtrans accepts, so no paid
 * revision could be checked out at all. The prefix is now the whole of what an
 * order id carries; the milestone lives on the transaction row.
 *
 * Reading an order id is a pure decision and belongs where it can be tested
 * against the strings Midtrans actually sends, rather than only through a
 * route that needs a database to reach.
 */

describe('parseOrderRef', () => {
  it('reads the document prefixes', () => {
    expect(parseOrderRef('BRD-abc-123')).toEqual({ kind: 'brd' })
    expect(parseOrderRef('PRD-abc-123')).toEqual({ kind: 'prd' })
    expect(parseOrderRef('ESC-abc-123')).toEqual({ kind: 'escrow' })
  })

  it('reads a revision order minted by payment-service', () => {
    expect(parseOrderRef('REV-m8k2p1qz-3f9wla7x')).toEqual({ kind: 'revision' })
  })

  /**
   * Ids minted while the milestone uuid was still embedded are in flight and
   * settle the same way, so the change needs no migration window.
   */
  it('reads an order minted in the old REV-{uuid} format', () => {
    const id = '0195f2a1-4b3c-7d8e-9f01-23456789abcd'
    expect(parseOrderRef(`REV-${id}-1712345678-x9f2`)).toEqual({ kind: 'revision' })
  })

  /**
   * Nothing after the prefix is parsed any more, so its shape cannot make an
   * order malformed. A REV- id with no checkout behind it is refused by
   * settleRevision, which looks the transaction up and finds nothing.
   */
  it('routes any REV- order to the revision branch', () => {
    expect(parseOrderRef('REV-not-a-uuid-123')).toEqual({ kind: 'revision' })
    expect(parseOrderRef('REV-')).toEqual({ kind: 'revision' })
  })

  it('reports an unrecognised prefix rather than guessing', () => {
    expect(parseOrderRef('SUB-abc-123')).toEqual({ kind: 'unknown' })
    expect(parseOrderRef('')).toEqual({ kind: 'unknown' })
    expect(parseOrderRef('brd-lowercase')).toEqual({ kind: 'unknown' })
  })
})
