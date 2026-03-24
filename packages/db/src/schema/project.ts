import {
  boolean,
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

export const projectCategoryEnum = pgEnum('project_category', [
  'web_app',
  'mobile_app',
  'ui_ux_design',
  'data_ai',
  'other_digital',
])
export const projectStatusEnum = pgEnum('project_status', [
  'draft',
  'scoping',
  'brd_generated',
  'brd_approved',
  'brd_purchased',
  'prd_generated',
  'prd_approved',
  'prd_purchased',
  'matching',
  'team_forming',
  'matched',
  'in_progress',
  'partially_active',
  'review',
  'completed',
  'cancelled',
  'disputed',
  'on_hold',
])
export const documentStatusEnum = pgEnum('document_status', ['draft', 'review', 'approved', 'paid'])
export const applicationStatusEnum = pgEnum('application_status', [
  'pending',
  'accepted',
  'rejected',
  'withdrawn',
])
export const workPackageStatusEnum = pgEnum('work_package_status', [
  'unassigned',
  'pending_acceptance',
  'assigned',
  'declined',
  'in_progress',
  'completed',
  'terminated',
])
export const assignmentStatusEnum = pgEnum('assignment_status', [
  'active',
  'completed',
  'terminated',
  'replaced',
])
export const acceptanceStatusEnum = pgEnum('acceptance_status', ['pending', 'accepted', 'declined'])
export const milestoneStatusEnum = pgEnum('milestone_status', [
  'pending',
  'in_progress',
  'submitted',
  'revision_requested',
  'approved',
  'rejected',
])
export const milestoneTypeEnum = pgEnum('milestone_type', ['individual', 'integration'])
export const taskStatusEnum = pgEnum('task_status', ['pending', 'in_progress', 'completed'])
export const dependencyTypeEnum = pgEnum('dependency_type', [
  'finish_to_start',
  'start_to_start',
  'finish_to_finish',
])
export const contractTypeEnum = pgEnum('contract_type', ['standard_nda', 'ip_transfer'])
export const disputeStatusEnum = pgEnum('dispute_status', [
  'open',
  'under_review',
  'mediation',
  'resolved',
  'escalated',
])
export const resolutionTypeEnum = pgEnum('resolution_type', [
  'funds_to_talent',
  'funds_to_owner',
  'split',
])
export const chatConversationTypeEnum = pgEnum('chat_conversation_type', [
  'ai_scoping',
  'owner_talent',
  'team_group',
  'talent_talent',
  'admin_mediation',
])
export const senderTypeEnum = pgEnum('sender_type', ['user', 'ai', 'system'])
export const chatParticipantRoleEnum = pgEnum('chat_participant_role', ['member', 'moderator'])
export const activityTypeEnum = pgEnum('activity_type', [
  'message_sent',
  'milestone_submitted',
  'milestone_approved',
  'milestone_rejected',
  'revision_requested',
  'payment_made',
  'payment_released',
  'file_uploaded',
  'status_changed',
  'talent_assigned',
  'talent_replaced',
  'talent_declined',
  'team_formed',
  'review_posted',
  'dispute_opened',
  'dispute_resolved',
  'project_on_hold',
  'project_resumed',
])
export const revisionSeverityEnum = pgEnum('revision_severity', ['minor', 'moderate', 'major'])
export const revisionRequestStatusEnum = pgEnum('revision_request_status', [
  'pending',
  'accepted',
  'in_progress',
  'completed',
  'declined',
])

export const projects = pgTable('projects', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id')
    .notNull()
    .references(() => user.id),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description').notNull(),
  category: projectCategoryEnum('category').notNull(),
  status: projectStatusEnum('status').default('draft').notNull(),
  budgetMin: integer('budget_min').notNull(),
  budgetMax: integer('budget_max').notNull(),
  estimatedTimelineDays: integer('estimated_timeline_days').notNull(),
  teamSize: integer('team_size').default(1).notNull(),
  finalPrice: integer('final_price'),
  platformFee: integer('platform_fee'),
  talentPayout: integer('talent_payout'),
  preferences: jsonb('preferences'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
})

export const projectStatusLogs = pgTable('project_status_logs', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  fromStatus: projectStatusEnum('from_status'),
  toStatus: projectStatusEnum('to_status').notNull(),
  changedBy: text('changed_by')
    .notNull()
    .references(() => user.id),
  reason: text('reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const chatConversations = pgTable('chat_conversations', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  type: chatConversationTypeEnum('type').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const chatParticipants = pgTable(
  'chat_participants',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => chatConversations.id),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    joinedAt: timestamp('joined_at', { withTimezone: true }).defaultNow().notNull(),
    leftAt: timestamp('left_at', { withTimezone: true }),
    role: chatParticipantRoleEnum('role').default('member').notNull(),
  },
  (table) => [uniqueIndex('chat_participants_unique').on(table.conversationId, table.userId)],
)

