import { sql } from 'drizzle-orm'
import {
  bigint,
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
  vector,
} from 'drizzle-orm/pg-core'

// Money columns are `bigint` with `mode: 'number'` (see payment.ts); counts,
// versions, indexes and durations stay `integer`.
import { talentProfiles } from './auth'
import { user } from './better-auth'
import { transactions } from './payment'

export const projectCategoryEnum = pgEnum('project_category', [
  'web_app',
  'mobile_app',
  'ui_ux_design',
  'data_ai',
  'other_digital',
])
export const projectTypeEnum = pgEnum('project_type', ['individual', 'company'])
export const projectVisibilityEnum = pgEnum('project_visibility', [
  'private',
  'public_summary',
  'public_detail',
])
/**
 * Where a project sits on its one linear path, and nothing else.
 *
 * Eighteen values used to encode three different things at once: the position
 * (draft -> scoping -> ...), whether a document had been bought
 * (brd_purchased, prd_purchased) and whether something was wrong right now
 * (disputed, on_hold). The first is a position and belongs here; the other two
 * are facts that can be true at any position, and encoding them as positions
 * meant a disputed project forgot where it was and a purchase could strand a
 * project in a status with no forward edge.
 *
 * So: nine positions. Purchase is read from brd_documents/prd_documents.paid_at
 * and the transactions ledger. A live dispute is
 * EXISTS(disputes WHERE project_id = ? AND resolved_at IS NULL). A hold is
 * projects.on_hold_at. All three compose with the position instead of
 * replacing it.
 */
