import { getDb } from '@kerjacus/db'
import { TALENT_INACTIVITY_WARNING_DAYS } from '@kerjacus/shared'
import { appendOutboxEvent } from '../lib/outbox'
import { MatchingRepository } from '../repositories/matching.repository'
import { type OutboxPublisher, PenaltyService } from './penalty.service'

// NOTE: Milestone auto-release (14-day timer) is now handled by the Temporal
// workflow `milestoneAutoReleaseWorkflow`, started from the milestones route
// when a milestone transitions to 'submitted'. The previous inline interval
// has been removed to avoid double-processing.

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

export function startScheduledJobs() {
  const HOUR = 60 * 60 * 1000
  const SIX_HOURS = 6 * HOUR

  const matchingRepo = new MatchingRepository(getDb())
  const penaltyService = new PenaltyService(matchingRepo, createDbOutboxPublisher())

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

  penaltyIntervalId = setInterval(runPenaltyJobs, SIX_HOURS)

  // Initial run after 30s so service boot has time to settle.
  setTimeout(async () => {
    await runPenaltyJobs()
  }, 30_000)

  console.log('[Scheduler] Started (penalty every 6h; auto-release handled by Temporal)')
}

export function stopScheduledJobs() {
  if (penaltyIntervalId) {
    clearInterval(penaltyIntervalId)
    penaltyIntervalId = null
  }
}
