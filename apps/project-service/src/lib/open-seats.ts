import { getDb, workPackages } from '@kerjacus/db'
import { inArray, sql } from 'drizzle-orm'

/**
 * Payout range of the seats a talent can still take, and how many are open.
 *
 * Both browse feeds used to advertise budget_min and budget_max, the range the
 * owner typed at intake before the AI priced anything. A project showing
 * "Rp 45-70 jt" held three work packages whose open seats paid Rp 8,34-12,04 jt,
 * so the number a talent decided on was several times the number on offer.
 *
 * Derived at read rather than stored, like pemerataan_skor and health_score:
 * work_packages already carries the split, and a copy would be a second truth.
 * Open means what it means on the apply path - unassigned or declined - because
 * this listing is what leads there. The project's own final_price, platform_fee
 * and talent_payout stay stripped by applyProjectVisibility; a seat quote does
 * not reveal the margin, which is exactly the fee framing the platform states.
 */
export function openSeatsSubquery() {
  return getDb()
    .select({
      projectId: workPackages.projectId,
      openPositions: sql<number>`count(*)::int`.as('open_positions'),
      payoutMin: sql<number>`min(${workPackages.talentPayout})::int`.as('payout_min'),
      payoutMax: sql<number>`max(${workPackages.talentPayout})::int`.as('payout_max'),
    })
    .from(workPackages)
    .where(inArray(workPackages.status, ['unassigned', 'declined']))
    .groupBy(workPackages.projectId)
    .as('open_seats')
}