export const projectStatusEnum = pgEnum('project_status', [
  'draft',
  'scoping',
  'brd_review',
  'prd_review',
  'matching',
  'in_progress',
  'final_review',
  'completed',
  'cancelled',
])
// A document's own position: written, waiting to be read, signed off. Payment
// is not one of them - it is `paid_at` and the ledger row, and 'paid' only ever
// meant an approved document the owner had also bought, so it said one thing
// the column already knew and hid another the column could not tell.
export const documentStatusEnum = pgEnum('document_status', ['draft', 'review', 'approved'])
export const applicationStatusEnum = pgEnum('application_status', [
  'pending',
  'accepted',
  'rejected',
  'withdrawn',
])
// Five positions on the staffing line: open -> offered -> staffed ->
// in_progress -> completed. 'declined' and 'terminated' were not positions but
// exits, and both put the package back where 'unassigned' already sat: nobody
// holds it and the owner may offer it again. Three names for one pool is what
// let the read sets disagree - matching offered from ('unassigned') while
// applications and the browse feed picked from ('unassigned','declined').
export const workPackageStatusEnum = pgEnum('work_package_status', [
  'open',
  'offered',
  'staffed',
  'in_progress',
  'completed',
])
// Four positions on one column. An assignment used to carry two: `status`
// (active/completed/terminated/replaced) and `acceptance_status`
// (pending/accepted/declined). Twelve combinations, three of which ever
// occurred, and the pair that mattered - active+pending - was the one the word
// 'active' hid: an offer nobody had answered read as live work everywhere the
// acceptance column was not also consulted. 'offered' says it in one place.
// 'ended' absorbs terminated, declined and the never-written 'replaced';
// how an assignment ended is the event that ended it, not a position.
export const assignmentStatusEnum = pgEnum('assignment_status', [
  'offered',
  'active',
  'completed',
  'ended',
])
// Five positions. 'rejected' and 'revision_requested' were one outcome wearing
// two names: both send the submitted work back, both spend a revision round,
// both leave the milestone waiting on the talent. The owner still says what is
// wrong in the milestone thread; the status only says the work was not taken.
export const milestoneStatusEnum = pgEnum('milestone_status', [
  'pending',
  'in_progress',
  'submitted',
  'changes_requested',
  'approved',
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

export const projects = pgTable(
  'projects',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id),
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description').notNull(),
    category: projectCategoryEnum('category').notNull(),
    status: projectStatusEnum('status').default('draft').notNull(),
    budgetMin: bigint('budget_min', { mode: 'number' }).notNull(),
    budgetMax: bigint('budget_max', { mode: 'number' }).notNull(),
    estimatedTimelineDays: integer('estimated_timeline_days').notNull(),
    teamSize: integer('team_size').default(1).notNull(),
    finalPrice: bigint('final_price', { mode: 'number' }),
    platformFee: bigint('platform_fee', { mode: 'number' }),
    talentPayout: bigint('talent_payout', { mode: 'number' }),
    projectType: projectTypeEnum('project_type').default('individual').notNull(),
    companyName: varchar('company_name', { length: 255 }),
    companyRole: varchar('company_role', { length: 255 }),
    progress: integer('progress').default(0).notNull(),
    completenessScore: integer('completeness_score').default(0).notNull(),
    /**
     * Set while the project is paused, cleared when it resumes.
     *
     * `on_hold` used to be a status, which meant a paused project forgot the
     * position it was paused at and had to be guessed back out of the status
     * log on resume. A hold is orthogonal to the position: a project on hold
     * is still in_progress, it is just not moving.
     */
    onHoldAt: timestamp('on_hold_at', { withTimezone: true }),
    /**
     * When every position on the project was first accepted.
     *
     * `matched` used to be a status, and the stalled-start sweep measured from
     * the log entry that wrote it. With matching/team_forming/matched collapsed
     * into one position that entry no longer identifies the moment, so the
     * moment is a column. Null means the team is not complete yet.
     */
    teamCompletedAt: timestamp('team_completed_at', { withTimezone: true }),
    // Set when the owner was told a matched project has not started.
    startReminderAt: timestamp('start_reminder_at', { withTimezone: true }),
    // Set when the owner was told an approved PRD is still waiting on them.
    decisionReminderAt: timestamp('decision_reminder_at', { withTimezone: true }),
    documentFileUrl: text('document_file_url'),
    documentType: varchar('document_type', { length: 10 }),
    visibility: projectVisibilityEnum('visibility').default('public_summary').notNull(),
    preferences: jsonb('preferences'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    /**
     * The browse routes filter on status and visibility and then order by
     * created_at before OFFSET applies, so the ordering is the expensive half.
     *
     * This led with (status, visibility) and claimed to supply that ordering.
     * It cannot: both routes use IN-lists, and a btree scan over a
     * ScalarArrayOpExpr does not preserve the ordering of trailing columns, so
     * a Sort over every matching row still ran before the LIMIT. created_at
     * leads here instead, and the filter moves into the index predicate.
     *
     * The status set is the wider of the two routes (/projects/public);
     * /projects/available asks for a subset of it, so the predicate still
     * holds for both.
     *
     * A hold is a column now, so `on_hold_at IS NULL` keeps paused projects
     * out of browse the way the old `on_hold` status did. The matching
     * dispute guard cannot live here - Postgres rejects a subquery in an
     * index predicate - so the browse queries carry
     * `NOT EXISTS (disputes ... resolved_at IS NULL)` themselves.
     */
    index('idx_projects_browse')
      .on(table.createdAt.desc())
      .where(
        sql`deleted_at IS NULL
          AND visibility IN ('public_summary', 'public_detail')
          AND status IN ('matching', 'in_progress', 'final_review', 'completed')
          AND on_hold_at IS NULL`,
      ),
    // The owner dashboard lists by owner on every page load.
    index('idx_projects_owner').on(table.ownerId),
    /**
     * The admin revenue panel sums platform_fee one day at a time
     * (admin-service GetDailyRevenue, 30 LATERAL iterations by default).
     * idx_projects_browse cannot serve it: that index is partial on visibility
     * and status, so every iteration fell back to a sequential scan of the
     * whole table. Unpartitioned created_at makes the day a range boundary;
     * deleted_at then filters one day's rows, which costs nothing.
     */
    index('idx_projects_created').on(table.createdAt),
  ],
)

export const projectStatusLogs = pgTable(
  'project_status_logs',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    fromStatus: projectStatusEnum('from_status'),
    toStatus: projectStatusEnum('to_status').notNull(),
    /**
     * The literals this row was written with, before project_status went from
     * eighteen values to nine.
     *
     * Postgres cannot keep a dropped enum value, and the collapse is lossy:
     * brd_generated -> brd_approved becomes brd_review -> brd_review, which
     * reads as a self-loop and says nothing. These two hold the original text
     * so the audit trail survives the swap. Null on every row written after
     * it; the typed columns are the ones to read.
     */
    fromStatusLegacy: text('from_status_legacy'),
    toStatusLegacy: text('to_status_legacy'),
    // Null means the platform did it, not a person. The escrow settlement and
    // the auto-release sweep transition projects with no user behind them, and
    // the literal 'system' violated this foreign key.
    changedBy: text('changed_by').references(() => user.id),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    /**
     * Only the primary key existed, so every reader of this table scanned all
     * of it. Three of them matter: the status timeline
     * (ProjectRepository.getStatusLogs) and the two hourly sweeps, whose
     * `max(created_at) WHERE project_id = …` subquery runs once per candidate
     * project - at 100k projects that measured 70s and 129s per run.
     *
     * Ascending, not created_at.desc(): drizzle emits DESC NULLS LAST for a
     * descending index column but plain DESC (NULLS FIRST) in an ORDER BY, and
     * the two orderings are not interchangeable to the planner. A backward
     * scan of the ascending index is what the existing ORDER BY asks for.
     *
     * to_status is deliberately not a third column: it is a status enum
     * literal, and those belong to the pending status consolidation. The
     * sweeps therefore seek by project and filter to_status in the scan.
     */
    index('idx_project_status_logs_project_created').on(table.projectId, table.createdAt),
  ],
)

