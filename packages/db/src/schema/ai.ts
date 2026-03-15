import { integer, numeric, pgEnum, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core'
import { user } from './better-auth'
import { projects } from './project'

export const aiInteractionTypeEnum = pgEnum('ai_interaction_type', [
  'chatbot',
  'brd_generation',
  'prd_generation',
  'cv_parsing',
  'matching',
  'embedding',
])
export const aiInteractionStatusEnum = pgEnum('ai_interaction_status', [
  'success',
  'error',
  'timeout',
])

export const aiInteractions = pgTable('ai_interactions', {
  id: text('id').primaryKey(),
  projectId: text('project_id').references(() => projects.id),
  userId: text('user_id').references(() => user.id),
  interactionType: aiInteractionTypeEnum('interaction_type').notNull(),
  model: varchar('model', { length: 100 }).notNull(),
  promptTokens: integer('prompt_tokens').notNull(),
  completionTokens: integer('completion_tokens').notNull(),
  latencyMs: integer('latency_ms').notNull(),
  costUsd: numeric('cost_usd', { precision: 10, scale: 6 }),
  status: aiInteractionStatusEnum('status').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})
