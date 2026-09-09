import { createLogger } from '@kerjacus/logger'
import { withAdvisoryLease } from '../lib/advisory-lease'

const logger = createLogger('project-service:ai-health-sweep')

/** How far back each run looks. */
export const AI_HEALTH_WINDOW_MS = 60 * 60 * 1000

// Below this many failures in an hour it is noise, not an outage.
const MIN_FAILURES = 10

// Above this share of the window failing, something is wrong upstream.
const FAILURE_RATIO = 0.5

const AI_HEALTH_SWEEP_LOCK_KEY = 774_113_003

type Counts = { success: number; error: number }
type SweepResult = { alerted: number; errorCount: number; successCount: number }

/**
 * Tell the admins when the AI layer stops working.
 *
 * The platform ran with an expired provider key and nobody found out from the
 * system. Scoping, BRD and PRD generation, CV parsing and embeddings were all
 * dead, every scheduled embedding pass logged a failure into console.error and
 * an ai_interactions row every six hours, and no alert reads either. It was
 * found by opening the site.
 *
 * A total outage is worth repeating hourly while it lasts, so there is no
 * cooldown: the previous failure mode was silence, not noise.
 */
export class AiHealthSweepService {
  constructor(
    private readCounts: (since: Date) => Promise<Counts>,
    private listAdmins: () => Promise<string[]>,
    // The wording lives in the notification catalog, not here: this alert is
    // read by a person whose language the sweep does not know.
    private notify: (userId: string, params: { errors: number; total: number }) => Promise<void>,
  ) {}

  async sweep(now = new Date()): Promise<SweepResult> {
    const since = new Date(now.getTime() - AI_HEALTH_WINDOW_MS)
    const { success, error } = await this.readCounts(since)

    const total = success + error
    const degraded = error >= MIN_FAILURES && total > 0 && error / total >= FAILURE_RATIO
    if (!degraded) return { alerted: 0, errorCount: error, successCount: success }

    const admins = await this.listAdmins()

    let alerted = 0
    for (const adminId of admins) {
      try {
        await this.notify(adminId, { errors: error, total })
        alerted++
      } catch (err) {
        logger.error({ err, adminId }, 'ai health alert failed for admin')
      }
    }

    return { alerted, errorCount: error, successCount: success }
  }
}

/** Sweep under the shared lease so only one replica alerts. Null when another holds it. */
export async function runAiHealthSweep(
  service: Pick<AiHealthSweepService, 'sweep'>,
): Promise<SweepResult | null> {
  return await withAdvisoryLease(AI_HEALTH_SWEEP_LOCK_KEY, () => service.sweep())
}