export const chatConversations = pgTable(
  'chat_conversations',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    type: chatConversationTypeEnum('type').notNull(),
    // The private thread belongs to one assignment; the other types do not.
    assignmentId: text('assignment_id').references(() => projectAssignments.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  // One AI scoping thread per project, one group thread per project, one
  // private thread per assignment. Partial, because admin_mediation is
  // legitimately many per project.
  (table) => [
    uniqueIndex('chat_conversations_scoping_unique')
      .on(table.projectId)
      .where(sql`type = 'ai_scoping'`),
    uniqueIndex('chat_conversations_assignment_unique')
      .on(table.assignmentId)
      .where(sql`type = 'owner_talent'`),
    uniqueIndex('chat_conversations_team_group_unique')
      .on(table.projectId)
      .where(sql`type = 'team_group'`),
  ],
)

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
    role: chatParticipantRoleEnum('role').default('member').notNull(),
  },
  (table) => [
    uniqueIndex('chat_participants_unique').on(table.conversationId, table.userId),
    // "My conversations" filters on user_id alone, which is the trailing column
    // of the unique above and so cannot be sought. The result feeds an IN-list
    // for the conversation read, so without this the whole chat list degraded
    // with platform-wide participation rows rather than with the user's own.
    index('idx_chat_participants_user').on(table.userId),
  ],
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

export const projectActivities = pgTable(
  'project_activities',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    userId: text('user_id').references(() => user.id),
    type: activityTypeEnum('type').notNull(),
    title: varchar('title', { length: 500 }).notNull(),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    /**
     * Primary key only, and the activity feed sits on the authenticated
     * dashboard - so every page load scanned the whole table twice, once for
     * the page and once for its count(*).
     *
     * The per-project route and both counts seek straight into this index. The
     * cross-project feed filters with an IN-list, so a btree scan over the
     * ScalarArrayOpExpr does not preserve the created_at ordering and a Sort
     * still runs - but over one user's activities instead of the platform's.
     */
    index('idx_project_activities_project_created').on(table.projectId, table.createdAt),
  ],
)

