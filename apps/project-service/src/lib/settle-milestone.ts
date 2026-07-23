import { getDb, milestones } from '@kerjacus/db'
import { eq } from 'drizzle-orm'
import { releaseMilestoneEscrow } from './payment-client'

/**
 * Pay an approved milestone's talent from escrow. Idempotent by milestone, so
 * the owner-approve path and the 14 day auto-release can both call it - whoever
 * runs first pays, the other replays without moving money twice. Integration
 * milestones carry no single talent and settle per work package elsewhere.
 */
export async function settleMilestoneEscrow(
  milestoneId: string,
  performedBy: string,
): Promise<{ paid: boolean }> {
  const db = getDb()
  const [ms] = await db
    .select({
      projectId: milestones.projectId,
      talentId: milestones.assignedTalentId,
      amount: milestones.amount,
      status: milestones.status,
    })
    .from(milestones)
    .where(eq(milestones.id, milestoneId))
    .limit(1)

  if (!ms) return { paid: false }
  if (ms.status !== 'approved') return { paid: false }
  if (!ms.talentId || ms.amount <= 0) return { paid: false }

  await releaseMilestoneEscrow({
    milestoneId,
    projectId: ms.projectId,
    talentId: ms.talentId,
    amount: ms.amount,
    performedBy,
  })
  return { paid: true }
}
