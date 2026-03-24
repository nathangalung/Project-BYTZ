import { boolean, integer, pgEnum, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core'
import { user } from './better-auth'
import { projects } from './project'

export const reviewTypeEnum = pgEnum('review_type', ['owner_to_talent', 'talent_to_owner'])
export const notificationTypeEnum = pgEnum('notification_type', [
  'project_match',
  'application_update',
  'milestone_update',
  'payment',
  'dispute',
  'team_formation',
  'assignment_offer',
  'system',
])

export const reviews = pgTable('reviews', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  reviewerId: text('reviewer_id')
    .notNull()
    .references(() => user.id),
  revieweeId: text('reviewee_id')
    .notNull()
    .references(() => user.id),
  rating: integer('rating').notNull(),
  comment: text('comment'),
  type: reviewTypeEnum('type').notNull(),
  isVisibleToReviewee: boolean('is_visible_to_reviewee').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const notifications = pgTable('notifications', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id),
  type: notificationTypeEnum('type').notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  message: text('message').notNull(),
  link: text('link'),
  isRead: boolean('is_read').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})
