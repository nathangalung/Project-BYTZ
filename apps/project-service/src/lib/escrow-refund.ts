import { getDb, transactions } from '@kerjacus/db'
import { createLogger } from '@kerjacus/logger'
import { and, eq } from 'drizzle-orm'
import { getEscrowBalance, refundEscrow } from './payment-client'

const logger = createLogger('project-service:escrow-refund')

/**
 * Refund whatever escrow is still held for a project back to the owner.
 *
 * Sized from the remaining escrow LEDGER balance, never from the original
 * deposit: released milestones already left the account, and a refund above
 * the balance is rejected by the payment service. The balance is spread over
 * the completed escrow_in transactions because each refund is capped at its
 * original transaction's amount. Returns the total refunded (0 when nothing
 * is held). Idempotent per (key prefix, transaction).
 */
export async function refundRemainingEscrow(input: {
  projectId: string
  ownerId: string
  performedBy: string
  idempotencyKeyPrefix: string
  reason: string
}): Promise<{ refunded: number }> {
  const balance = await getEscrowBalance(input.projectId)
  if (balance <= 0) return { refunded: 0 }

  const db = getDb()
  const deposits = await db
    .select({ id: transactions.id, amount: transactions.amount })
    .from(transactions)
    .where(
      and(
        eq(transactions.projectId, input.projectId),
        eq(transactions.type, 'escrow_in'),
        eq(transactions.status, 'completed'),
      ),
    )
  if (deposits.length === 0) {
    logger.warn({ projectId: input.projectId, balance }, 'escrow balance with no deposit rows')
    return { refunded: 0 }
  }

  let remaining = balance
  let refunded = 0
  for (const deposit of deposits) {
    if (remaining <= 0) break
    const amount = Math.min(remaining, deposit.amount)
    await refundEscrow({
      originalTransactionId: deposit.id,
      amount,
      reason: input.reason,
      ownerId: input.ownerId,
      performedBy: input.performedBy,
      idempotencyKey: `${input.idempotencyKeyPrefix}:${deposit.id}`,
    })
    remaining -= amount
    refunded += amount
  }
  return { refunded }
}
