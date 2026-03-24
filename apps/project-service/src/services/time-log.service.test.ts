import { AppError } from '@kerjacus/shared'
import { describe, expect, it, vi } from 'vitest'
import { TimeLogService } from './time-log.service'

function createMockRepo(overrides: Record<string, unknown> = {}) {
  return {
    create: vi.fn(),
    findById: vi.fn(),
    findByProjectId: vi.fn(),
    findByTaskId: vi.fn(),
    findByTalentId: vi.fn(),
    stopTimer: vi.fn(),
    ...overrides,
  }
}

function makeTimeLog(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tl-001',
    taskId: 'task-001',
    talentId: 'talent-001',
    startedAt: new Date('2026-03-20T09:00:00Z'),
    endedAt: null,
    durationMinutes: null,
    description: null,
    createdAt: new Date(),
    ...overrides,
  }
}

describe('TimeLogService', () => {
  describe('createTimeLog', () => {
    it('creates a time log with only startedAt', async () => {
      const created = makeTimeLog()
      const repo = createMockRepo({ create: vi.fn().mockResolvedValue(created) })
      const service = new TimeLogService(repo as never)

      const result = await service.createTimeLog({
        taskId: 'task-001',
        talentId: 'talent-001',
        startedAt: '2026-03-20T09:00:00Z',
      })

      expect(result).toEqual(created)
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'task-001',
          talentId: 'talent-001',
          endedAt: null,
          durationMinutes: null,
        }),
      )
    })

    it('auto-calculates duration from startedAt and endedAt', async () => {
      const created = makeTimeLog({ durationMinutes: 120 })
      const repo = createMockRepo({ create: vi.fn().mockResolvedValue(created) })
      const service = new TimeLogService(repo as never)

      await service.createTimeLog({
        taskId: 'task-001',
        talentId: 'talent-001',
        startedAt: '2026-03-20T09:00:00Z',
        endedAt: '2026-03-20T11:00:00Z',
      })

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          durationMinutes: 120,
        }),
      )
    })

    it('uses explicit durationMinutes when provided', async () => {
      const created = makeTimeLog({ durationMinutes: 90 })
      const repo = createMockRepo({ create: vi.fn().mockResolvedValue(created) })
      const service = new TimeLogService(repo as never)

      await service.createTimeLog({
        taskId: 'task-001',
        talentId: 'talent-001',
        startedAt: '2026-03-20T09:00:00Z',
        endedAt: '2026-03-20T11:00:00Z',
        durationMinutes: 90,
      })

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          durationMinutes: 90,
        }),
      )
    })

    it('throws VALIDATION_ERROR when endedAt is before startedAt', async () => {
      const repo = createMockRepo()
      const service = new TimeLogService(repo as never)

      await expect(
        service.createTimeLog({
          taskId: 'task-001',
          talentId: 'talent-001',
          startedAt: '2026-03-20T11:00:00Z',
          endedAt: '2026-03-20T09:00:00Z',
        }),
      ).rejects.toThrow(AppError)

      await expect(
        service.createTimeLog({
          taskId: 'task-001',
          talentId: 'talent-001',
          startedAt: '2026-03-20T11:00:00Z',
          endedAt: '2026-03-20T09:00:00Z',
        }),
      ).rejects.toThrow('endedAt must be after startedAt')
    })

    it('throws VALIDATION_ERROR when endedAt equals startedAt', async () => {
      const repo = createMockRepo()
      const service = new TimeLogService(repo as never)

      await expect(
        service.createTimeLog({
          taskId: 'task-001',
          talentId: 'talent-001',
          startedAt: '2026-03-20T09:00:00Z',
          endedAt: '2026-03-20T09:00:00Z',
        }),
      ).rejects.toThrow('endedAt must be after startedAt')
    })

    it('passes description when provided', async () => {
      const repo = createMockRepo({ create: vi.fn().mockResolvedValue(makeTimeLog()) })
      const service = new TimeLogService(repo as never)

      await service.createTimeLog({
        taskId: 'task-001',
        talentId: 'talent-001',
        startedAt: '2026-03-20T09:00:00Z',
        description: 'Working on API endpoints',
      })

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'Working on API endpoints',
        }),
      )
    })

    it('defaults description to null when not provided', async () => {
      const repo = createMockRepo({ create: vi.fn().mockResolvedValue(makeTimeLog()) })
      const service = new TimeLogService(repo as never)

      await service.createTimeLog({
        taskId: 'task-001',
        talentId: 'talent-001',
        startedAt: '2026-03-20T09:00:00Z',
      })

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          description: null,
        }),
      )
    })
  })

  describe('stopTimer', () => {
    it('stops a running timer', async () => {
      const log = makeTimeLog({ endedAt: null })
      const stopped = makeTimeLog({ endedAt: new Date(), durationMinutes: 60 })
      const repo = createMockRepo({
        findById: vi.fn().mockResolvedValue(log),
        stopTimer: vi.fn().mockResolvedValue(stopped),
      })
      const service = new TimeLogService(repo as never)

      const result = await service.stopTimer('tl-001')
      expect(result).toBeDefined()
      expect(result?.endedAt).toBeDefined()
      expect(repo.stopTimer).toHaveBeenCalledWith('tl-001', expect.any(Date), expect.any(Number))
    })

    it('throws NOT_FOUND when time log does not exist', async () => {
      const repo = createMockRepo({
        findById: vi.fn().mockResolvedValue(undefined),
      })
      const service = new TimeLogService(repo as never)

      await expect(service.stopTimer('nonexistent')).rejects.toThrow(AppError)
      await expect(service.stopTimer('nonexistent')).rejects.toThrow('Time log not found')
    })

    it('throws CONFLICT when timer is already stopped', async () => {
      const log = makeTimeLog({ endedAt: new Date('2026-03-20T11:00:00Z') })
      const repo = createMockRepo({
        findById: vi.fn().mockResolvedValue(log),
      })
      const service = new TimeLogService(repo as never)

      await expect(service.stopTimer('tl-001')).rejects.toThrow(AppError)
      await expect(service.stopTimer('tl-001')).rejects.toThrow('Timer is already stopped')
    })
  })

  describe('query methods', () => {
    it('getByProject delegates to repository', async () => {
      const logs = [makeTimeLog()]
      const repo = createMockRepo({
        findByProjectId: vi.fn().mockResolvedValue(logs),
      })
      const service = new TimeLogService(repo as never)

      const result = await service.getByProject('proj-001')
      expect(result).toEqual(logs)
      expect(repo.findByProjectId).toHaveBeenCalledWith('proj-001')
    })

    it('getByTask delegates to repository', async () => {
      const logs = [makeTimeLog()]
      const repo = createMockRepo({
        findByTaskId: vi.fn().mockResolvedValue(logs),
      })
      const service = new TimeLogService(repo as never)

      const result = await service.getByTask('task-001')
      expect(result).toEqual(logs)
      expect(repo.findByTaskId).toHaveBeenCalledWith('task-001')
    })

    it('getByTalent delegates to repository', async () => {
      const logs = [makeTimeLog()]
      const repo = createMockRepo({
        findByTalentId: vi.fn().mockResolvedValue(logs),
      })
      const service = new TimeLogService(repo as never)

      const result = await service.getByTalent('talent-001')
      expect(result).toEqual(logs)
      expect(repo.findByTalentId).toHaveBeenCalledWith('talent-001')
    })
  })
})
