import type { Database } from '@bytz/db'
import { timeLogs } from '@bytz/db'
import { AppError } from '@bytz/shared'
import { desc, eq } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'

type TimeLogSelect = typeof timeLogs.$inferSelect

export type CreateTimeLogInput = {
  taskId: string
  workerId: string
  startedAt: Date
  endedAt?: Date | null
  durationMinutes?: number | null
  description?: string | null
}

export class TimeLogRepository {
  constructor(private db: Database) {}

  async findByTaskId(taskId: string): Promise<TimeLogSelect[]> {
    return await this.db
      .select()
      .from(timeLogs)
      .where(eq(timeLogs.taskId, taskId))
      .orderBy(desc(timeLogs.startedAt))
  }

  async findByWorkerId(workerId: string): Promise<TimeLogSelect[]> {
    return await this.db
      .select()
      .from(timeLogs)
      .where(eq(timeLogs.workerId, workerId))
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
        workerId: data.workerId,
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
