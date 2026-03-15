import type { Database } from '@bytz/db'
import { skills, workerProfiles, workerSkills } from '@bytz/db'
import { and, eq, inArray } from 'drizzle-orm'

type WorkerProfileSelect = typeof workerProfiles.$inferSelect

export type EligibleWorker = Pick<
  WorkerProfileSelect,
  | 'id'
  | 'userId'
  | 'totalProjectsCompleted'
  | 'totalProjectsActive'
  | 'averageRating'
  | 'pemerataanPenalty'
>

export type WorkerSkillRow = {
  workerId: string
  skillName: string
}

export class MatchingRepository {
  constructor(private db: Database) {}

  async findEligibleWorkers(excludeWorkerIds: string[] = []): Promise<EligibleWorker[]> {
    const workers = await this.db
      .select({
        id: workerProfiles.id,
        userId: workerProfiles.userId,
        totalProjectsCompleted: workerProfiles.totalProjectsCompleted,
        totalProjectsActive: workerProfiles.totalProjectsActive,
        averageRating: workerProfiles.averageRating,
        pemerataanPenalty: workerProfiles.pemerataanPenalty,
      })
      .from(workerProfiles)
      .where(
        and(
          eq(workerProfiles.verificationStatus, 'verified'),
          eq(workerProfiles.availabilityStatus, 'available'),
        ),
      )

    if (excludeWorkerIds.length === 0) {
      return workers
    }
    return workers.filter((w) => !excludeWorkerIds.includes(w.id))
  }

  async getWorkerSkills(workerIds: string[]): Promise<WorkerSkillRow[]> {
    if (workerIds.length === 0) return []

    return await this.db
      .select({
        workerId: workerSkills.workerId,
        skillName: skills.name,
      })
      .from(workerSkills)
      .innerJoin(skills, eq(workerSkills.skillId, skills.id))
      .where(inArray(workerSkills.workerId, workerIds))
  }
}
