import { getDb, transactionEvents, transactions } from '@bytz/db'
import type { TransactionEventType, TransactionStatus, TransactionType } from '@bytz/shared'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'

export type CreateTransactionInput = {
  projectId: string
  workPackageId?: string
  milestoneId?: string
  workerId?: string
  type: TransactionType
  amount: number
  idempotencyKey: string
  paymentMethod?: string
  paymentGatewayRef?: string
}

export type CreateTransactionEventInput = {
  transactionId: string
  eventType: TransactionEventType
  previousStatus?: TransactionStatus
  newStatus: TransactionStatus
  amount?: number
  metadata?: Record<string, unknown>
  performedBy: string
}

function db() {
  return getDb()
}

export const transactionRepository = {
  async findByIdempotencyKey(key: string) {
    const result = await db()
      .select()
      .from(transactions)
      .where(and(eq(transactions.idempotencyKey, key), isNull(transactions.deletedAt)))
      .limit(1)
    return result[0] ?? null
  },

  async create(data: CreateTransactionInput) {
    const existing = await this.findByIdempotencyKey(data.idempotencyKey)
    if (existing) {
      return { transaction: existing, isNew: false }
    }

    const id = uuidv7()
    const now = new Date()
    const [transaction] = await db()
      .insert(transactions)
      .values({
        id,
        projectId: data.projectId,
        workPackageId: data.workPackageId ?? null,
        milestoneId: data.milestoneId ?? null,
        workerId: data.workerId ?? null,
        type: data.type,
        amount: data.amount,
        status: 'pending',
        paymentMethod: data.paymentMethod ?? null,
        paymentGatewayRef: data.paymentGatewayRef ?? null,
        idempotencyKey: data.idempotencyKey,
        createdAt: now,
        updatedAt: now,
      })
      .returning()

    if (!transaction) {
      throw new Error('Failed to create transaction')
    }
    return { transaction, isNew: true }
  },

  async findById(id: string) {
    const result = await db()
      .select()
      .from(transactions)
      .where(and(eq(transactions.id, id), isNull(transactions.deletedAt)))
      .limit(1)
    return result[0] ?? null
  },

  async findByProjectId(projectId: string) {
    return db()
      .select()
      .from(transactions)
      .where(and(eq(transactions.projectId, projectId), isNull(transactions.deletedAt)))
      .orderBy(desc(transactions.createdAt))
  },

  async updateStatus(id: string, status: TransactionStatus) {
    const now = new Date()
    const [updated] = await db()
      .update(transactions)
      .set({ status, updatedAt: now })
      .where(eq(transactions.id, id))
      .returning()
    return updated ?? null
  },

  async createTransactionEvent(data: CreateTransactionEventInput) {
    const id = uuidv7()
    const [event] = await db()
      .insert(transactionEvents)
      .values({
        id,
        transactionId: data.transactionId,
        eventType: data.eventType,
        previousStatus: data.previousStatus ?? null,
        newStatus: data.newStatus,
        amount: data.amount ?? null,
        metadata: data.metadata ?? null,
        performedBy: data.performedBy,
        createdAt: new Date(),
      })
      .returning()
    if (!event) {
      throw new Error('Failed to create transaction event')
    }
    return event
  },

  async getEventsByTransaction(transactionId: string) {
    return db()
      .select()
      .from(transactionEvents)
      .where(eq(transactionEvents.transactionId, transactionId))
      .orderBy(desc(transactionEvents.createdAt))
  },
}
