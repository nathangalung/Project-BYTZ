import { createLogger } from '@kerjacus/logger'
import { MILESTONE_DUE_SOON_DAYS } from '@kerjacus/shared'
import { withAdvisoryLease } from '../lib/advisory-lease'
import type { MilestoneRepository } from '../repositories/milestone.repository'

const logger = createLogger('project-service:milestone-deadline-sweep')

const DAY_MS = 24 * 60 * 60 * 1000

// Bounds the work per run and the open transaction; the rest waits an hour.
const SWEEP_BATCH_LIMIT = 100

// Fixed, because every replica must derive the same key for the lease to be
// shared. Next in the same series as the other sweeps.
const DEADLINE_SWEEP_LOCK_KEY = 774_113_004

type SweepResult = { dueSoon: number; overdue: number; failed: number }

/**
 * Warn about milestone deadlines that nothing was watching.
 *
 * milestone.overdue and milestone.due_soon had a consumer, notification
 * templates and a catalog row, and no publisher anywhere. due_date was written
 * at creation and read only to score a talent's on-time rate after the fact, so
 * a talent who missed a deadline was told nothing and the owner learned about
 * it by looking. The grace period this document promises before an owner may
 * dispute a late milestone had nothing marking when it started.
 *
 * A sweep rather than a Temporal timer: a due date is a property of the row and
 * can be edited, so asking the table what is late now is correct where a timer
 * scheduled at creation would fire against a date that has since moved.
 */
export class MilestoneDeadlineSweepService {
  constructor(
    private milestoneRepo: Pick<
      MilestoneRepository,
      'findMilestonesNeedingDeadlineNotice' | 'claimDeadlineNotice'
    >,
  ) {}

  async sweep(now = new Date()): Promise<SweepResult> {
    const horizon = new Date(now.getTime() + MILESTONE_DUE_SOON_DAYS * DAY_MS)
    const result: SweepResult = { dueSoon: 0, overdue: 0, failed: 0 }

    // The two windows are disjoint - past due, and due inside the horizon -
    // and each carries its own marker, so a milestone warned about last week
    // is still reported once it actually goes late.
    for (const kind of ['overdue', 'due_soon'] as const) {
      const due = await this.milestoneRepo.findMilestonesNeedingDeadlineNotice(
        kind,
        now,
        horizon,
        SWEEP_BATCH_LIMIT,
      )

      for (const milestone of due) {
        try {
          const claimed = await this.milestoneRepo.claimDeadlineNotice(
            {
              milestoneId: milestone.id,
              projectId: milestone.projectId,
              talentUserId: milestone.talentUserId,
            },
            kind,
            now,
          )
          if (!claimed) continue
          if (kind === 'overdue') result.overdue++
          else result.dueSoon++
        } catch (err) {
          result.failed++
          logger.error({ err, milestoneId: milestone.id, kind }, 'deadline notice failed')
        }
      }
    }

    return result
  }
}

/** Sweep under the shared lease so exactly one replica runs it. Null when another holds it. */
export async function runMilestoneDeadlineSweep(
  service: Pick<MilestoneDeadlineSweepService, 'sweep'>,
): Promise<SweepResult | null> {
  return await withAdvisoryLease(DEADLINE_SWEEP_LOCK_KEY, () => service.sweep())
}
