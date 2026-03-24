import { AppError } from '@kerjacus/shared'
import type { TimeLogRepository } from '../repositories/time-log.repository'

export class TimeLogService {
  constructor(private timeLogRepo: TimeLogRepository) {}

  async createTimeLog(input: {
    taskId: string
    talentId: string
    startedAt: string
    endedAt?: string
    durationMinutes?: number
    description?: string
  }) {
    const startedAt = new Date(input.startedAt)
    const endedAt = input.endedAt ? new Date(input.endedAt) : null

    // Calculate duration if endedAt provided but durationMinutes not
    let durationMinutes = input.durationMinutes ?? null
    if (endedAt && durationMinutes === null) {
      durationMinutes = Math.round((endedAt.getTime() - startedAt.getTime()) / 60_000)
    }

    // Validate endedAt is after startedAt
    if (endedAt && endedAt <= startedAt) {
      throw new AppError('VALIDATION_ERROR', 'endedAt must be after startedAt')
    }

    return await this.timeLogRepo.create({
      taskId: input.taskId,
      talentId: input.talentId,
      startedAt,
      endedAt,
      durationMinutes,
      description: input.description ?? null,
    })
  }

  async getByProject(projectId: string) {
    return await this.timeLogRepo.findByProjectId(projectId)
  }

  async getByTask(taskId: string) {
    return await this.timeLogRepo.findByTaskId(taskId)
  }

  async getByTalent(talentId: string) {
    return await this.timeLogRepo.findByTalentId(talentId)
  }

  async stopTimer(id: string) {
    const log = await this.timeLogRepo.findById(id)
    if (!log) {
      throw new AppError('NOT_FOUND', 'Time log not found')
    }
    if (log.endedAt) {
      throw new AppError('CONFLICT', 'Timer is already stopped')
    }

    const endedAt = new Date()
    const durationMinutes = Math.round((endedAt.getTime() - log.startedAt.getTime()) / 60_000)

    return await this.timeLogRepo.stopTimer(id, endedAt, durationMinutes)
  }
}
