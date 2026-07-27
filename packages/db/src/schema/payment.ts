import { sql } from 'drizzle-orm'
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core'
import { talentProfiles } from './auth'
import { user } from './better-auth'
import { milestones, projects, workPackages } from './project'

export const transactionTypeEnum = pgEnum('transaction_type', [
  'escrow_in',
  'escrow_release',
  'brd_payment',
  'prd_payment',
  'refund',
  'partial_refund',
  'revision_fee',
  'talent_placement_fee',
])
export const transactionStatusEnum = pgEnum('transaction_status', [
  'pending',
  'processing',
  'completed',
  'failed',
  'refunded',
])
export const accountOwnerTypeEnum = pgEnum('account_owner_type', [
  'platform',
  'owner',
  'talent',
  'escrow',
])
export const accountTypeEnum = pgEnum('account_type', ['asset', 'liability', 'revenue', 'expense'])
export const ledgerEntryTypeEnum = pgEnum('ledger_entry_type', ['debit', 'credit'])
export const transactionEventTypeEnum = pgEnum('transaction_event_type', [
  'escrow_created',
  'milestone_submitted',
  'milestone_approved',
  'funds_released',
  'refund_initiated',
  'dispute_opened',
  'dispute_resolved',
])
export const talentPlacementStatusEnum = pgEnum('talent_placement_status', [
  'requested',
  'in_discussion',
  'accepted',
  'declined',
  'completed',
])

export const transactions = pgTable(
  'transactions',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    workPackageId: text('work_package_id').references(() => workPackages.id),
    milestoneId: text('milestone_id').references(() => milestones.id),
    talentId: text('talent_id').references(() => talentProfiles.id),
    type: transactionTypeEnum('type').notNull(),
    amount: integer('amount').notNull(),
    status: transactionStatusEnum('status').default('pending').notNull(),
    paymentMethod: varchar('payment_method', { length: 50 }),
    paymentGatewayRef: varchar('payment_gateway_ref', { length: 255 }),
    idempotencyKey: varchar('idempotency_key', { length: 255 }).notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    // Refund sizing, escrow-balance and payout summaries filter by these FKs,
    // none of which Postgres indexes for us.
    index('idx_transactions_project').on(table.projectId),
    index('idx_transactions_milestone').on(table.milestoneId),
    index('idx_transactions_talent').on(table.talentId),
    // The daily revenue panel sums by (status, type) inside a per-day range.
    // Nothing indexed status, type or created_at, so each of the 30 LATERAL
    // iterations scanned the table.
    index('idx_transactions_status_type_created').on(table.status, table.type, table.createdAt),
  ],
)

export const transactionEvents = pgTable('transaction_events', {
  id: text('id').primaryKey(),
  transactionId: text('transaction_id')
    .notNull()
    .references(() => transactions.id),
  eventType: transactionEventTypeEnum('event_type').notNull(),
  previousStatus: transactionStatusEnum('previous_status'),
  newStatus: transactionStatusEnum('new_status').notNull(),
  amount: integer('amount'),
  metadata: jsonb('metadata'),
  performedBy: text('performed_by')
    .notNull()
    .references(() => user.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

/**
 * One account per owner, enforced by the database rather than by a
 * read-then-insert: concurrent settlements for the same project used to create
 * two escrow rows, splitting the balance so payouts failed on money that was
 * in the ledger. owner_id is null for the platform account, and a plain unique
 * index treats nulls as distinct, so the null case needs its own partial index.
 */
export const accounts = pgTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    ownerType: accountOwnerTypeEnum('owner_type').notNull(),
    ownerId: text('owner_id'),
    accountType: accountTypeEnum('account_type').notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    balance: integer('balance').default(0).notNull(),
    currency: varchar('currency', { length: 3 }).default('IDR').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_accounts_owner')
      .on(table.ownerType, table.ownerId)
      .where(sql`owner_id IS NOT NULL`),
    uniqueIndex('uq_accounts_owner_platform').on(table.ownerType).where(sql`owner_id IS NULL`),
  ],
)

export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: text('id').primaryKey(),
    transactionId: text('transaction_id')
      .notNull()
      .references(() => transactions.id),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),
    entryType: ledgerEntryTypeEnum('entry_type').notNull(),
    amount: integer('amount').notNull(),
    description: text('description'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // Balance is sum(entries) per account; audit reads every leg of a txn.
    index('idx_ledger_account_created').on(table.accountId, table.createdAt),
    index('idx_ledger_transaction').on(table.transactionId),
  ],
)

export const invoiceAudienceEnum = pgEnum('invoice_audience', ['owner', 'talent', 'admin'])

/**
 * One invoice number per milestone, one row per audience. The number is
 * shared so the owner, talent and admin copies of a settlement reconcile
 * against each other; uniqueness therefore lives on (milestone, audience)
 * rather than on the number itself.
 */
export const projectInvoices = pgTable(
  'project_invoices',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    milestoneId: text('milestone_id')
      .notNull()
      .references(() => milestones.id),
    invoiceNumber: text('invoice_number').notNull(),
    pdfUrl: text('pdf_url').notNull(),
    audience: invoiceAudienceEnum('audience').notNull(),
    generatedAt: timestamp('generated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_project_invoices_milestone_audience').on(table.milestoneId, table.audience),
    index('idx_project_invoices_project').on(table.projectId),
  ],
)

export const talentPlacementRequests = pgTable(
  'talent_placement_requests',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id),
    talentId: text('talent_id')
      .notNull()
      .references(() => talentProfiles.id),
    status: talentPlacementStatusEnum('status').default('requested').notNull(),
    estimatedAnnualSalary: integer('estimated_annual_salary'),
    conversionFeePercentage: real('conversion_fee_percentage'),
    conversionFeeAmount: integer('conversion_fee_amount'),
    transactionId: text('transaction_id').references(() => transactions.id),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  // One live request per pair. Declined is excluded so a talent who said no
  // once can be approached again later.
  (table) => [
    uniqueIndex('talent_placement_live_unique')
      .on(table.projectId, table.talentId)
      .where(sql`status <> 'declined'`),
  ],
)
