import { createLogger } from '@kerjacus/logger'
import { PROJECT_START_DEADLINE_DAYS } from '@kerjacus/shared'
import { withAdvisoryLease } from '../lib/advisory-lease'
import type { ProjectRepository } from '../repositories/project.repository'

const logger = createLogger('project-service:project-start-sweep')

const DAY_MS = 24 * 60 * 60 * 1000

// Bounds the work per run; the rest waits an hour.
const SWEEP_BATCH_LIMIT = 100

// Fixed so every replica derives the same lease key.
const PROJECT_START_SWEEP_LOCK_KEY = 774_113_005

type SweepResult = { warned: number; failed: number }

/**
 * Tell somebody when a paid, matched project never started.
 *
 * Escrow is funded before matching, so by this point the owner's money is
 * already held. The platform promises to cancel and refund after 30 days of
 * nothing happening, and nothing did that - the project simply sat there with
 * the money in it and no reminder to anyone.
 *
 * This warns; it does not cancel. Cancelling a project and returning an owner's
 * escrow with no human in the loop is a product decision, and it has not been
 * made. Warning is the half that is unambiguously correct, and it is what makes
 * the missing half visible instead of silent.
 */
export class ProjectStartSweepService {
  constructor(
    private projectRepo: Pick<ProjectRepository, 'findStalledStart' | 'claimStartReminder'>,
  ) {}

  async sweep(now = new Date()): Promise<SweepResult> {
    const cutoff = new Date(now.getTime() - PROJECT_START_DEADLINE_DAYS * DAY_MS)
    const stalled = await this.projectRepo.findStalledStart(cutoff, SWEEP_BATCH_LIMIT)

    let warned = 0
    let failed = 0

    for (const project of stalled) {
      try {
        const claimed = await this.projectRepo.claimStartReminder(
          { projectId: project.id, ownerId: project.ownerId },
          now,
        )
        if (claimed) warned++
      } catch (err) {
        failed++
        logger.error({ err, projectId: project.id }, 'project start reminder failed')
      }
    }

    return { warned, failed }
  }
}

/** Sweep under the shared lease so exactly one replica runs it. Null when another holds it. */
export async function runProjectStartSweep(
  service: Pick<ProjectStartSweepService, 'sweep'>,
): Promise<SweepResult | null> {
  return await withAdvisoryLease(PROJECT_START_SWEEP_LOCK_KEY, () => service.sweep())
}
