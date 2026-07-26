import {
  brdDocuments,
  type Database,
  milestones,
  prdDocuments,
  projects,
  revisionRequests,
  transactions,
} from '@kerjacus/db'
import { AppError, type ProjectStatus } from '@kerjacus/shared'
import { and, eq } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { parseOrderRef } from '../lib/order-ref'

export type SettlementResult =
  | { processed: true; type: 'brd' | 'prd' | 'escrow' | 'revision' }
  | { processed: false; reason: string }

type TransitionStatus = (
  projectId: string,
  target: ProjectStatus,
  userId: string,
  reason: string,
) => Promise<unknown>

/**
 * What happens to a project when a payment settles.
 *
 * This was a hundred and fifty lines inside the payment-callback route: order
 * prefix routing, four idempotency decisions, an escrow settlement, a status
 * transition and a revision credit, all reachable only through HTTP with a
 * live database. Money moving with no test seam.
 *
 * Every branch is idempotent because it has to be. Midtrans retries a
 * notification up to five times and may deliver out of order, so the same
 * order id arrives more than once as a matter of course, not as a fault.
 */
export class PaymentSettlementService {
  constructor(
    private db: Database,
    private transitionStatus: TransitionStatus,
  ) {}

  async settle(projectId: string, orderId: string, amount?: number): Promise<SettlementResult> {
    const ref = parseOrderRef(orderId)

    switch (ref.kind) {
      case 'brd':
        return await this.settleDocument(projectId, 'brd')
      case 'prd':
        return await this.settleDocument(projectId, 'prd')
      case 'escrow':
        return await this.settleEscrow(projectId, orderId)
      case 'revision':
        return await this.settleRevision(projectId, orderId, ref.milestoneId, amount)
      default:
        return { processed: false, reason: 'unknown order prefix' }
    }
  }

  // Payment unlocks the document. Leaving with it is a separate owner step.
  private async settleDocument(projectId: string, kind: 'brd' | 'prd'): Promise<SettlementResult> {
    const table = kind === 'brd' ? brdDocuments : prdDocuments

    const [doc] = await this.db
      .select({ paidAt: table.paidAt })
      .from(table)
      .where(eq(table.projectId, projectId))
      .limit(1)

    if (!doc) {
      throw new AppError('NOT_FOUND', `${kind.toUpperCase()} document not found for this project`)
    }
    // paidAt persists even when a later revision resets status, so it is the
    // durable record of the sale rather than a view of the current state.
    if (doc.paidAt) {
      return { processed: false, reason: 'already processed' }
    }

    await this.db
      .update(table)
      .set({ paidAt: new Date(), updatedAt: new Date() })
      .where(eq(table.projectId, projectId))

    return { processed: true, type: kind }
  }

  private async settleEscrow(projectId: string, orderId: string): Promise<SettlementResult> {
    // Name the row this callback is for. Every checkout attempt mints a fresh
    // order id, so abandoned ones leave pending escrow_in rows behind, and
    // matching on project + type + pending completed all of them at once:
    // phantom deposits with no ledger entries, counted into the owner's spend.
    await this.db
      .update(transactions)
      .set({ status: 'completed', updatedAt: new Date() })
      .where(
        and(
          eq(transactions.projectId, projectId),
          eq(transactions.type, 'escrow_in'),
          eq(transactions.status, 'pending'),
          eq(transactions.idempotencyKey, orderId),
        ),
      )

    try {
      await this.transitionStatus(
        projectId,
        'matching' as ProjectStatus,
        'system',
        'Escrow payment completed',
      )
    } catch {
      // Already past matching, or not yet eligible. The money is settled
      // either way, and the callback must not fail over the project's phase.
    }

    return { processed: true, type: 'escrow' }
  }

  /**
   * A paid revision fee becomes one credit the milestone revision path
   * consumes past the free limit.
   *
   * The credit is keyed to the transaction that paid for it. Without that,
   * a retried notification minted a second credit off a single payment -
   * and Midtrans retrying is routine, so the owner got free revisions by
   * doing nothing at all. fee_transaction_id was already on the schema for
   * this; the callback simply never set it.
   */
  private async settleRevision(
    projectId: string,
    orderId: string,
    milestoneId: string,
    amount?: number,
  ): Promise<SettlementResult> {
    const [ms] = await this.db
      .select({ projectId: milestones.projectId })
      .from(milestones)
      .where(eq(milestones.id, milestoneId))
      .limit(1)

    if (!ms || ms.projectId !== projectId) {
      return { processed: false, reason: 'unknown milestone' }
    }

    const [payment] = await this.db
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.idempotencyKey, orderId))
      .limit(1)

    if (payment) {
      const [existing] = await this.db
        .select({ id: revisionRequests.id })
        .from(revisionRequests)
        .where(eq(revisionRequests.feeTransactionId, payment.id))
        .limit(1)
      if (existing) {
        return { processed: false, reason: 'already processed' }
      }
    }

    const [project] = await this.db
      .select({ ownerId: projects.ownerId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1)

    await this.db.insert(revisionRequests).values({
      id: uuidv7(),
      milestoneId,
      requestedBy: project?.ownerId ?? 'system',
      description: 'Paid revision credit',
      severity: 'moderate',
      isPaid: true,
      feeAmount: amount ?? null,
      feeTransactionId: payment?.id ?? null,
      status: 'pending',
      requestedAt: new Date(),
    })

    return { processed: true, type: 'revision' }
  }
}
