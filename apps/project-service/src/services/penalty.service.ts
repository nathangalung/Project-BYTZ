import { TALENT_SUBJECTS } from '@kerjacus/nats-events'
import type { MatchingRepository } from '../repositories/matching.repository'

// Penalty applied per terminated assignment (abandon).
export const ABANDON_PENALTY_DELTA = 0.5

// Minimal outbox-publish interface so we can inject either the inline
// insert-into-outbox_events helper or a typed publisher in tests.
export interface OutboxPublisher {
  publish(event: {
    aggregateType: string
    aggregateId: string
    eventType: string
    payload: Record<string, unknown>
  }): Promise<void>
}

export class PenaltyService {
  constructor(
    private matchingRepo: Pick<
      MatchingRepository,
      'findInactiveTalents' | 'findRecentAbandons' | 'incrementPemerataanPenalty'
    >,
    private outbox: OutboxPublisher,
  ) {}

  // Emit inactive-warning events for talents idle for >= `days` days.
  async processInactiveTalents(days = 7): Promise<number> {
    const inactive = await this.matchingRepo.findInactiveTalents(days)
    for (const item of inactive) {
      await this.outbox.publish({
        aggregateType: 'talent',
        aggregateId: item.talentId,
        eventType: TALENT_SUBJECTS.INACTIVE_WARNING,
        payload: {
          talentId: item.talentId,
          projectId: item.projectId,
          assignmentId: item.assignmentId,
          lastActivity: item.lastActivity.toISOString(),
        },
      })
    }
    return inactive.length
  }

  // Apply pemerataan penalty for recently-terminated assignments and emit event.
  async processAbandons(hoursAgo = 24): Promise<number> {
    const abandoned = await this.matchingRepo.findRecentAbandons(hoursAgo)
    for (const item of abandoned) {
      await this.matchingRepo.incrementPemerataanPenalty(item.talentId, ABANDON_PENALTY_DELTA)
      await this.outbox.publish({
        aggregateType: 'talent',
        aggregateId: item.talentId,
        eventType: TALENT_SUBJECTS.ABANDON_PENALIZED,
        payload: {
          talentId: item.talentId,
          assignmentId: item.assignmentId,
          penaltyDelta: ABANDON_PENALTY_DELTA,
        },
      })
    }
    return abandoned.length
  }
}
