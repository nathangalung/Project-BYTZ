import { createLogger } from '@kerjacus/logger'
import { AUTO_RELEASE_DAYS } from '@kerjacus/shared'
import { withAdvisoryLease } from '../lib/advisory-lease'
import type { MilestoneRepository } from '../repositories/milestone.repository'

const logger = createLogger('project-service:auto-release-sweep')

const DAY_MS = 24 * 60 * 60 * 1000

// Bounds both the work per run and how long the lease transaction stays open.
// Whatever is left over is picked up by the next run.
const SWEEP_BATCH_LIMIT = 100

// Arbitrary but fixed: every replica must derive the same key or the lease is
// not shared. Changing it re-opens the double-sweep window during a rollout.
const AUTO_RELEASE_SWEEP_LOCK_KEY = 774_113_001

type SweepResult = { settled: number; failed: number }

/**
 * Settle milestones whose 14-day review window expired without anyone acting.
 *
 * The Temporal auto-release workflow is the primary timer; this is the
 * reconciliation pass for milestones whose workflow was never started (Temporal
 * unreachable at submit time) or died. Both paths flip the status with a
 * compare-and-swap on 'submitted' and pay through the milestone-keyed
 * idempotent release, so the two can overlap without paying twice.
 */
export class AutoReleaseSweepService {
  constructor(
    private milestoneRepo: Pick<MilestoneRepository, 'findOverdueSubmitted'>,
    private settleEscrow: (
      milestoneId: string,
      performedBy: string,
      expectedStatus: 'submitted',
    ) => Promise<{ paid: boolean }>,
    private releaseEscrow: (milestoneId: string) => Promise<{ released: boolean }>,
    private notifyAutoRelease: (milestoneId: string) => Promise<void>,
  ) {}

  async sweep(now = new Date()): Promise<SweepResult> {
    const cutoff = new Date(now.getTime() - AUTO_RELEASE_DAYS * DAY_MS)
    const due = await this.milestoneRepo.findOverdueSubmitted(cutoff, SWEEP_BATCH_LIMIT)

    let settled = 0
    let failed = 0

    // Per milestone, so one bad payout does not strand the rest of the batch.
    // A failure leaves the row in 'submitted' and the next run retries it.
    for (const milestone of due) {
      try {
        // Pay before approving, same order as the owner-approve path. The
        // release refuses a milestone priced above its work package, and
        // `releaseEscrow` commits the approval before it pays -- settling here
        // first keeps that refusal from leaving a stale-priced milestone marked
        // approved, announced to the talent, and never paid.
        await this.settleEscrow(milestone.id, 'system:auto_release', 'submitted')

        const { released } = await this.releaseEscrow(milestone.id)
        if (!released) continue
        // Only the run that won the status flip announces; the payout is
        // idempotent but a second notification would tell the talent twice.
        await this.notifyAutoRelease(milestone.id)
        settled++
      } catch (err) {
        failed++
        logger.error({ err, milestoneId: milestone.id }, 'auto-release sweep failed for milestone')
      }
    }

    return { settled, failed }
  }
}

/** Sweep under the shared lease so exactly one replica runs it. Null when another holds it. */
export async function runAutoReleaseSweep(
  service: Pick<AutoReleaseSweepService, 'sweep'>,
): Promise<SweepResult | null> {
  return await withAdvisoryLease(AUTO_RELEASE_SWEEP_LOCK_KEY, () => service.sweep())
}
