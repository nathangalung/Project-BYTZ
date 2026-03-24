import {
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
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

export const transactions = pgTable('transactions', {
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
})

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

export const accounts = pgTable('accounts', {
  id: text('id').primaryKey(),
  ownerType: accountOwnerTypeEnum('owner_type').notNull(),
  ownerId: text('owner_id'),
  accountType: accountTypeEnum('account_type').notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  balance: integer('balance').default(0).notNull(),
  currency: varchar('currency', { length: 3 }).default('IDR').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const ledgerEntries = pgTable('ledger_entries', {
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
})

export const talentPlacementRequests = pgTable('talent_placement_requests', {
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
})
