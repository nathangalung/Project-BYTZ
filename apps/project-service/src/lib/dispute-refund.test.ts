import { describe, expect, it } from 'vitest'
import { disputeRefundAmount } from './dispute-refund'

/**
 * How much a dispute resolution sends back to the owner.
 *
 * The subtlety is that it is sized against the escrow balance still held,
 * not against what was originally deposited. Milestones approved before the
 * dispute have already left the account, so a refund sized on the deposit
 * would be larger than the balance, get rejected by the payment service, and
 * dead-end the resolution with the dispute stuck open.
 *
 * A split does not pay the talent their half here. That half stays in escrow
 * and settles through the normal milestone approvals of the disputed work,
 * so a dispute resolved back to in_progress keeps funding the remaining
 * milestones rather than moving the same money twice.
 */

describe('disputeRefundAmount', () => {
  it('sends nothing back when the talent keeps the funds', () => {
    expect(disputeRefundAmount('funds_to_talent', 10_000_000, 10_000_000)).toBe(0)
  })

  it('returns the whole held balance to the owner', () => {
    expect(disputeRefundAmount('funds_to_owner', 10_000_000, 10_000_000)).toBe(10_000_000)
  })

  it('halves it on a split', () => {
    expect(disputeRefundAmount('split', 10_000_000, 10_000_000)).toBe(5_000_000)
  })

  /**
   * The case that dead-ends a resolution if it is got wrong: two of four
   * milestones were approved and paid out before the dispute, so only half
   * the deposit is still held.
   */
  it('never exceeds what is still in escrow', () => {
    expect(disputeRefundAmount('funds_to_owner', 10_000_000, 4_000_000)).toBe(4_000_000)
    expect(disputeRefundAmount('split', 10_000_000, 4_000_000)).toBe(2_000_000)
  })

  it('sends nothing when the escrow is already empty', () => {
    expect(disputeRefundAmount('funds_to_owner', 10_000_000, 0)).toBe(0)
    expect(disputeRefundAmount('split', 10_000_000, 0)).toBe(0)
  })

  // Rupiah has no subunit in this ledger, so a split of an odd amount must
  // round down rather than refund a fraction the balance cannot cover.
  it('rounds a split down', () => {
    expect(disputeRefundAmount('split', 7, 7)).toBe(3)
  })

  // A negative balance would be a ledger fault; refunding on it would compound it.
  it('refuses to refund against a negative balance', () => {
    expect(disputeRefundAmount('funds_to_owner', 10_000_000, -500)).toBe(0)
  })
})
