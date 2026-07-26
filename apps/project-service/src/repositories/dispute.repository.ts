import { type Database, disputes, projects, transactions } from '@kerjacus/db'
import { and, eq, isNull } from 'drizzle-orm'
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
   * The escrow deposit this dispute is against.
   *
   * A dispute raised over one work package refunds only that package's
   * escrow; a project-level dispute must match the rows with no work package,
   * or it would pick up a package deposit belonging to a talent who is not
   * part of the dispute at all.
   */
  async findEscrowDeposit(
    projectId: string,
    workPackageId: string | null,
  ): Promise<{ id: string; amount: number } | undefined> {
    const conditions = [
      eq(transactions.projectId, projectId),
      eq(transactions.type, 'escrow_in'),
      eq(transactions.status, 'completed'),
      workPackageId
        ? eq(transactions.workPackageId, workPackageId)
        : isNull(transactions.workPackageId),
    ]

    const [deposit] = await this.db
      .select({ id: transactions.id, amount: transactions.amount })
      .from(transactions)
      .where(and(...conditions))
      .limit(1)
    return deposit
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
