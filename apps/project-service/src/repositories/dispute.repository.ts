import {
  type Database,
  disputes,
  milestones,
  projects,
  transactions,
  workPackages,
} from '@kerjacus/db'
import { and, desc, eq, sql } from 'drizzle-orm'
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

  /**
   * What is still owed on one work package, in Rupiah.
   *
   * The package price minus the milestones of that package the owner already
   * approved, because approved milestones have left escrow and paid the talent.
   * Nothing here reads a deposit: escrow is deposited once per project, so the
   * package's share is derived from what it was priced at rather than looked up
   * on a transaction row that has never carried a work package.
   *
   * Undefined when the package is not on this project, which the caller treats
   * as a refusal rather than as zero.
   */
  async findWorkPackageEscrowShare(
    projectId: string,
    workPackageId: string,
  ): Promise<number | undefined> {
    const [pkg] = await this.db
      .select({ amount: workPackages.amount })
      .from(workPackages)
      .where(and(eq(workPackages.id, workPackageId), eq(workPackages.projectId, projectId)))
      .limit(1)
    if (!pkg) return undefined

    const [paid] = await this.db
      .select({ total: sql<number>`coalesce(sum(${milestones.amount}), 0)::int` })
      .from(milestones)
      .where(and(eq(milestones.workPackageId, workPackageId), eq(milestones.status, 'approved')))

    return Math.max(pkg.amount - (paid?.total ?? 0), 0)
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
   * Open a dispute.
   *
   * This used to freeze the project by writing `disputed` over its status, and
   * the freeze had to land with the dispute or not at all. The row itself is
   * the freeze now: every guard that asked whether a project was disputed asks
   * for an unresolved row on it, which is true the moment this commits.
   */
  async create(input: {
    id: string
    projectId: string
    workPackageId: string | null
    initiatedBy: string
    againstUserId: string
    reason: string
    evidenceUrls: unknown
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

      // The project does not move. A dispute is a condition that holds at
      // whatever position the project is at, so opening one no longer
      // overwrites - and loses - that position; the row above IS the
      // condition, and is_disputed reads it.
      await tx.update(projects).set({ updatedAt: now }).where(eq(projects.id, input.projectId))

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

  /**
   * Mark the dispute resolved and publish it.
   *
   * resolved_at is the whole resolution. A project used to be frozen at
   * `disputed`, so closing a case had to work out where to put it back and,
   * when that was missed, left the owner and the talent looking at a project
   * with no way out but an admin transition nobody knew was owed. The project
   * never moved in the first place now, so there is nothing to restore.
   */
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

      /**
       * Nothing to restore.
       *
       * Resolving used to have to put the project back where it was, because
       * opening the dispute had overwritten that with `disputed` and the only
       * surviving copy was a status log row - read back, then clamped to what
       * the machine allowed out of `disputed`, which quietly landed a review
       * or partially_active project on in_progress. A dispute no longer moves
       * the project, so resolving one does not move it back: setting
       * resolved_at above is the whole resolution, and is_disputed goes false
       * on its own.
       */
      return result
    })
  }
}
