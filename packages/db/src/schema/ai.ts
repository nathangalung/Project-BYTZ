import {
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core'
import { user } from './better-auth'
import { projects } from './project'

export const aiInteractionTypeEnum = pgEnum('ai_interaction_type', [
  'chatbot',
  'brd_generation',
  'prd_generation',
  'cv_parsing',
  'spec_parsing',
  'matching',
  'embedding',
])
export const aiInteractionStatusEnum = pgEnum('ai_interaction_status', [
  'success',
  'error',
  'timeout',
])

export const aiInteractions = pgTable(
  'ai_interactions',
  {
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
  },
  // The admin AI-cost panel scans this per day in the range and then again
  // grouped by model. The table had no index at all, and it grows once per
  // model call.
  (table) => [
    index('idx_ai_interactions_created').on(table.createdAt),
    index('idx_ai_interactions_model_created').on(table.model, table.createdAt),
  ],
)
