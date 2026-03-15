import { jsonb, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core'
import { user } from './better-auth'

export const adminAuditLogs = pgTable('admin_audit_logs', {
  id: text('id').primaryKey(),
  adminId: text('admin_id')
    .notNull()
    .references(() => user.id),
  action: varchar('action', { length: 100 }).notNull(),
  targetType: varchar('target_type', { length: 50 }).notNull(),
  targetId: text('target_id').notNull(),
  details: jsonb('details'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const platformSettings = pgTable('platform_settings', {
  id: text('id').primaryKey(),
  key: varchar('key', { length: 100 }).notNull().unique(),
  value: jsonb('value').notNull(),
  description: text('description'),
  updatedBy: text('updated_by').references(() => user.id),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})
