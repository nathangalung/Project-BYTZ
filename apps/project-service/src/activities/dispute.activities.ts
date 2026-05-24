import { disputes, getDb } from '@kerjacus/db'
import { eq } from 'drizzle-orm'
import { appendOutboxEvent } from '../lib/outbox'

export type DisputePhase = 'direct' | 'mediation' | 'binding'

/** Move dispute to next admin phase. Idempotent: only acts if dispute still open. */
export async function advanceDisputePhase(disputeId: string, phase: DisputePhase): Promise<void> {
  const db = getDb()
  const next =
    phase === 'direct' ? 'under_review' : phase === 'mediation' ? 'mediation' : 'escalated'

  await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ status: disputes.status })
      .from(disputes)
      .where(eq(disputes.id, disputeId))
      .limit(1)
    if (!current || current.status === 'resolved') return

    await tx
      .update(disputes)
      .set({ status: next, updatedAt: new Date() })
      .where(eq(disputes.id, disputeId))

    await appendOutboxEvent(tx, {
      aggregateType: 'dispute',
      aggregateId: disputeId,
      eventType: `dispute.phase.${phase}`,
      payload: { disputeId, phase, source: 'temporal' },
    })
  })
}

/** Check if dispute has been resolved by a human admin. */
export async function isDisputeResolved(disputeId: string): Promise<boolean> {
  const db = getDb()
  const [row] = await db
    .select({ status: disputes.status })
    .from(disputes)
    .where(eq(disputes.id, disputeId))
    .limit(1)
  return row?.status === 'resolved'
}
