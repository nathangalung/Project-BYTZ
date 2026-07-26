export type DisputeResolutionType = 'funds_to_talent' | 'funds_to_owner' | 'split'

/**
 * How much a dispute resolution returns to the owner.
 *
 * Sized against the escrow balance still held, not the original deposit.
 * Milestones approved before the dispute have already left the account, so a
 * refund sized on the deposit would exceed the balance, be rejected by the
 * payment service, and leave the dispute stuck open with no way forward.
 *
 * A split does not pay the talent their half here. That half stays in escrow
 * and settles through the normal milestone approvals of the disputed work, so
 * a dispute resolved back to in_progress keeps funding the remaining
 * milestones instead of moving the same money twice.
 */
export function disputeRefundAmount(
  resolutionType: DisputeResolutionType,
  escrowAmount: number,
  escrowBalance: number,
): number {
  if (resolutionType === 'funds_to_talent') return 0

  // A negative balance is a ledger fault; refunding against it compounds it.
  const held = Math.min(escrowAmount, Math.max(escrowBalance, 0))
  if (held <= 0) return 0

  // Rupiah carries no subunit in this ledger, so a split rounds down rather
  // than refunding a fraction the balance cannot cover.
  return resolutionType === 'split' ? Math.floor(held / 2) : held
}
