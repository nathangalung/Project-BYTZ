import { type Database, disputes, projectStatusLogs, projects, transactions } from '@kerjacus/db'
import { PROJECT_SUBJECTS } from '@kerjacus/nats-events'
import { and, desc, eq, sql } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { appendOutboxEvent } from '../lib/outbox'

type DisputeSelect = typeof disputes.$inferSelect
type ResolutionType = 'funds_to_talent' | 'funds_to_owner' | 'split'

/**
 * Data access for disputes.
 *
 * disputes.ts was the one substantial route file with no seam at all - six of
 * six handlers ran Drizzle directly and three opened multi-table transactions
 * and published outbox events straight from HTTP. Money moves through the
 * resolve path, so it needed a layer that can be exercised without a server.
 */
export class DisputeRepository {
  constructor(private db: Database) {}

  async findById(id: string): Promise<DisputeSelect | undefined> {
    const [dispute] = await this.db.select().from(disputes).where(eq(disputes.id, id)).limit(1)
    return dispute
  }

  async findProjectOwner(projectId: string): Promise<string | undefined> {
    const [project] = await this.db
      .select({ ownerId: projects.ownerId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1)
    return project?.ownerId
  }

  /**
   * Every settled escrow deposit on the project, oldest first.
   *
   * This used to take one row and filter it by work_package_id, on the premise
   * that a package-scoped dispute refunds only that package's escrow. No
   * escrow_in row carries a work package - CreateSnapToken never sets one, and
   * the per-package split lives in the ledger accounts - so that predicate
   * matched nothing and the refund was silently skipped. The single-row form
   * was also wrong for project-level disputes: limit(1) with no ORDER BY on a
   * project funded more than once refunded whichever deposit came back.
   *
   * The caller sizes from the ledger balance and spreads across these, because
   * the payment service caps each refund at its own transaction's amount.
   */
  async findEscrowDeposits(projectId: string): Promise<Array<{ id: string; amount: number }>> {
    return await this.db
      .select({ id: transactions.id, amount: transactions.amount })
      .from(transactions)
      .where(
        and(
          eq(transactions.projectId, projectId),
          eq(transactions.type, 'escrow_in'),
          eq(transactions.status, 'completed'),
        ),
      )
      .orderBy(transactions.createdAt)
  }

  async findByProject(projectId: string): Promise<DisputeSelect[]> {
    return await this.db
      .select()
      .from(disputes)
      .where(eq(disputes.projectId, projectId))
      .orderBy(desc(disputes.createdAt))
  }

  async list(
    status: string | undefined,
    pagination: { page: number; pageSize: number },
  ): Promise<{ items: DisputeSelect[]; total: number }> {
    const where = status ? eq(disputes.status, status as DisputeSelect['status']) : undefined
    const offset = (pagination.page - 1) * pagination.pageSize

    const [items, countResult] = await Promise.all([
      this.db
        .select()
        .from(disputes)
        .where(where)
        .orderBy(desc(disputes.createdAt))
        .limit(pagination.pageSize)
        .offset(offset),
      this.db.select({ count: sql<number>`count(*)::int` }).from(disputes).where(where),
    ])

    return { items, total: countResult[0]?.count ?? 0 }
  }

  /**
   * Open a dispute and freeze the project in one transaction.
   *
   * The freeze has to land with the dispute or not at all: a dispute recorded
   * against a project still accepting transitions lets a milestone approval
   * race the resolution and move money the dispute exists to hold.
   */
  async create(input: {
    id: string
    projectId: string
    workPackageId: string | null
    initiatedBy: string
    againstUserId: string
    reason: string
    evidenceUrls: unknown
    fromStatus: DisputeSelect['status'] | string
  }): Promise<DisputeSelect> {
    const now = new Date()
    return await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(disputes)
        .values({
          id: input.id,
          projectId: input.projectId,
          workPackageId: input.workPackageId,
          initiatedBy: input.initiatedBy,
          againstUserId: input.againstUserId,
          reason: input.reason,
          evidenceUrls: input.evidenceUrls as never,
          status: 'open',
          createdAt: now,
          updatedAt: now,
        })
        .returning()

      await tx
        .update(projects)
        .set({ status: 'disputed', updatedAt: now })
        .where(eq(projects.id, input.projectId))

      await tx.insert(projectStatusLogs).values({
        id: uuidv7(),
        projectId: input.projectId,
        fromStatus: input.fromStatus as never,
        toStatus: 'disputed',
        changedBy: input.initiatedBy,
        reason: 'Dispute opened',
      })

      await appendOutboxEvent(tx, {
        aggregateType: 'dispute',
        aggregateId: input.id,
        eventType: 'dispute.created',
        payload: {
          disputeId: input.id,
          projectId: input.projectId,
          initiatedBy: input.initiatedBy,
          againstUserId: input.againstUserId,
        },
      })

      await appendOutboxEvent(tx, {
        aggregateType: 'project',
        aggregateId: input.projectId,
        eventType: PROJECT_SUBJECTS.STATUS_CHANGED,
        payload: {
          projectId: input.projectId,
          fromStatus: input.fromStatus,
          toStatus: 'disputed',
          changedBy: input.initiatedBy,
          reason: 'Dispute opened',
        },
      })

      return created
    })
  }

  async updateStatus(
    id: string,
    input: { projectId: string; fromStatus: string; toStatus: DisputeSelect['status'] },
  ): Promise<DisputeSelect> {
    return await this.db.transaction(async (tx) => {
      const [result] = await tx
        .update(disputes)
        .set({ status: input.toStatus, updatedAt: new Date() })
        .where(eq(disputes.id, id))
        .returning()

      await appendOutboxEvent(tx, {
        aggregateType: 'dispute',
        aggregateId: id,
        eventType: 'dispute.status_changed',
        payload: {
          disputeId: id,
          projectId: input.projectId,
          fromStatus: input.fromStatus,
          toStatus: input.toStatus,
        },
      })

      return result
    })
  }

  /** Mark resolved and publish the event atomically. */
  async resolve(
    id: string,
    input: {
      projectId: string
      resolution: string
      resolutionType: ResolutionType
      resolvedBy: string
    },
  ): Promise<DisputeSelect> {
    const now = new Date()
    return await this.db.transaction(async (tx) => {
      const [result] = await tx
        .update(disputes)
        .set({
          status: 'resolved',
          resolution: input.resolution,
          resolutionType: input.resolutionType,
          resolvedBy: input.resolvedBy,
          resolvedAt: now,
          updatedAt: now,
        })
        .where(eq(disputes.id, id))
        .returning()

      await appendOutboxEvent(tx, {
        aggregateType: 'dispute',
        aggregateId: id,
        eventType: 'dispute.resolved',
        payload: {
          disputeId: id,
          projectId: input.projectId,
          resolvedBy: input.resolvedBy,
          resolutionType: input.resolutionType,
        },
      })

      return result
    })
  }
}
