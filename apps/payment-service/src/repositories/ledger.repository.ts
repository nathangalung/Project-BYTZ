import { accounts, getDb, ledgerEntries } from '@bytz/db'
import type { AccountOwnerType, AccountType, LedgerEntryType } from '@bytz/shared'
import { AppError } from '@bytz/shared'
import { desc, eq, sql } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'

export type CreateAccountInput = {
  ownerType: AccountOwnerType
  ownerId?: string
  accountType: AccountType
  name: string
  currency?: string
}

export type LedgerEntryInput = {
  transactionId: string
  accountId: string
  entryType: LedgerEntryType
  amount: number
  description?: string
  metadata?: Record<string, unknown>
}

function db() {
  return getDb()
}

export const ledgerRepository = {
  async createAccount(data: CreateAccountInput) {
    const id = uuidv7()
    const now = new Date()
    const result = await db()
      .insert(accounts)
      .values({
        id,
        ownerType: data.ownerType,
        ownerId: data.ownerId ?? null,
        accountType: data.accountType,
        name: data.name,
        balance: 0,
        currency: data.currency ?? 'IDR',
        createdAt: now,
        updatedAt: now,
      })
      .returning()
    if (!result[0]) throw new AppError('INTERNAL_ERROR', 'Account insert failed')
    return result[0]
  },

  async getAccount(id: string) {
    const result = await db().select().from(accounts).where(eq(accounts.id, id)).limit(1)
    return result[0] ?? null
  },

  async findAccountByOwner(ownerType: AccountOwnerType, ownerId?: string) {
    if (ownerId) {
      const result = await db()
        .select()
        .from(accounts)
        .where(sql`${accounts.ownerType} = ${ownerType} AND ${accounts.ownerId} = ${ownerId}`)
        .limit(1)
      return result[0] ?? null
    }
    const result = await db()
      .select()
      .from(accounts)
      .where(sql`${accounts.ownerType} = ${ownerType} AND ${accounts.ownerId} IS NULL`)
      .limit(1)
    return result[0] ?? null
  },

  async getOrCreateAccount(data: CreateAccountInput) {
    const existing = await this.findAccountByOwner(data.ownerType, data.ownerId)
    if (existing) return existing
    return this.createAccount(data)
  },

  async createLedgerEntries(entries: LedgerEntryInput[]) {
    if (entries.length === 0) {
      throw new AppError('VALIDATION_ERROR', 'At least one ledger entry is required')
    }

    let totalDebit = 0
    let totalCredit = 0
    for (const entry of entries) {
      if (entry.amount <= 0) {
        throw new AppError('VALIDATION_ERROR', 'Ledger entry amount must be positive')
      }
      if (entry.entryType === 'debit') {
        totalDebit += entry.amount
      } else {
        totalCredit += entry.amount
      }
    }

    if (totalDebit !== totalCredit) {
      throw new AppError(
        'VALIDATION_ERROR',
        `Ledger entries must balance: debit=${totalDebit}, credit=${totalCredit}`,
      )
    }

    const database = db()
    return database.transaction(async (tx) => {
      const created = []
      for (const entry of entries) {
        const id = uuidv7()
        const entryResult = await tx
          .insert(ledgerEntries)
          .values({
            id,
            transactionId: entry.transactionId,
            accountId: entry.accountId,
            entryType: entry.entryType,
            amount: entry.amount,
            description: entry.description ?? null,
            metadata: entry.metadata ?? null,
            createdAt: new Date(),
          })
          .returning()
        if (!entryResult[0]) throw new AppError('INTERNAL_ERROR', 'Ledger entry insert failed')
        created.push(entryResult[0])

        // Update account balance
        const balanceChange = entry.entryType === 'debit' ? entry.amount : -entry.amount
        await tx
          .update(accounts)
          .set({
            balance: sql`${accounts.balance} + ${balanceChange}`,
            updatedAt: new Date(),
          })
          .where(eq(accounts.id, entry.accountId))
      }
      return created
    })
  },

  async getEntriesByTransaction(transactionId: string) {
    return db()
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.transactionId, transactionId))
      .orderBy(desc(ledgerEntries.createdAt))
  },

  async getAccountBalance(accountId: string) {
    const account = await this.getAccount(accountId)
    if (!account) {
      throw new AppError('NOT_FOUND', 'Account not found')
    }
    return account.balance
  },

  async getAccountEntries(accountId: string) {
    return db()
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.accountId, accountId))
      .orderBy(desc(ledgerEntries.createdAt))
  },
}
