import { env } from './env'
import { serviceFetch, TIMEOUT_MS } from './http/service-fetch'

export type ReleaseMilestoneEscrowInput = {
  milestoneId: string
  projectId: string
  talentId: string
  amount: number
  feeAmount: number
  performedBy: string
}

export type RefundEscrowInput = {
  originalTransactionId: string
  amount: number
  reason: string
  ownerId: string
  performedBy: string
  idempotencyKey: string
}

/**
 * Move escrow money back to the owner via the payment service.
 *
 * Dispute resolutions of funds_to_owner/split promised a refund but nothing
 * ever called the refund endpoint, so no money moved. The idempotency key is
 * caller-chosen (dispute id) so a retried resolution replays safely - which is
 * what makes retrying transient faults safe here.
 */
export async function refundEscrow(input: RefundEscrowInput): Promise<void> {
  await serviceFetch(
    `${env.PAYMENT_SERVICE_URL}/api/v1/payments/refund`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
    { service: 'payment-service', timeoutMs: TIMEOUT_MS.payment, retryTransient: true },
  )
}

/**
 * Pay an approved milestone from escrow.
 *
 * The talent is anonymous to the owner, so the browser cannot call the payment
 * service directly - it does not know the talent id or the escrow amount. This
 * runs server side where both are known, on the owner-approve path and on the
 * 14 day auto-release. The idempotency key is the milestone, so whichever fires
 * first wins and the other replays without paying twice.
 */
export async function releaseMilestoneEscrow(input: ReleaseMilestoneEscrowInput): Promise<void> {
  await serviceFetch(
    `${env.PAYMENT_SERVICE_URL}/api/v1/payments/release`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        milestoneId: input.milestoneId,
        projectId: input.projectId,
        talentId: input.talentId,
        amount: input.amount,
        feeAmount: input.feeAmount,
        performedBy: input.performedBy,
        idempotencyKey: `release:${input.milestoneId}`,
      }),
    },
    { service: 'payment-service', timeoutMs: TIMEOUT_MS.payment, retryTransient: true },
  )
}

/** Remaining escrow ledger balance for a project (0 when unfunded). */
export async function getEscrowBalance(projectId: string): Promise<number> {
  const res = await serviceFetch(
    `${env.PAYMENT_SERVICE_URL}/api/v1/payments/escrow-balance/${encodeURIComponent(projectId)}`,
    {},
    // A read, and not idempotency-keyed. Retrying only adds latency to a
    // request the caller is already waiting on, so breaker and deadline only.
    { service: 'payment-service', timeoutMs: TIMEOUT_MS.payment },
  )
  const body = (await res.json()) as { data?: { balance?: number } }
  return body.data?.balance ?? 0
}