export const brdDocuments = pgTable('brd_documents', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .unique()
    .references(() => projects.id),
  content: jsonb('content').notNull(),
  version: integer('version').default(1).notNull(),
  status: documentStatusEnum('status').default('draft').notNull(),
  price: bigint('price', { mode: 'number' }).notNull(),
  // Paid unlock: download without watermark and revisions up to nine.
  paidAt: timestamp('paid_at', { withTimezone: true }),
  // Set while a generation holds this row's version, cleared when it lands.
  // Without it an abandoned revision is indistinguishable from a finished one,
  // so a process killed mid-generation spent the slot forever. Null on every
  // pre-existing row, and the reclaim requires it to be set.
  generationClaimedAt: timestamp('generation_claimed_at', { withTimezone: true }),
  embedding: vector('embedding', { dimensions: 1024 }),
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
  /**
   * When the owner approved this PRD.
   *
   * The stalled-decision sweep measured from the log entry that wrote
   * `prd_approved`, a status that no longer exists on its own - prd_review
   * spans generated, approved and purchased. `updated_at` cannot stand in: a
   * revision moves it and would reset the owner's deadline. The BRD has no
   * such column because nothing measures from a BRD approval.
   */
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  price: bigint('price', { mode: 'number' }).notNull(),
  // Paid unlock: download without watermark and revisions up to nine.
  paidAt: timestamp('paid_at', { withTimezone: true }),
  // Set while a generation holds this row's version, cleared when it lands.
  // Without it an abandoned revision is indistinguishable from a finished one,
  // so a process killed mid-generation spent the slot forever. Null on every
  // pre-existing row, and the reclaim requires it to be set.
  generationClaimedAt: timestamp('generation_claimed_at', { withTimezone: true }),
  embedding: vector('embedding', { dimensions: 1024 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const documentChunkTypeEnum = pgEnum('document_chunk_type', ['brd', 'prd'])

/**
 * One retrievable section of a BRD or PRD.
 *
 * The embedding columns on brd_documents and prd_documents hold one vector per
 * whole document, which averages an executive summary, a price estimate and
 * every functional requirement into a single 1024-float point. A query about
 * one feature then competes with the entire document and the section that
 * answers it never stands out. Chunks are the unit retrieval actually wants.
 *
 * projectId is denormalised from the parent document on purpose. The vector
 * arm of hybrid_search carries a tenant predicate, and that predicate is
 * access control rather than a filter: an unscoped search once spliced every
 * owner's BRD into other owners' scoping prompts. Joining back to the document
 * table on every candidate row to recover the owner would put that check
 * behind a join it can silently lose.
 */
export const documentChunks = pgTable(
  'document_chunks',
  {
    id: text('id').primaryKey(),
    documentId: text('document_id').notNull(),
    documentType: documentChunkTypeEnum('document_type').notNull(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    sectionTitle: text('section_title').notNull(),
    sectionOrder: integer('section_order').notNull(),
    content: text('content').notNull(),
    embedding: vector('embedding', { dimensions: 1024 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // Rewriting a document replaces its chunks, so the pair has to be unique.
    uniqueIndex('document_chunks_doc_order_unique').on(table.documentId, table.sectionOrder),
    index('idx_document_chunks_document').on(table.documentId),
    index('idx_document_chunks_project').on(table.projectId),
    // Two more indexes exist on this table and are NOT declared here, because
    // drizzle cannot express either: document_chunks_embedding_hnsw_idx (hnsw,
    // vector_cosine_ops, m=16 ef_construction=200) and
    // idx_document_chunks_content_fts (gin over to_tsvector). Both are created
    // by migration 0037 and both are load bearing -- they are the vector and
    // BM25 arms of hybrid_search, and without them every scoping message
    // sequentially scans the table. They are absent from the drizzle snapshot,
    // so `generate` will not drop them, but `push` would. Do not use push here.
  ],
)

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
  (table) => [
    // Partial: only a live application claims the pair. Without the predicate,
    // withdrawing was irreversible, because the withdrawn row kept the slot and
    // the handler's own check had already been narrowed to live statuses.
    uniqueIndex('project_applications_unique')
      .on(table.projectId, table.talentId)
      .where(sql`status IN ('pending', 'accepted')`),
    /**
     * The talent dashboard's own application list filters on talent_id and
     * orders by created_at. Neither half of the unique above serves it:
     * talent_id is the trailing column, and the list deliberately includes the
     * rejected and withdrawn rows that the partial predicate excludes.
     */
    index('idx_project_applications_talent_created').on(table.talentId, table.createdAt),
  ],
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
    amount: bigint('amount', { mode: 'number' }).notNull(),
    talentPayout: bigint('talent_payout', { mode: 'number' }).notNull(),
    status: workPackageStatusEnum('status').default('open').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('idx_work_packages_project_status').on(table.projectId, table.status)],
)

export const projectAssignments = pgTable(
  'project_assignments',
  {
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
    // Offered is the default because the row is written when the owner asks,
    // not when the talent answers - which is what active+pending meant.
    status: assignmentStatusEnum('status').default('offered').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  // One live talent per work package, enforced by the database rather than
  // only by the matching-confirm code path.
  (table) => [
    uniqueIndex('uq_project_assignments_wp_live')
      .on(table.projectId, table.workPackageId)
      // 'offered' is in the predicate because it used to be in 'active': an
      // unanswered offer held the package before the collapse and must keep
      // holding it, or two talents can be offered the same position at once.
      .where(sql`status IN ('offered', 'active', 'completed')`),
    // findEligibleTalents counts a talent's active and completed assignments
    // with two correlated subqueries per candidate row. A foreign key gives
    // Postgres no access path on its own, so both scanned the whole table
    // once per talent - work growing as talents x assignments.
    index('idx_project_assignments_talent_status').on(table.talentId, table.status),
  ],
)

export const contracts = pgTable(
  'contracts',
  {
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
    // Bea Meterai 2020: a contract over Rp 5jt owes a Rp 10.000 stamp. The
    // platform is not a registered meterai distributor, so the parties affix it
    // themselves at e-meterai.co.id and upload the stamped copy back; these track
    // that. meterai_required is set from the project value at generation.
    meteraiRequired: boolean('meterai_required').default(false).notNull(),
    meteraiDocumentUrl: text('meterai_document_url'),
    meteraiAffixedAt: timestamp('meterai_affixed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  // One NDA and one IP transfer per assignment. The route checks first, but
  // two concurrent creates both pass that check.
  (table) => [uniqueIndex('contracts_assignment_type_unique').on(table.assignmentId, table.type)],
)

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
    amount: bigint('amount', { mode: 'number' }).notNull(),
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

export const revisionRequests = pgTable(
  'revision_requests',
  {
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
    feeAmount: bigint('fee_amount', { mode: 'number' }),
    feeTransactionId: text('fee_transaction_id').references(() => transactions.id),
    status: revisionRequestStatusEnum('status').default('pending').notNull(),
    talentResponse: text('talent_response'),
    requestedAt: timestamp('requested_at', { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // One paid credit per payment. Partial, because the free revisions carry
    // no transaction and are legitimately many per milestone.
    uniqueIndex('revision_requests_fee_transaction_unique')
      .on(table.feeTransactionId)
      .where(sql`fee_transaction_id is not null`),
    // consumePaidRevisionCredit filters this under FOR UPDATE on every
    // revision; the table had no index.
    index('idx_revision_requests_milestone').on(table.milestoneId, table.status),
  ],
)

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

export const timeLogs = pgTable(
  'time_logs',
  {
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
  },
  // One row per timer stop per talent, so this grows faster than anything
  // else here - CLAUDE.md already earmarks it for monthly partitioning.
  // Both lookup shapes were unindexed foreign keys.
  (table) => [
    index('idx_time_logs_talent_started').on(table.talentId, table.startedAt.desc()),
    index('idx_time_logs_task').on(table.taskId),
    // One running timer per talent per task. POST /time-logs had no dedupe, so
    // two clicks left two open rows and the hours were counted twice. Partial
    // on ended_at because finished logs are legitimately many.
    uniqueIndex('time_logs_one_running_per_task')
      .on(table.taskId, table.talentId)
      .where(sql`ended_at IS NULL`),
  ],
)
