import { TALENT_SUBJECTS } from '@kerjacus/nats-events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ABANDON_PENALTY_DELTA, type OutboxPublisher, PenaltyService } from './penalty.service'

function createMockRepo() {
  return {
    findInactiveTalents: vi.fn(),
    findRecentAbandons: vi.fn(),
    incrementPemerataanPenalty: vi.fn().mockResolvedValue(undefined),
  }
}

function createMockPublisher(): OutboxPublisher & { publish: ReturnType<typeof vi.fn> } {
  return {
    publish: vi.fn().mockResolvedValue(undefined),
  }
}

describe('PenaltyService', () => {
  describe('processInactiveTalents', () => {
    let repo: ReturnType<typeof createMockRepo>
    let publisher: ReturnType<typeof createMockPublisher>
    let service: PenaltyService

    beforeEach(() => {
      repo = createMockRepo()
      publisher = createMockPublisher()
      service = new PenaltyService(repo, publisher)
    })

    it('returns 0 when no inactive talents found', async () => {
      repo.findInactiveTalents.mockResolvedValue([])
      const count = await service.processInactiveTalents(7)
      expect(count).toBe(0)
      expect(publisher.publish).not.toHaveBeenCalled()
    })

    it('publishes one inactive_warning event per talent', async () => {
      const lastActivity = new Date('2026-05-10T00:00:00Z')
      repo.findInactiveTalents.mockResolvedValue([
        { talentId: 't1', projectId: 'p1', assignmentId: 'a1', lastActivity },
        { talentId: 't2', projectId: 'p2', assignmentId: 'a2', lastActivity },
      ])

      const count = await service.processInactiveTalents(7)

      expect(count).toBe(2)
      expect(publisher.publish).toHaveBeenCalledTimes(2)
      expect(publisher.publish).toHaveBeenNthCalledWith(1, {
        aggregateType: 'talent',
        aggregateId: 't1',
        eventType: TALENT_SUBJECTS.INACTIVE_WARNING,
        payload: {
          talentId: 't1',
          projectId: 'p1',
          assignmentId: 'a1',
          lastActivity: lastActivity.toISOString(),
        },
      })
    })

    it('passes days argument to repository', async () => {
      repo.findInactiveTalents.mockResolvedValue([])
      await service.processInactiveTalents(14)
      expect(repo.findInactiveTalents).toHaveBeenCalledWith(14)
    })

    it('defaults to 7 days when no argument given', async () => {
      repo.findInactiveTalents.mockResolvedValue([])
      await service.processInactiveTalents()
      expect(repo.findInactiveTalents).toHaveBeenCalledWith(7)
    })
  })

  describe('processAbandons', () => {
    let repo: ReturnType<typeof createMockRepo>
    let publisher: ReturnType<typeof createMockPublisher>
    let service: PenaltyService

    beforeEach(() => {
      repo = createMockRepo()
      publisher = createMockPublisher()
      service = new PenaltyService(repo, publisher)
    })

    it('returns 0 when no recent abandons found', async () => {
      repo.findRecentAbandons.mockResolvedValue([])
      const count = await service.processAbandons(24)
      expect(count).toBe(0)
      expect(repo.incrementPemerataanPenalty).not.toHaveBeenCalled()
      expect(publisher.publish).not.toHaveBeenCalled()
    })

    it('applies penalty of 0.5 per abandoned talent', async () => {
      repo.findRecentAbandons.mockResolvedValue([
        { talentId: 't1', assignmentId: 'a1' },
        { talentId: 't2', assignmentId: 'a2' },
        { talentId: 't3', assignmentId: 'a3' },
      ])

      const count = await service.processAbandons(24)

      expect(count).toBe(3)
      expect(repo.incrementPemerataanPenalty).toHaveBeenCalledTimes(3)
      expect(repo.incrementPemerataanPenalty).toHaveBeenNthCalledWith(1, 't1', 0.5)
      expect(repo.incrementPemerataanPenalty).toHaveBeenNthCalledWith(2, 't2', 0.5)
      expect(repo.incrementPemerataanPenalty).toHaveBeenNthCalledWith(3, 't3', 0.5)
    })

    it('uses ABANDON_PENALTY_DELTA constant', () => {
      expect(ABANDON_PENALTY_DELTA).toBe(0.5)
    })

    it('emits abandon_penalized event per talent', async () => {
      repo.findRecentAbandons.mockResolvedValue([{ talentId: 't1', assignmentId: 'a1' }])

      await service.processAbandons(24)

      expect(publisher.publish).toHaveBeenCalledWith({
        aggregateType: 'talent',
        aggregateId: 't1',
        eventType: TALENT_SUBJECTS.ABANDON_PENALIZED,
        payload: {
          talentId: 't1',
          assignmentId: 'a1',
          penaltyDelta: 0.5,
        },
      })
    })

    it('passes hoursAgo argument to repository', async () => {
      repo.findRecentAbandons.mockResolvedValue([])
      await service.processAbandons(48)
      expect(repo.findRecentAbandons).toHaveBeenCalledWith(48)
    })

    it('defaults to 24 hours when no argument given', async () => {
      repo.findRecentAbandons.mockResolvedValue([])
      await service.processAbandons()
      expect(repo.findRecentAbandons).toHaveBeenCalledWith(24)
    })
  })
})
