import { AppError } from '@kerjacus/shared'
import { type DisputeResolutionType, disputeRefundAmount } from '../lib/dispute-refund'
import type { DisputeRepository } from '../repositories/dispute.repository'

type RefundEscrow = (input: {
  originalTransactionId: string
  amount: number
  reason: string
  ownerId: string
  performedBy: string
  idempotencyKey: string
}) => Promise<unknown>

type GetEscrowBalance = (projectId: string) => Promise<number>

type ResolveInput = {
  resolution: string
  resolutionType: DisputeResolutionType
}

type DisputeStatus = 'open' | 'under_review' | 'mediation' | 'resolved' | 'escalated'

/**
 * The steps that put the platform in the middle of the dispute. A party
 * moving their own case to mediation would be deciding it themselves.
 *
 * `resolved` is here too. It is the only target a non-admin could otherwise
 * reach, and reaching it through this route settles the dispute without the
 * refund that `resolve` performs - money the dispute was opened to move never
 * moves, and `resolve` then refuses the dispute as already resolved.
 */
const ADMIN_ONLY_STATUSES: readonly DisputeStatus[] = [
  'under_review',
  'mediation',
  'escalated',
  'resolved',
]

type DisputeActor = { id: string; role: string }

/**
 * Resolving a dispute, which moves money.
 *
 * This lived inside a route handler with five other handlers that also ran
 * Drizzle directly, so the ordering rule below - the one thing here that
 * really matters - had never been asserted anywhere.
 */
export class DisputeService {
  constructor(
    private repo: DisputeRepository,
    private refundEscrow: RefundEscrow,
    private getEscrowBalance: GetEscrowBalance,
  ) {}

  /**
   * Move a dispute along the three-step escalation.
   *
   * Three rules. The caller has to be a party to this dispute or an admin -
   * the handler checked neither, so any signed-in user could walk dispute ids
   * and mark a stranger's case resolved, which is terminal and dead-ends the
   * resolution path for the two people whose money is frozen. The transition
   * has to be one the state machine allows. And the steps that put the
   * platform in the middle - review, mediation, a binding decision - belong to
   * an admin, because a party moving their own dispute would be deciding their
   * own case.
   */
  async changeStatus(
    id: string,
    actor: DisputeActor,
    toStatus: DisputeStatus,
    validTransitions: Record<string, readonly string[]>,
  ) {
    const existing = await this.repo.findById(id)
    if (!existing) {
      throw new AppError('DISPUTE_NOT_FOUND', 'Dispute not found')
    }

    // Before anything that would reveal the dispute's state to a stranger.
    const isParty = existing.initiatedBy === actor.id || existing.againstUserId === actor.id
    if (!isParty && actor.role !== 'admin') {
      throw new AppError('AUTH_FORBIDDEN', 'Not a party to this dispute')
    }

    if (existing.status === 'resolved') {
      throw new AppError('DISPUTE_ALREADY_RESOLVED', 'Dispute already resolved')
    }

    if (!validTransitions[existing.status]?.includes(toStatus)) {
      throw new AppError(
        'DISPUTE_INVALID_STATUS',
        `Cannot transition from ${existing.status} to ${toStatus}`,
      )
    }

    if (ADMIN_ONLY_STATUSES.includes(toStatus) && actor.role !== 'admin') {
      throw new AppError('AUTH_FORBIDDEN', 'Only platform admin can escalate disputes')
    }

    return await this.repo.updateStatus(id, {
      projectId: existing.projectId,
      fromStatus: existing.status,
      toStatus,
    })
  }

  async resolve(id: string, adminId: string, input: ResolveInput) {
    const existing = await this.repo.findById(id)
    if (!existing) {
      throw new AppError('DISPUTE_NOT_FOUND', 'Dispute not found')
    }
    if (existing.status === 'resolved') {
      throw new AppError('DISPUTE_ALREADY_RESOLVED', 'Dispute already resolved')
    }

    /**
     * Money moves BEFORE the dispute is marked resolved.
     *
     * If the refund fails, this throws and the admin retries. The other order
     * leaves a dispute recorded as resolved whose refund silently never
     * happened, which nobody would go looking for. The dispute-scoped
     * idempotency key is what makes the retry replay rather than pay twice.
     */
    if (input.resolutionType !== 'funds_to_talent') {
      /**
       * A package-scoped refund cannot be sized, so it must not be attempted.
       *
       * Escrow is deposited once per project: CreateSnapToken never sets
       * work_package_id on an escrow_in row, and the per-package split lives in
       * the ledger accounts rather than the transaction. Matching deposits on
       * the package therefore found nothing, the refund block was skipped, and
       * the dispute was still marked resolved - which is terminal. The escrow
       * stayed frozen on a case that could no longer be reopened, and the admin
       * saw a success. Refusing is the honest outcome until deposits carry the
       * package.
       */
      if (existing.workPackageId) {
        throw new AppError(
          'DISPUTE_SCOPE_UNSUPPORTED',
          'Cannot refund a work-package dispute: escrow is held at project level',
        )
      }

      const ownerId = await this.repo.findProjectOwner(existing.projectId)
      if (!ownerId) {
        throw new AppError('PROJECT_NOT_FOUND', 'Project not found for dispute refund')
      }

      /**
       * Sized from the balance still held and spread across the deposits.
       *
       * It used to size against one arbitrary deposit - findEscrowDeposit took
       * limit(1) with no ORDER BY - so a project funded twice refunded at most
       * the first deposit's amount and stranded the rest on a closed dispute.
       * Each refund is capped at its own transaction's amount by the payment
       * service, which is why the spread is the caller's job.
       */
      const balance = await this.getEscrowBalance(existing.projectId)
      let remaining = disputeRefundAmount(input.resolutionType, balance, balance)

      if (remaining > 0) {
        const deposits = await this.repo.findEscrowDeposits(existing.projectId)
        for (const deposit of deposits) {
          if (remaining <= 0) break
          const amount = Math.min(remaining, deposit.amount)
          await this.refundEscrow({
            originalTransactionId: deposit.id,
            amount,
            reason: `Dispute ${id} resolved: ${input.resolutionType}`,
            ownerId,
            performedBy: adminId,
            idempotencyKey: `refund:dispute:${id}:${deposit.id}`,
          })
          remaining -= amount
        }
      }
    }

    return await this.repo.resolve(id, {
      projectId: existing.projectId,
      resolution: input.resolution,
      resolutionType: input.resolutionType,
      resolvedBy: adminId,
    })
  }
}
