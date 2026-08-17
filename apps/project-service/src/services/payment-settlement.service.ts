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
import { and, eq, isNull } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { parseOrderRef } from '../lib/order-ref'

type SettlementResult =
  | { processed: true; type: 'brd' | 'prd' | 'escrow' | 'revision' }
  | { processed: false; reason: string }

type TransitionStatus = (
  projectId: string,
  target: ProjectStatus,
  // Null for a platform-initiated transition; see the escrow branch below.
  userId: string | null,
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

    /**
     * The UPDATE is the guard, not the SELECT above it. Retries are routine, so
     * reading paid_at and then writing it lets two callbacks both see null and
     * both report a fresh sale.
     *
     * paidAt persists even when a later revision resets status, so it is the
     * durable record of the sale rather than a view of the current state.
     */
    const claimed = await this.db
      .update(table)
      .set({ paidAt: new Date(), updatedAt: new Date() })
      .where(and(eq(table.projectId, projectId), isNull(table.paidAt)))
      .returning({ id: table.id })

    if (claimed.length === 0) {
      return { processed: false, reason: 'already processed' }
    }

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
        // Null, not 'system'. project_status_logs.changed_by is a foreign key
        // to user, so the literal violated it, the transition rolled back, and
        // the catch below swallowed it: the owner's escrow settled and the
        // project stayed in prd_approved with nothing logged anywhere.
        null,
        'Escrow payment completed',
      )
    } catch (err) {
      // Already past matching, or not yet eligible. The money is settled
      // either way, and the callback must not fail over the project's phase.
      // Logged rather than swallowed, because a bare catch here is what hid a
      // constraint violation for as long as it existed.
      console.warn('[settlement] escrow status transition skipped', { projectId, err })
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

    const [project] = await this.db
      .select({ ownerId: projects.ownerId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1)

    /**
     * The insert settles the duplicate, backed by
     * revision_requests_fee_transaction_unique.
     *
     * This used to SELECT by fee_transaction_id and then insert. Two concurrent
     * deliveries of the same callback both found nothing and both inserted, and
     * consumePaidRevisionCredit pops one credit per revision, so the owner got
     * a revision they had paid for once and been credited for twice. The
     * comment above already said the credit was keyed to the transaction to
     * prevent exactly this: the key was there, the uniqueness was not.
     */
    const created = await this.db
      .insert(revisionRequests)
      .values({
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
      .onConflictDoNothing()
      .returning({ id: revisionRequests.id })

    if (created.length === 0) {
      return { processed: false, reason: 'already processed' }
    }

    return { processed: true, type: 'revision' }
  }
}
