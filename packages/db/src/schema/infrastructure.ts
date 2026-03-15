import { boolean, integer, jsonb, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core'

export const outboxEvents = pgTable('outbox_events', {
  id: text('id').primaryKey(),
  aggregateType: varchar('aggregate_type', { length: 50 }).notNull(),
  aggregateId: text('aggregate_id').notNull(),
  eventType: varchar('event_type', { length: 100 }).notNull(),
  payload: jsonb('payload').notNull(),
  published: boolean('published').default(false).notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  retryCount: integer('retry_count').default(0).notNull(),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const deadLetterEvents = pgTable('dead_letter_events', {
  id: text('id').primaryKey(),
  originalEventId: varchar('original_event_id', { length: 255 }).notNull(),
  eventType: varchar('event_type', { length: 100 }).notNull(),
  payload: jsonb('payload').notNull(),
  consumerService: varchar('consumer_service', { length: 100 }).notNull(),
  errorMessage: text('error_message').notNull(),
  retryCount: integer('retry_count').notNull(),
  reprocessed: boolean('reprocessed').default(false).notNull(),
  reprocessedAt: timestamp('reprocessed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})
