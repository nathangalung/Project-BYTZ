import { getDb, milestones, projects, workPackages } from '@kerjacus/db'
import { createLogger } from '@kerjacus/logger'
import { eq } from 'drizzle-orm'
import { releaseMilestoneEscrow } from './payment-client'

const logger = createLogger('project-service:settle-milestone')

/**
 * Platform fee slice of a gross milestone amount.
 *
 * The ratio comes from the milestone's work package (talent_payout / amount),
 * falling back to the project totals when the milestone has no package. A
 * ratio that would take the whole milestone or go negative means corrupted
 * pricing data; the talent is paid in full and the anomaly is logged rather
 * than silently over-charging them.
 */
export async function computeMilestoneFee(milestone: {
  amount: number
  workPackageId: string | null
  projectId: string
}): Promise<number> {
  const db = getDb()

  let payout: number | null = null
  let gross: number | null = null

  if (milestone.workPackageId) {
    const [wp] = await db
      .select({ amount: workPackages.amount, talentPayout: workPackages.talentPayout })
      .from(workPackages)
      .where(eq(workPackages.id, milestone.workPackageId))
      .limit(1)
    if (wp) {
      payout = wp.talentPayout
      gross = wp.amount
    }
  }
  if (gross === null || gross <= 0) {
    const [proj] = await db
      .select({ finalPrice: projects.finalPrice, talentPayout: projects.talentPayout })
      .from(projects)
      .where(eq(projects.id, milestone.projectId))
      .limit(1)
    if (proj?.finalPrice && proj.talentPayout !== null) {
      payout = proj.talentPayout
      gross = proj.finalPrice
    }
  }

  if (gross === null || gross <= 0 || payout === null) return 0

  const talentShare = Math.round((milestone.amount * payout) / gross)
  const fee = milestone.amount - talentShare
  if (fee < 0 || fee >= milestone.amount) {
    logger.warn(
      { projectId: milestone.projectId, gross, payout, fee },
      'implausible fee ratio, paying talent in full',
    )
    return 0
  }
  return fee
}

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
      workPackageId: milestones.workPackageId,
      amount: milestones.amount,
      status: milestones.status,
    })
    .from(milestones)
    .where(eq(milestones.id, milestoneId))
    .limit(1)

  if (!ms) return { paid: false }
  if (ms.status !== 'approved') return { paid: false }
  if (!ms.talentId || ms.amount <= 0) return { paid: false }

  const feeAmount = await computeMilestoneFee(ms)

  await releaseMilestoneEscrow({
    milestoneId,
    projectId: ms.projectId,
    talentId: ms.talentId,
    amount: ms.amount,
    feeAmount,
    performedBy,
  })
  return { paid: true }
}
