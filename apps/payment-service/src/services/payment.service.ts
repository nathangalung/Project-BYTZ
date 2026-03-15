import { AppError } from '@bytz/shared'
import { ledgerRepository } from '../repositories/ledger.repository'
import { transactionRepository } from '../repositories/transaction.repository'

export const paymentService = {
  async createEscrow(input: {
    projectId: string
    amount: number
    workPackageId?: string
    workerId?: string
    clientId: string
    idempotencyKey: string
  }) {
    const { projectId, amount, workPackageId, workerId, clientId, idempotencyKey } = input

    if (amount <= 0) {
      throw new AppError('VALIDATION_ERROR', 'Escrow amount must be positive')
    }

    // Idempotency check + create transaction
    const { transaction, isNew } = await transactionRepository.create({
      projectId,
      workPackageId,
      workerId,
      type: 'escrow_in',
      amount,
      idempotencyKey,
    })

    if (!isNew) {
      return transaction
    }

    // Get or create accounts for double-entry bookkeeping
    const clientAccount = await ledgerRepository.getOrCreateAccount({
      ownerType: 'client',
      ownerId: clientId,
      accountType: 'asset',
      name: `Client Account - ${clientId}`,
    })

    const escrowAccount = await ledgerRepository.getOrCreateAccount({
      ownerType: 'escrow',
      ownerId: projectId,
      accountType: 'liability',
      name: `Escrow - Project ${projectId}`,
    })

    // Double-entry: debit escrow (money held), credit client (money out)
    await ledgerRepository.createLedgerEntries([
      {
        transactionId: transaction.id,
        accountId: escrowAccount.id,
        entryType: 'debit',
        amount,
        description: `Escrow deposit for project ${projectId}`,
        metadata: { projectId, workPackageId },
      },
      {
        transactionId: transaction.id,
        accountId: clientAccount.id,
        entryType: 'credit',
        amount,
        description: `Escrow deposit for project ${projectId}`,
        metadata: { projectId, workPackageId },
      },
    ])

    // Mark transaction completed
    const updated = await transactionRepository.updateStatus(transaction.id, 'completed')

    // Create audit event
    await transactionRepository.createTransactionEvent({
      transactionId: transaction.id,
      eventType: 'escrow_created',
      previousStatus: 'pending',
      newStatus: 'completed',
      amount,
      metadata: { projectId, workPackageId, clientId },
      performedBy: clientId,
    })

    return updated
  },

  async releaseEscrow(input: {
    milestoneId: string
    projectId: string
    workerId: string
    amount: number
    performedBy: string
    idempotencyKey: string
  }) {
    const { milestoneId, projectId, workerId, amount, performedBy, idempotencyKey } = input

    if (amount <= 0) {
      throw new AppError('VALIDATION_ERROR', 'Release amount must be positive')
    }

    // Idempotency check + create transaction
    const { transaction, isNew } = await transactionRepository.create({
      projectId,
      milestoneId,
      workerId,
      type: 'escrow_release',
      amount,
      idempotencyKey,
    })

    if (!isNew) {
      return transaction
    }

    // Get accounts
    const escrowAccount = await ledgerRepository.findAccountByOwner('escrow', projectId)
    if (!escrowAccount) {
      throw new AppError(
        'PAYMENT_ESCROW_INSUFFICIENT_FUNDS',
        'Escrow account not found for this project',
      )
    }

    if (escrowAccount.balance < amount) {
      throw new AppError(
        'PAYMENT_ESCROW_INSUFFICIENT_FUNDS',
        `Insufficient escrow balance: ${escrowAccount.balance} < ${amount}`,
      )
    }

    const workerAccount = await ledgerRepository.getOrCreateAccount({
      ownerType: 'worker',
      ownerId: workerId,
      accountType: 'asset',
      name: `Worker Payout - ${workerId}`,
    })

    // Double-entry: debit worker (money in), credit escrow (money out)
    await ledgerRepository.createLedgerEntries([
      {
        transactionId: transaction.id,
        accountId: workerAccount.id,
        entryType: 'debit',
        amount,
        description: `Milestone payment for milestone ${milestoneId}`,
        metadata: { projectId, milestoneId, workerId },
      },
      {
        transactionId: transaction.id,
        accountId: escrowAccount.id,
        entryType: 'credit',
        amount,
        description: `Escrow release for milestone ${milestoneId}`,
        metadata: { projectId, milestoneId, workerId },
      },
    ])

    const updated = await transactionRepository.updateStatus(transaction.id, 'completed')

    await transactionRepository.createTransactionEvent({
      transactionId: transaction.id,
      eventType: 'funds_released',
      previousStatus: 'pending',
      newStatus: 'completed',
      amount,
      metadata: { projectId, milestoneId, workerId },
      performedBy,
    })

    return updated
  },

  async processRefund(input: {
    originalTransactionId: string
    amount: number
    reason: string
    clientId: string
    performedBy: string
    idempotencyKey: string
  }) {
    const { originalTransactionId, amount, reason, clientId, performedBy, idempotencyKey } = input

    if (amount <= 0) {
      throw new AppError('VALIDATION_ERROR', 'Refund amount must be positive')
    }

    const original = await transactionRepository.findById(originalTransactionId)
    if (!original) {
      throw new AppError('NOT_FOUND', 'Original transaction not found')
    }

    if (original.status === 'refunded') {
      throw new AppError('PAYMENT_ALREADY_PROCESSED', 'Transaction already refunded')
    }

    if (amount > original.amount) {
      throw new AppError(
        'VALIDATION_ERROR',
        'Refund amount cannot exceed original transaction amount',
      )
    }

    const isPartial = amount < original.amount
    const refundType = isPartial ? 'partial_refund' : 'refund'

    const { transaction, isNew } = await transactionRepository.create({
      projectId: original.projectId,
      workPackageId: original.workPackageId ?? undefined,
      milestoneId: original.milestoneId ?? undefined,
      workerId: original.workerId ?? undefined,
      type: refundType,
      amount,
      idempotencyKey,
    })

    if (!isNew) {
      return transaction
    }

    // Get escrow account for the project
    const escrowAccount = await ledgerRepository.findAccountByOwner('escrow', original.projectId)

    const clientAccount = await ledgerRepository.getOrCreateAccount({
      ownerType: 'client',
      ownerId: clientId,
      accountType: 'asset',
      name: `Client Account - ${clientId}`,
    })

    if (escrowAccount) {
      // Double-entry: debit client (money back), credit escrow (money out)
      await ledgerRepository.createLedgerEntries([
        {
          transactionId: transaction.id,
          accountId: clientAccount.id,
          entryType: 'debit',
          amount,
          description: `Refund: ${reason}`,
          metadata: { originalTransactionId, reason },
        },
        {
          transactionId: transaction.id,
          accountId: escrowAccount.id,
          entryType: 'credit',
          amount,
          description: `Refund from escrow: ${reason}`,
          metadata: { originalTransactionId, reason },
        },
      ])
    }

    const updated = await transactionRepository.updateStatus(transaction.id, 'completed')

    // Mark original as refunded if full refund
    if (!isPartial) {
      await transactionRepository.updateStatus(originalTransactionId, 'refunded')
    }

    await transactionRepository.createTransactionEvent({
      transactionId: transaction.id,
      eventType: 'refund_initiated',
      previousStatus: 'pending',
      newStatus: 'completed',
      amount,
      metadata: { originalTransactionId, reason, isPartial },
      performedBy,
    })

    return updated
  },

  async getProjectTransactions(projectId: string) {
    return transactionRepository.findByProjectId(projectId)
  },

  async getTransactionById(id: string) {
    const transaction = await transactionRepository.findById(id)
    if (!transaction) {
      throw new AppError('NOT_FOUND', 'Transaction not found')
    }

    const events = await transactionRepository.getEventsByTransaction(id)
    const entries = await ledgerRepository.getEntriesByTransaction(id)

    return { ...transaction, events, ledgerEntries: entries }
  },
}
