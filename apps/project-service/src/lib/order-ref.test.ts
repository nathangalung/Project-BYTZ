import { describe, expect, it } from 'vitest'
import { parseOrderRef } from './order-ref'

/**
 * Every checkout mints an order id whose prefix says what was bought. The
 * payment callback branched on those prefixes inline, and the revision case
 * pulled a milestone uuid back out of the string with a regex - the uuid
 * contains hyphens itself, so it cannot be found by splitting.
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

  it('recovers the milestone uuid a revision order carries', () => {
    const id = '0195f2a1-4b3c-7d8e-9f01-23456789abcd'
    expect(parseOrderRef(`REV-${id}-1712345678-x9f2`)).toEqual({
      kind: 'revision',
      milestoneId: id,
    })
  })

  // uuidv7 hex is lowercase, but a gateway echoing the id may not preserve case.
  it('accepts an uppercased uuid', () => {
    const id = '0195F2A1-4B3C-7D8E-9F01-23456789ABCD'
    expect(parseOrderRef(`REV-${id}-1712345678-x9f2`)).toEqual({
      kind: 'revision',
      milestoneId: id,
    })
  })

  /**
   * A REV- order whose uuid is malformed is not a revision we can act on.
   * Reporting it as a revision with an empty id sent the old code looking up
   * milestone '' and calling the miss "unknown milestone", which reads as a
   * data problem rather than a malformed order.
   */
  it('refuses a revision order with no readable uuid', () => {
    expect(parseOrderRef('REV-not-a-uuid-123')).toEqual({ kind: 'unknown' })
    expect(parseOrderRef('REV-')).toEqual({ kind: 'unknown' })
  })

  it('reports an unrecognised prefix rather than guessing', () => {
    expect(parseOrderRef('SUB-abc-123')).toEqual({ kind: 'unknown' })
    expect(parseOrderRef('')).toEqual({ kind: 'unknown' })
    expect(parseOrderRef('brd-lowercase')).toEqual({ kind: 'unknown' })
  })
})
