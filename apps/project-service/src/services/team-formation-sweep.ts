import { createLogger } from '@kerjacus/logger'
import { withAdvisoryLease } from '../lib/advisory-lease'

const logger = createLogger('project-service:team-formation-sweep')

// Bounds the work per run and how long the lease transaction stays open.
const SWEEP_BATCH_LIMIT = 100

// Fixed so every replica derives the same lease key.
const TEAM_FORMATION_SWEEP_LOCK_KEY = 774_113_002

type SweepResult = { started: number; skipped: number; failed: number }

/**
 * Start the escalation workflow for projects stuck in team formation.
 *
 * `startTeamFormationWorkflow` fires on the transition edge only, and it is
 * fire-and-forget: a project that entered team_forming while Temporal was
 * unreachable, or before the call site existed, never gets a timer and so
 * never escalates. Production showed exactly that -- one project held
 * team_forming for 46 days against a 14-day deadline with no workflow in the
 * namespace at all.
 *
 * Same shape as the auto-release sweep: the workflow is the primary timer and
 * this reconciles the ones that were never started.
 */
export class TeamFormationSweepService {
  constructor(
    private findStalled: (limit: number) => Promise<{ id: string }[]>,
    private hasWorkflow: (projectId: string) => Promise<boolean | null>,
    private startWorkflow: (projectId: string) => Promise<void>,
  ) {}

  async sweep(): Promise<SweepResult> {
    const stalled = await this.findStalled(SWEEP_BATCH_LIMIT)

    let started = 0
    let skipped = 0
    let failed = 0

    for (const project of stalled) {
      try {
        const exists = await this.hasWorkflow(project.id)
        // null means Temporal could not answer. Starting on an unknown would
        // re-run a workflow that already closed and escalate the same project
        // twice; the next sweep retries once the answer is knowable.
        if (exists === true || exists === null) {
          skipped++
          continue
        }
        await this.startWorkflow(project.id)
        started++
      } catch (err) {
        failed++
        logger.error({ err, projectId: project.id }, 'team formation sweep failed for project')
      }
    }

    return { started, skipped, failed }
  }
}

/** Sweep under the shared lease so exactly one replica runs it. Null when another holds it. */
export async function runTeamFormationSweep(
  service: Pick<TeamFormationSweepService, 'sweep'>,
): Promise<SweepResult | null> {
  return await withAdvisoryLease(TEAM_FORMATION_SWEEP_LOCK_KEY, () => service.sweep())
}