export const chatMessages = pgTable(
  'chat_messages',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => chatConversations.id),
    senderType: senderTypeEnum('sender_type').notNull(),
    senderId: text('sender_id').references(() => user.id),
    content: text('content').notNull(),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('idx_chat_messages_conv_created').on(table.conversationId, table.createdAt)],
)

export const projectActivities = pgTable('project_activities', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  userId: text('user_id').references(() => user.id),
  type: activityTypeEnum('type').notNull(),
  title: varchar('title', { length: 500 }).notNull(),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const brdDocuments = pgTable('brd_documents', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .unique()
    .references(() => projects.id),
  content: jsonb('content').notNull(),
  version: integer('version').default(1).notNull(),
  status: documentStatusEnum('status').default('draft').notNull(),
  price: integer('price').notNull(),
  // embedding: vector('embedding', { dimensions: 1536 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const prdDocuments = pgTable('prd_documents', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .unique()
    .references(() => projects.id),
  content: jsonb('content').notNull(),
  version: integer('version').default(1).notNull(),
  status: documentStatusEnum('status').default('draft').notNull(),
  price: integer('price').notNull(),
  // embedding: vector('embedding', { dimensions: 1536 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const projectApplications = pgTable(
  'project_applications',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    talentId: text('talent_id')
      .notNull()
      .references(() => talentProfiles.id),
    status: applicationStatusEnum('status').default('pending').notNull(),
    coverNote: text('cover_note'),
    recommendationScore: real('recommendation_score'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('project_applications_unique').on(table.projectId, table.talentId)],
)

export const workPackages = pgTable(
  'work_packages',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description').notNull(),
    orderIndex: integer('order_index').notNull(),
    requiredSkills: jsonb('required_skills').notNull(),
    estimatedHours: real('estimated_hours').notNull(),
    amount: integer('amount').notNull(),
    talentPayout: integer('talent_payout').notNull(),
    status: workPackageStatusEnum('status').default('unassigned').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('idx_work_packages_project_status').on(table.projectId, table.status)],
)

