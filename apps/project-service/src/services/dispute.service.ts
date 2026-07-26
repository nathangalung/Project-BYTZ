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
