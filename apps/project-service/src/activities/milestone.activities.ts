import { getDb, milestones } from '@kerjacus/db'
import { MILESTONE_SUBJECTS } from '@kerjacus/nats-events'
import { and, eq } from 'drizzle-orm'
import { appendOutboxEvent } from '../lib/outbox'

/** Check whether a milestone has already moved past 'submitted'. */
export async function checkMilestoneReleased(
  milestoneId: string,
): Promise<{ alreadyReleased: boolean; status: string | null }> {
  const db = getDb()
  const [row] = await db
    .select({ status: milestones.status })
    .from(milestones)
    .where(eq(milestones.id, milestoneId))
    .limit(1)

  if (!row) return { alreadyReleased: true, status: null }
  return { alreadyReleased: row.status !== 'submitted', status: row.status }
}

/** Auto-approve a milestone (escrow release). Idempotent: only acts if still 'submitted'. */
export async function releaseEscrow(milestoneId: string): Promise<{ released: boolean }> {
  const db = getDb()
  return await db.transaction(async (tx) => {
    const result = await tx
      .update(milestones)
      .set({ status: 'approved', completedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(milestones.id, milestoneId), eq(milestones.status, 'submitted')))
      .returning({ id: milestones.id, projectId: milestones.projectId })

    if (result.length === 0) return { released: false }

    const ms = result[0]
    await appendOutboxEvent(tx, {
      aggregateType: 'milestone',
      aggregateId: ms.id,
      eventType: MILESTONE_SUBJECTS.APPROVED,
      payload: {
        milestoneId: ms.id,
        projectId: ms.projectId,
        status: 'approved',
        source: 'temporal_auto_release',
      },
    })
    return { released: true }
  })
}

/** Emit a notification outbox event for auto-release. */
export async function notifyAutoRelease(milestoneId: string): Promise<void> {
  await appendOutboxEvent(getDb(), {
    aggregateType: 'milestone',
    aggregateId: milestoneId,
    eventType: 'milestone.auto_released',
    payload: { milestoneId, source: 'temporal' },
  })
}
