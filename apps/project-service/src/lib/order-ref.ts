/**
 * What an order id says was bought.
 *
 * payment-service mints ids prefixed by kind, and the prefix is all an order id
 * carries. A revision order used to embed the milestone uuid it paid for, which
 * pushed the id to 61 characters - past the 50 Midtrans accepts - so no paid
 * revision could be checked out at all. The milestone is on the transaction row
 * the order id keys, and settleRevision reads it from there.
 */
type OrderRef = { kind: 'brd' | 'prd' | 'escrow' | 'revision' | 'unknown' }

export function parseOrderRef(orderId: string): OrderRef {
  if (orderId.startsWith('BRD-')) return { kind: 'brd' }
  if (orderId.startsWith('PRD-')) return { kind: 'prd' }
  if (orderId.startsWith('ESC-')) return { kind: 'escrow' }
  // Matches both the minted `REV-{base36}-{base36}` and the older
  // `REV-{uuid}-{ts}-{rand}`, so orders placed before the change still settle.
  if (orderId.startsWith('REV-')) return { kind: 'revision' }

  return { kind: 'unknown' }
}
