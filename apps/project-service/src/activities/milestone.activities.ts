import { getDb, milestones, talentProfiles } from '@kerjacus/db'
import { MILESTONE_SUBJECTS } from '@kerjacus/nats-events'
import { and, eq } from 'drizzle-orm'
import { appendOutboxEvent } from '../lib/outbox'
import { settleMilestoneEscrow } from '../lib/settle-milestone'

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

/** Auto-approve a milestone and pay the talent from escrow. Retry-safe. */
export async function releaseEscrow(milestoneId: string): Promise<{ released: boolean }> {
  const db = getDb()
  const flipped = await db.transaction(async (tx) => {
    const result = await tx
      .update(milestones)
      .set({ status: 'approved', completedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(milestones.id, milestoneId), eq(milestones.status, 'submitted')))
      .returning({ id: milestones.id, projectId: milestones.projectId })

    if (result.length === 0) return false

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
    return true
  })

  // Pay whether this attempt flipped the status or a prior one already did; the
  // payout is idempotent by milestone, so a Temporal retry after a failed
  // release does not double pay. Marking approved without paying was the bug:
  // the 14 day timer expired and the talent was never settled.
  await settleMilestoneEscrow(milestoneId, 'system:auto_release')

  return { released: flipped }
}

/** Emit a notification outbox event for auto-release. */
export async function notifyAutoRelease(milestoneId: string): Promise<void> {
  const db = getDb()

  // notifications.user_id references user, not talent_profiles.
  const [row] = await db
    .select({
      projectId: milestones.projectId,
      userId: talentProfiles.userId,
      amount: milestones.amount,
    })
    .from(milestones)
    .leftJoin(talentProfiles, eq(talentProfiles.id, milestones.assignedTalentId))
    .where(eq(milestones.id, milestoneId))
    .limit(1)

  await appendOutboxEvent(db, {
    aggregateType: 'milestone',
    aggregateId: milestoneId,
    eventType: 'milestone.auto_released',
    payload: {
      milestoneId,
      projectId: row?.projectId ?? null,
      talentId: row?.userId ?? null,
      amount: row?.amount ?? 0,
      source: 'temporal',
    },
  })
}