export const projectAssignments = pgTable('project_assignments', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  talentId: text('talent_id')
    .notNull()
    .references(() => talentProfiles.id),
  workPackageId: text('work_package_id')
    .notNull()
    .references(() => workPackages.id),
  applicationId: text('application_id').references(() => projectApplications.id),
  roleLabel: varchar('role_label', { length: 100 }),
  acceptanceStatus: acceptanceStatusEnum('acceptance_status').default('pending').notNull(),
  status: assignmentStatusEnum('status').default('active').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const contracts = pgTable('contracts', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  assignmentId: text('assignment_id')
    .notNull()
    .references(() => projectAssignments.id),
  type: contractTypeEnum('type').notNull(),
  content: jsonb('content').notNull(),
  signedByOwner: boolean('signed_by_owner').default(false).notNull(),
  signedByTalent: boolean('signed_by_talent').default(false).notNull(),
  signedAt: timestamp('signed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const disputes = pgTable('disputes', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  workPackageId: text('work_package_id').references(() => workPackages.id),
  initiatedBy: text('initiated_by')
    .notNull()
    .references(() => user.id),
  againstUserId: text('against_user_id')
    .notNull()
    .references(() => user.id),
  reason: text('reason').notNull(),
  evidenceUrls: jsonb('evidence_urls'),
  status: disputeStatusEnum('status').default('open').notNull(),
  resolution: text('resolution'),
  resolutionType: resolutionTypeEnum('resolution_type'),
  resolvedBy: text('resolved_by').references(() => user.id),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const milestones = pgTable(
  'milestones',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    workPackageId: text('work_package_id').references(() => workPackages.id),
    assignedTalentId: text('assigned_talent_id').references(() => talentProfiles.id),
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description').notNull(),
    milestoneType: milestoneTypeEnum('milestone_type').default('individual').notNull(),
    orderIndex: integer('order_index').notNull(),
    amount: integer('amount').notNull(),
    status: milestoneStatusEnum('status').default('pending').notNull(),
    revisionCount: integer('revision_count').default(0).notNull(),
    dueDate: timestamp('due_date', { withTimezone: true }).notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('idx_milestones_project_status').on(table.projectId, table.status)],
)

export const milestoneFiles = pgTable('milestone_files', {
  id: text('id').primaryKey(),
  milestoneId: text('milestone_id')
    .notNull()
    .references(() => milestones.id),
  fileName: varchar('file_name', { length: 255 }).notNull(),
  fileUrl: text('file_url').notNull(),
  fileSize: integer('file_size').notNull(),
  mimeType: varchar('mime_type', { length: 100 }).notNull(),
  uploadedBy: text('uploaded_by')
    .notNull()
    .references(() => user.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const milestoneComments = pgTable('milestone_comments', {
  id: text('id').primaryKey(),
  milestoneId: text('milestone_id')
    .notNull()
    .references(() => milestones.id),
  userId: text('user_id')
    .notNull()
    .references(() => user.id),
  content: text('content').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const revisionRequests = pgTable('revision_requests', {
  id: text('id').primaryKey(),
  milestoneId: text('milestone_id')
    .notNull()
    .references(() => milestones.id),
  requestedBy: text('requested_by')
    .notNull()
    .references(() => user.id),
  description: text('description').notNull(),
  severity: revisionSeverityEnum('severity').notNull(),
  isPaid: boolean('is_paid').default(false).notNull(),
  feeAmount: integer('fee_amount'),
  feeTransactionId: text('fee_transaction_id'),
  status: revisionRequestStatusEnum('status').default('pending').notNull(),
  talentResponse: text('talent_response'),
  requestedAt: timestamp('requested_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const tasks = pgTable('tasks', {
  id: text('id').primaryKey(),
  milestoneId: text('milestone_id')
    .notNull()
    .references(() => milestones.id),
  assignedTalentId: text('assigned_talent_id').references(() => talentProfiles.id),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description'),
  orderIndex: integer('order_index').notNull(),
  status: taskStatusEnum('status').default('pending').notNull(),
  estimatedHours: real('estimated_hours'),
  actualHours: real('actual_hours'),
  startDate: timestamp('start_date', { withTimezone: true }),
  endDate: timestamp('end_date', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const taskDependencies = pgTable(
  'task_dependencies',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id),
    dependsOnTaskId: text('depends_on_task_id')
      .notNull()
      .references(() => tasks.id),
    type: dependencyTypeEnum('type').default('finish_to_start').notNull(),
  },
  (table) => [uniqueIndex('task_dependencies_unique').on(table.taskId, table.dependsOnTaskId)],
)

export const workPackageDependencies = pgTable(
  'work_package_dependencies',
  {
    id: text('id').primaryKey(),
    workPackageId: text('work_package_id')
      .notNull()
      .references(() => workPackages.id),
    dependsOnWorkPackageId: text('depends_on_work_package_id')
      .notNull()
      .references(() => workPackages.id),
    type: dependencyTypeEnum('type').default('finish_to_start').notNull(),
  },
  (table) => [
    uniqueIndex('work_package_dependencies_unique').on(
      table.workPackageId,
      table.dependsOnWorkPackageId,
    ),
  ],
)

export const timeLogs = pgTable('time_logs', {
  id: text('id').primaryKey(),
  taskId: text('task_id')
    .notNull()
    .references(() => tasks.id),
  talentId: text('talent_id')
    .notNull()
    .references(() => talentProfiles.id),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  durationMinutes: integer('duration_minutes'),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})
