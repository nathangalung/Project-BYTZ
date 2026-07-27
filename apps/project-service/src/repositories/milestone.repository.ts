import type { Database } from '@kerjacus/db'
import { milestones, revisionRequests, talentProfiles, tasks } from '@kerjacus/db'
import { MILESTONE_SUBJECTS } from '@kerjacus/nats-events'
import { AppError, type MilestoneStatus } from '@kerjacus/shared'
import { and, eq, isNotNull, lt, sql } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { appendOutboxEvent } from '../lib/outbox'

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

  // Milestones still awaiting review past `cutoff`. submitted_at is rewritten on
  // every submission, so a milestone that came back from revision is measured
  // from its latest submission, not its first.
  async findOverdueSubmitted(
    cutoff: Date,
    limit: number,
  ): Promise<{ id: string; submittedAt: Date | null }[]> {
    return await this.db
      .select({ id: milestones.id, submittedAt: milestones.submittedAt })
      .from(milestones)
      .where(
        and(
          eq(milestones.status, 'submitted'),
          isNotNull(milestones.submittedAt),
          lt(milestones.submittedAt, cutoff),
        ),
      )
      .orderBy(milestones.submittedAt)
      .limit(limit)
  }

  async create(
    data: Omit<MilestoneInsert, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<MilestoneSelect> {
    const id = uuidv7()
    const now = new Date()

    return await this.db.transaction(async (tx) => {
      const result = await tx
        .insert(milestones)
        .values({
          ...data,
          id,
          createdAt: now,
          updatedAt: now,
        })
        .returning()

      if (!result[0]) throw new AppError('INTERNAL_ERROR', 'Milestone insert failed')

      // Every milestone gets a companion task: time_logs.task_id is a NOT NULL
      // FK to tasks, and the Gantt task layer reads this table, so without a
      // row here the timer can never log and the chart stays empty.
      await tx.insert(tasks).values({
        id: uuidv7(),
        milestoneId: id,
        assignedTalentId: data.assignedTalentId ?? null,
        title: data.title,
        description: data.description ?? null,
        orderIndex: data.orderIndex,
        status: 'pending',
        endDate: data.dueDate ?? null,
        createdAt: now,
        updatedAt: now,
      })

      return result[0]
    })
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

      // notifications.user_id references user, not talent_profiles, and the
      // consumer drops any event whose talentId is empty. Null on an
      // integration milestone, which has no single assignee.
      const [recipient] = await tx
        .select({ userId: talentProfiles.userId })
        .from(talentProfiles)
        .where(eq(talentProfiles.id, result.assignedTalentId ?? ''))
        .limit(1)

      const eventType =
        status === 'submitted'
          ? MILESTONE_SUBJECTS.SUBMITTED
          : status === 'approved'
            ? MILESTONE_SUBJECTS.APPROVED
            : status === 'rejected'
              ? MILESTONE_SUBJECTS.REJECTED
              : MILESTONE_SUBJECTS.REVISION_REQUESTED

      await appendOutboxEvent(tx, {
        aggregateType: 'milestone',
        aggregateId: id,
        eventType,
        payload: {
          milestoneId: id,
          projectId: result.projectId,
          talentId: recipient?.userId ?? null,
          status,
          // The consumer formats "Payment of Rp %d" from this; omitting it
          // told every talent their approved milestone paid Rp 0.
          amount: result.amount,
          changedBy: 'system',
        },
      })

      return result
    })
  }

  // Consume one paid revision credit (a pending, paid revision_requests row).
  // Returns false when none exists, in which case the caller charges first.
  async consumePaidRevisionCredit(milestoneId: string): Promise<boolean> {
    return await this.db.transaction(async (tx) => {
      const [credit] = await tx
        .select({ id: revisionRequests.id })
        .from(revisionRequests)
        .where(
          and(
            eq(revisionRequests.milestoneId, milestoneId),
            eq(revisionRequests.isPaid, true),
            eq(revisionRequests.status, 'pending'),
          ),
        )
        .limit(1)
        .for('update')
      if (!credit) return false
      await tx
        .update(revisionRequests)
        .set({ status: 'in_progress' })
        .where(eq(revisionRequests.id, credit.id))
      return true
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

      // Same recipient resolution as updateStatus: without talentId the
      // consumer drops the event and the talent never hears about the revision.
      const [recipient] = await tx
        .select({ userId: talentProfiles.userId })
        .from(talentProfiles)
        .where(eq(talentProfiles.id, result.assignedTalentId ?? ''))
        .limit(1)

      await appendOutboxEvent(tx, {
        aggregateType: 'milestone',
        aggregateId: id,
        eventType: MILESTONE_SUBJECTS.REVISION_REQUESTED,
        payload: {
          milestoneId: id,
          projectId: result.projectId,
          talentId: recipient?.userId ?? null,
          status: 'revision_requested',
          changedBy: 'system',
        },
      })

      return result
    })
  }
}
