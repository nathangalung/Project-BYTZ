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

export type ResolveInput = {
  resolution: string
  resolutionType: DisputeResolutionType
}

export type DisputeStatus = 'open' | 'under_review' | 'mediation' | 'resolved' | 'escalated'

/**
 * The steps that put the platform in the middle of the dispute. A party
 * moving their own case to mediation would be deciding it themselves.
 */
const ADMIN_ONLY_STATUSES: readonly DisputeStatus[] = ['under_review', 'mediation', 'escalated']

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
   * Two rules, both of which were inline in the handler: the transition has
   * to be one the state machine allows, and the steps that put the platform
   * in the middle - review, mediation, a binding decision - belong to an
   * admin. A party moving their own dispute to mediation would be deciding
   * their own case.
   */
  async changeStatus(
    id: string,
    userRole: string,
    toStatus: DisputeStatus,
    validTransitions: Record<string, readonly string[]>,
  ) {
    const existing = await this.repo.findById(id)
    if (!existing) {
      throw new AppError('DISPUTE_NOT_FOUND', 'Dispute not found')
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

    if (ADMIN_ONLY_STATUSES.includes(toStatus) && userRole !== 'admin') {
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
      const deposit = await this.repo.findEscrowDeposit(
        existing.projectId,
        existing.workPackageId ?? null,
      )

      if (deposit) {
        const ownerId = await this.repo.findProjectOwner(existing.projectId)
        if (!ownerId) {
          throw new AppError('PROJECT_NOT_FOUND', 'Project not found for dispute refund')
        }

        const balance = await this.getEscrowBalance(existing.projectId)
        const amount = disputeRefundAmount(input.resolutionType, deposit.amount, balance)

        if (amount > 0) {
          await this.refundEscrow({
            originalTransactionId: deposit.id,
            amount,
            reason: `Dispute ${id} resolved: ${input.resolutionType}`,
            ownerId,
            performedBy: adminId,
            idempotencyKey: `refund:dispute:${id}`,
          })
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
