import type { Database } from '@kerjacus/db'
import { milestones, tasks, timeLogs } from '@kerjacus/db'
import { AppError } from '@kerjacus/shared'
import { desc, eq } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'

type TimeLogSelect = typeof timeLogs.$inferSelect

export type CreateTimeLogInput = {
  taskId: string
  talentId: string
  startedAt: Date
  endedAt?: Date | null
  durationMinutes?: number | null
  description?: string | null
}

export class TimeLogRepository {
  constructor(private db: Database) {}

  async findByProjectId(projectId: string): Promise<(TimeLogSelect & { taskTitle: string })[]> {
    const rows = await this.db
      .select({
        id: timeLogs.id,
        taskId: timeLogs.taskId,
        talentId: timeLogs.talentId,
        startedAt: timeLogs.startedAt,
        endedAt: timeLogs.endedAt,
        durationMinutes: timeLogs.durationMinutes,
        description: timeLogs.description,
        createdAt: timeLogs.createdAt,
        taskTitle: tasks.title,
      })
      .from(timeLogs)
      .innerJoin(tasks, eq(timeLogs.taskId, tasks.id))
      .innerJoin(milestones, eq(tasks.milestoneId, milestones.id))
      .where(eq(milestones.projectId, projectId))
      .orderBy(desc(timeLogs.startedAt))

    return rows
  }

  async findByTaskId(taskId: string): Promise<TimeLogSelect[]> {
    return await this.db
      .select()
      .from(timeLogs)
      .where(eq(timeLogs.taskId, taskId))
      .orderBy(desc(timeLogs.startedAt))
  }

  async findByTalentId(talentId: string): Promise<TimeLogSelect[]> {
    return await this.db
      .select()
      .from(timeLogs)
      .where(eq(timeLogs.talentId, talentId))
      .orderBy(desc(timeLogs.startedAt))
  }

  async findById(id: string): Promise<TimeLogSelect | undefined> {
    const result = await this.db.select().from(timeLogs).where(eq(timeLogs.id, id)).limit(1)

    return result[0]
  }

  async create(data: CreateTimeLogInput): Promise<TimeLogSelect> {
    const id = uuidv7()

    const result = await this.db
      .insert(timeLogs)
      .values({
        id,
        taskId: data.taskId,
        talentId: data.talentId,
        startedAt: data.startedAt,
        endedAt: data.endedAt ?? null,
        durationMinutes: data.durationMinutes ?? null,
        description: data.description ?? null,
      })
      .returning()

    if (!result[0]) throw new AppError('INTERNAL_ERROR', 'Time log insert failed')
    return result[0]
  }

  async stopTimer(
    id: string,
    endedAt: Date,
    durationMinutes: number,
  ): Promise<TimeLogSelect | undefined> {
    const result = await this.db
      .update(timeLogs)
      .set({ endedAt, durationMinutes })
      .where(eq(timeLogs.id, id))
      .returning()

    return result[0]
  }
}
