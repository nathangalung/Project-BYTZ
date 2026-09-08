import { createLogger } from '@kerjacus/logger'
import { PROJECT_DECISION_DEADLINE_DAYS } from '@kerjacus/shared'
import { withAdvisoryLease } from '../lib/advisory-lease'
import type { ProjectRepository } from '../repositories/project.repository'

const logger = createLogger('project-service:project-decision-sweep')

const DAY_MS = 24 * 60 * 60 * 1000

// Bounds the work per run; the rest waits an hour.
const SWEEP_BATCH_LIMIT = 100

// Fixed so every replica derives the same lease key.
const PROJECT_DECISION_SWEEP_LOCK_KEY = 774_113_006

type SweepResult = { reminded: number; failed: number }

/**
 * Remind an owner whose approved PRD is still waiting on them.
 *
 * This is the owner-late-payment case that happens before any money is held.
 * The start sweep only sees projects past matched, and a project only reaches
 * matched after escrow settles, so an owner who approves the PRD and never
 * checks out falls through every other watch the platform has.
 *
 * It reminds; it does not cancel. Nothing is at stake for anyone else here, so
 * closing the project would take away a choice the owner still holds.
 */
export class ProjectDecisionSweepService {
  constructor(
    private projectRepo: Pick<ProjectRepository, 'findStalledDecision' | 'claimDecisionReminder'>,
  ) {}

  async sweep(now = new Date()): Promise<SweepResult> {
    const cutoff = new Date(now.getTime() - PROJECT_DECISION_DEADLINE_DAYS * DAY_MS)
    const stalled = await this.projectRepo.findStalledDecision(cutoff, SWEEP_BATCH_LIMIT)

    let reminded = 0
    let failed = 0

    for (const project of stalled) {
      try {
        const claimed = await this.projectRepo.claimDecisionReminder(
          { projectId: project.id, ownerId: project.ownerId },
          now,
        )
        if (claimed) reminded++
      } catch (err) {
        failed++
        logger.error({ err, projectId: project.id }, 'project decision reminder failed')
      }
    }

    return { reminded, failed }
  }
}

/** Sweep under the shared lease so exactly one replica runs it. Null when another holds it. */
export async function runProjectDecisionSweep(
  service: Pick<ProjectDecisionSweepService, 'sweep'>,
): Promise<SweepResult | null> {
  return await withAdvisoryLease(PROJECT_DECISION_SWEEP_LOCK_KEY, () => service.sweep())
}
