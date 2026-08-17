/**
 * What an order id says was bought.
 *
 * Checkout mints ids prefixed by kind. Revision orders carry the milestone
 * they pay for as `REV-{uuid}-{ts}-{rand}`, and the uuid contains hyphens
 * itself, so it has to be matched by shape rather than found by splitting.
 */
type OrderRef =
  | { kind: 'brd' }
  | { kind: 'prd' }
  | { kind: 'escrow' }
  | { kind: 'revision'; milestoneId: string }
  | { kind: 'unknown' }

const REVISION_ORDER = /^REV-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:-|$)/i

export function parseOrderRef(orderId: string): OrderRef {
  if (orderId.startsWith('BRD-')) return { kind: 'brd' }
  if (orderId.startsWith('PRD-')) return { kind: 'prd' }
  if (orderId.startsWith('ESC-')) return { kind: 'escrow' }

  // A REV- order whose uuid will not parse is malformed, not a revision for a
  // milestone that happens to be missing - saying so keeps the two apart.
  if (orderId.startsWith('REV-')) {
    const milestoneId = orderId.match(REVISION_ORDER)?.[1]
    return milestoneId ? { kind: 'revision', milestoneId } : { kind: 'unknown' }
  }

  return { kind: 'unknown' }
}
