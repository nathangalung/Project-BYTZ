import type { Database } from '@kerjacus/db'
import { milestones, outboxEvents } from '@kerjacus/db'
import { MILESTONE_SUBJECTS } from '@kerjacus/nats-events'
import { AppError, type MilestoneStatus } from '@kerjacus/shared'
import { eq, sql } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'

type MilestoneInsert = typeof milestones.$inferInsert
type MilestoneSelect = typeof milestones.$inferSelect

export class MilestoneRepository {
  constructor(private db: Database) {}

  async findByProjectId(projectId: string): Promise<MilestoneSelect[]> {
    return await this.db
      .select()
      .from(milestones)
      .where(eq(milestones.projectId, projectId))
      .orderBy(milestones.orderIndex)
  }

  async findById(id: string): Promise<MilestoneSelect | undefined> {
    const result = await this.db.select().from(milestones).where(eq(milestones.id, id)).limit(1)

    return result[0]
  }

  async create(
    data: Omit<MilestoneInsert, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<MilestoneSelect> {
    const id = uuidv7()
    const now = new Date()

    const result = await this.db
      .insert(milestones)
      .values({
        ...data,
        id,
        createdAt: now,
        updatedAt: now,
      })
      .returning()

    if (!result[0]) throw new AppError('INTERNAL_ERROR', 'Milestone insert failed')
    return result[0]
  }

  async updateStatus(id: string, status: MilestoneStatus): Promise<MilestoneSelect | undefined> {
    return await this.db.transaction(async (tx) => {
      const now = new Date()

      const updates: Partial<MilestoneInsert> = {
        status,
        updatedAt: now,
      }

      if (status === 'submitted') {
        updates.submittedAt = now
      }
      if (status === 'approved') {
        updates.completedAt = now
      }

      const [result] = await tx
        .update(milestones)
        .set(updates)
        .where(eq(milestones.id, id))
        .returning()

      if (!result) return undefined

      const eventType =
        status === 'submitted'
          ? MILESTONE_SUBJECTS.SUBMITTED
          : status === 'approved'
            ? MILESTONE_SUBJECTS.APPROVED
            : status === 'rejected'
              ? MILESTONE_SUBJECTS.REJECTED
              : MILESTONE_SUBJECTS.REVISION_REQUESTED

      await tx.insert(outboxEvents).values({
        id: uuidv7(),
        aggregateType: 'milestone',
        aggregateId: id,
        eventType,
        payload: {
          milestoneId: id,
          projectId: result.projectId,
          status,
          changedBy: 'system',
        },
      })

      return result
    })
  }

  async incrementRevisionCount(id: string): Promise<MilestoneSelect | undefined> {
    return await this.db.transaction(async (tx) => {
      const [result] = await tx
        .update(milestones)
        .set({
          revisionCount: sql`${milestones.revisionCount} + 1`,
          status: 'revision_requested' as MilestoneStatus,
          updatedAt: new Date(),
        })
        .where(eq(milestones.id, id))
        .returning()

      if (!result) return undefined

      await tx.insert(outboxEvents).values({
        id: uuidv7(),
        aggregateType: 'milestone',
        aggregateId: id,
        eventType: MILESTONE_SUBJECTS.REVISION_REQUESTED,
        payload: {
          milestoneId: id,
          projectId: result.projectId,
          status: 'revision_requested',
          changedBy: 'system',
        },
      })

      return result
    })
  }
}
