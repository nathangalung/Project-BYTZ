import { env } from './env'
import { withServiceAuth } from './service-auth'

export type ReleaseMilestoneEscrowInput = {
  milestoneId: string
  projectId: string
  talentId: string
  amount: number
  performedBy: string
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
  const res = await fetch(`${env.PAYMENT_SERVICE_URL}/api/v1/payments/release`, {
    method: 'POST',
    headers: withServiceAuth({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      milestoneId: input.milestoneId,
      projectId: input.projectId,
      talentId: input.talentId,
      amount: input.amount,
      performedBy: input.performedBy,
      idempotencyKey: `release:${input.milestoneId}`,
    }),
  })

  if (!res.ok) {
    let detail = ''
    try {
      const body = (await res.json()) as { error?: { message?: string } }
      detail = body?.error?.message ?? ''
    } catch {
      // Non-JSON error body, status alone has to do.
    }
    throw new Error(`payment release failed (${res.status})${detail ? `: ${detail}` : ''}`)
  }
}
