import type { Database } from '@kerjacus/db'
import { milestones, revisionRequests, talentProfiles, tasks } from '@kerjacus/db'
import { MILESTONE_SUBJECTS } from '@kerjacus/nats-events'
import { AppError, type MilestoneStatus } from '@kerjacus/shared'
import { and, eq, gte, inArray, isNotNull, lt, sql } from 'drizzle-orm'
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

  /**
   * Milestones whose deadline has passed or is close, not yet warned about.
   *
   * Delivery states are excluded: a submitted milestone is the owner's turn and
   * an approved one is finished, so neither is late. The notice marker lives on
   * the row rather than in the notification service, because that service's
   * idempotency store degrades to a no-op when Valkey is unreachable, and an
   * hourly sweep with no marker would tell the talent they are late every hour
   * for the rest of the project.
   */
  async findMilestonesNeedingDeadlineNotice(
    kind: 'overdue' | 'due_soon',
    now: Date,
    horizon: Date,
    limit: number,
  ): Promise<
    { id: string; projectId: string; talentUserId: string | null; dueDate: Date | null }[]
  > {
    const marker = kind === 'overdue' ? 'overdueNotifiedAt' : 'dueSoonNotifiedAt'
    const window =
      kind === 'overdue'
        ? lt(milestones.dueDate, now)
        : and(gte(milestones.dueDate, now), lt(milestones.dueDate, horizon))

    return await this.db
      .select({
        id: milestones.id,
        projectId: milestones.projectId,
        talentUserId: talentProfiles.userId,
        dueDate: milestones.dueDate,
      })
      .from(milestones)
      .leftJoin(talentProfiles, eq(talentProfiles.id, milestones.assignedTalentId))
      .where(
        and(
          inArray(milestones.status, ['pending', 'in_progress', 'revision_requested', 'rejected']),
          isNotNull(milestones.dueDate),
          window,
          sql`${milestones.metadata} -> ${marker} IS NULL`,
        ),
      )
      .orderBy(milestones.dueDate)
      .limit(limit)
  }

  /**
   * Claim the right to warn about this deadline, and emit the event with it.
   *
   * The marker write is conditional on the marker still being absent, so two
   * replicas cannot both warn, and it commits in the same transaction as the
   * event, so a crash between them cannot leave a row marked warned about with
   * nothing published.
   */
  async claimDeadlineNotice(
    input: { milestoneId: string; projectId: string; talentUserId: string | null },
    kind: 'overdue' | 'due_soon',
    at: Date,
  ): Promise<boolean> {
    const marker = kind === 'overdue' ? 'overdueNotifiedAt' : 'dueSoonNotifiedAt'

    return await this.db.transaction(async (tx) => {
      const [claimed] = await tx
        .update(milestones)
        .set({
          // Merge, because metadata also carries the deliverable checklist.
          metadata: sql`coalesce(${milestones.metadata}, '{}'::jsonb) || jsonb_build_object(${marker}::text, to_jsonb(${at.toISOString()}::text))`,
          updatedAt: at,
        })
        .where(
          and(
            eq(milestones.id, input.milestoneId),
            sql`${milestones.metadata} -> ${marker} IS NULL`,
          ),
        )
        .returning({ id: milestones.id })

      if (!claimed) return false

      await appendOutboxEvent(tx, {
        aggregateType: 'milestone',
        aggregateId: input.milestoneId,
        eventType: kind === 'overdue' ? MILESTONE_SUBJECTS.OVERDUE : MILESTONE_SUBJECTS.DUE_SOON,
        payload: {
          milestoneId: input.milestoneId,
          projectId: input.projectId,
          talentId: input.talentUserId,
        },
      })

      return true
    })
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

  /**
   * Move a milestone to `status`, but only while it still holds
   * `expectedStatus`.
   *
   * The caller reads the current status and validates the transition in
   * JavaScript, so the write has to carry that read forward or two callers who
   * both saw `submitted` both write `approved`. An owner double-clicking
   * Approve races the auto-release sweep, which aims at exactly the milestones
   * an owner is looking at. Money survived on the `release:${milestoneId}` key,
   * but completedAt was overwritten and two milestone.approved events reached
   * the outbox, so the talent heard twice.
   */
  async updateStatus(
    id: string,
    status: MilestoneStatus,
    expectedStatus: MilestoneStatus,
  ): Promise<MilestoneSelect | undefined> {
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
        .where(and(eq(milestones.id, id), eq(milestones.status, expectedStatus)))
        .returning()

      // Row exists but moved on: somebody else won the same transition.
      if (!result) {
        const [current] = await tx
          .select({ status: milestones.status })
          .from(milestones)
          .where(eq(milestones.id, id))
          .limit(1)
        if (current) {
          throw new AppError(
            'CONFLICT',
            `Milestone is already ${current.status}, not ${expectedStatus}`,
          )
        }
        return undefined
      }

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

      /**
       * An approved milestone owes three invoice copies, so the request for
       * them commits with the approval.
       *
       * This was appended in the route with the bare pool, one statement after
       * this transaction had already committed. A crash in that gap left the
       * talent paid, the milestone terminally approved and no invoice for
       * anybody, plus a permanent hole in the per-project invoice_number
       * sequence that nothing reconciles.
       */
      if (status === 'approved') {
        await appendOutboxEvent(tx, {
          aggregateType: 'milestone',
          aggregateId: id,
          eventType: MILESTONE_SUBJECTS.INVOICE_REQUESTED,
          payload: { milestoneId: id, projectId: result.projectId },
        })
      }

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

  /**
   * Spend a revision round without touching the status.
   *
   * incrementRevisionCount hardcodes status 'revision_requested' and emits the
   * revision event with it, which is right for a revision request and wrong for
   * a rejection: it would move the row out of 'submitted' before the rejection's
   * own compare-and-swap, so the swap found the wrong status and the rejection
   * silently became a revision.
   */
  async bumpRevisionCount(id: string): Promise<void> {
    await this.db
      .update(milestones)
      .set({ revisionCount: sql`${milestones.revisionCount} + 1`, updatedAt: new Date() })
      .where(eq(milestones.id, id))
  }

  /**
   * `escalated` is decided by the caller, not here: it is a function of
   * FREE_MILESTONE_REVISIONS, and the consumer that reads it is Go. Passing the
   * verdict keeps the threshold in packages/shared with one reader.
   */
  async incrementRevisionCount(
    id: string,
    escalated: boolean,
  ): Promise<MilestoneSelect | undefined> {
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
          escalated,
        },
      })

      return result
    })
  }
}
