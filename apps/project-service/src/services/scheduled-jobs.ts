import { getDb } from '@kerjacus/db'
import { TALENT_INACTIVITY_WARNING_DAYS } from '@kerjacus/shared'
import { notifyAutoRelease, releaseEscrow } from '../activities/milestone.activities'
import { appendOutboxEvent } from '../lib/outbox'
import { settleMilestoneEscrow } from '../lib/settle-milestone'
import { MatchingRepository } from '../repositories/matching.repository'
import { MilestoneRepository } from '../repositories/milestone.repository'
import { AutoReleaseSweepService, runAutoReleaseSweep } from './auto-release-sweep'
import { runEmbeddingBackfill } from './embedding-backfill'
import { type OutboxPublisher, PenaltyService } from './penalty.service'

// NOTE: Milestone auto-release (14-day timer) is driven by the Temporal workflow
// `milestoneAutoReleaseWorkflow`, started from the milestones route when a
// milestone transitions to 'submitted'. The sweep below only reconciles
// milestones whose workflow was never started or died -- it shares the same
// compare-and-swap release, so it cannot double-process a live workflow.

// Outbox publisher backed by direct DB insert into outbox_events.
function createDbOutboxPublisher(): OutboxPublisher {
  return {
    async publish(event) {
      await appendOutboxEvent(getDb(), {
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        eventType: event.eventType,
        payload: event.payload,
      })
    },
  }
}

let penaltyIntervalId: ReturnType<typeof setInterval> | null = null
let autoReleaseIntervalId: ReturnType<typeof setInterval> | null = null
let embeddingBackfillIntervalId: ReturnType<typeof setInterval> | null = null

export function startScheduledJobs() {
  const HOUR = 60 * 60 * 1000
  const SIX_HOURS = 6 * HOUR

  const matchingRepo = new MatchingRepository(getDb())
  const penaltyService = new PenaltyService(matchingRepo, createDbOutboxPublisher())
  const sweepService = new AutoReleaseSweepService(
    new MilestoneRepository(getDb()),
    settleMilestoneEscrow,
    releaseEscrow,
    notifyAutoRelease,
  )

  const runPenaltyJobs = async () => {
    try {
      const inactiveCount = await penaltyService.processInactiveTalents(
        TALENT_INACTIVITY_WARNING_DAYS,
      )
      if (inactiveCount > 0) {
        console.log(`[Scheduler] Issued ${inactiveCount} inactivity warning(s)`)
      }
    } catch (err) {
      console.error('[Scheduler] Inactive talent scan failed:', err)
    }
    try {
      const abandonCount = await penaltyService.processAbandons(6)
      if (abandonCount > 0) {
        console.log(`[Scheduler] Penalized ${abandonCount} abandoned assignment(s)`)
      }
    } catch (err) {
      console.error('[Scheduler] Abandon penalty job failed:', err)
    }
  }

  const runAutoReleaseJob = async () => {
    try {
      const result = await runAutoReleaseSweep(sweepService)
      // null means another replica holds the lease; not an error.
      if (result && (result.settled > 0 || result.failed > 0)) {
        console.log(
          `[Scheduler] Auto-release sweep settled ${result.settled}, failed ${result.failed}`,
        )
      }
    } catch (err) {
      console.error('[Scheduler] Auto-release sweep failed:', err)
    }
  }

  const runEmbeddingBackfillJob = async () => {
    try {
      const { brd, prd } = await runEmbeddingBackfill()
      if (brd > 0 || prd > 0) {
        console.log(`[Scheduler] Re-requested embeddings for ${brd} BRD, ${prd} PRD`)
      }
    } catch (err) {
      console.error('[Scheduler] Embedding backfill failed:', err)
    }
  }

  penaltyIntervalId = setInterval(runPenaltyJobs, SIX_HOURS)
  autoReleaseIntervalId = setInterval(runAutoReleaseJob, HOUR)
  embeddingBackfillIntervalId = setInterval(runEmbeddingBackfillJob, SIX_HOURS)

  // Initial run after 30s so service boot has time to settle.
  setTimeout(async () => {
    await runPenaltyJobs()
    await runAutoReleaseJob()
    await runEmbeddingBackfillJob()
  }, 30_000)

  console.log(
    '[Scheduler] Started (penalty every 6h; auto-release sweep every 1h; embedding backfill every 6h)',
  )
}

export function stopScheduledJobs() {
  if (penaltyIntervalId) {
    clearInterval(penaltyIntervalId)
    penaltyIntervalId = null
  }
  if (autoReleaseIntervalId) {
    clearInterval(autoReleaseIntervalId)
    autoReleaseIntervalId = null
  }
  if (embeddingBackfillIntervalId) {
    clearInterval(embeddingBackfillIntervalId)
    embeddingBackfillIntervalId = null
  }
}
