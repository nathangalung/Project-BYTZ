import type { Database } from '@kerjacus/db'
import {
  disputes,
  milestones,
  prdDocuments,
  projectAssignments,
  projectStatusLogs,
  projects,
  talentProfiles,
  taskDependencies,
  tasks,
} from '@kerjacus/db'
import { PROJECT_SUBJECTS } from '@kerjacus/nats-events'
import { AppError, type ProjectCategory, type ProjectStatus } from '@kerjacus/shared'
import { and, desc, eq, inArray, isNull, ne, or, type SQL, sql } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { appendOutboxEvent } from '../lib/outbox'

type ProjectInsert = typeof projects.$inferInsert
/** Database atau transaksi yang sedang berjalan. */
type DbLike = Database | Parameters<Parameters<Database['transaction']>[0]>[0]

type ProjectSelect = typeof projects.$inferSelect

/**
 * Whether an unresolved dispute stands on the row.
 *
 * `disputed` was a status, so a reader looked at one column and lost the
 * position it overwrote. The dispute is a row in `disputes`, the position is
 * `status`, and a list that shows the badge needs both.
 */
export const IS_DISPUTED = sql<boolean>`EXISTS (
  SELECT 1 FROM ${disputes}
  WHERE ${disputes.projectId} = ${projects.id} AND ${disputes.resolvedAt} IS NULL
)`

/**
 * Browse hides a project that is paused or being argued over.
 *
 * on_hold and disputed were statuses, and leaving them out of the browse
 * status list was what hid these projects. They are conditions now, so the
 * hiding is explicit. Only the first half fits the partial index -
 * idx_projects_browse cannot carry the dispute check, because Postgres rejects
 * a subquery in an index predicate - so this is the query's half of it.
 */
export const BROWSEABLE = and(isNull(projects.onHoldAt), sql`NOT ${IS_DISPUTED}`) as SQL

/**
 * What GET /projects returns, named rather than inferred.
 *
 * Any signed-in user may call that route, and applyProjectVisibility removes
 * the owner-only columns per viewer - but only the ones someone thought to
 * name. `projects` gains columns over time, and a bare select ships each new
 * one to every signed-in user until somebody notices. Listing them makes
 * exposing a new column a decision instead of a default.
 *
 * The money and company columns stay in: the owner dashboard calls this route
 * filtered to its own projects, and the gate returns the row as stored to the
 * owner. deletedAt is the one omission - list() filters on it, so every row
 * carries the same null.
 */
const PROJECT_LIST_COLUMNS = {
  id: projects.id,
  ownerId: projects.ownerId,
  title: projects.title,
  description: projects.description,
  category: projects.category,
  status: projects.status,
  budgetMin: projects.budgetMin,
  budgetMax: projects.budgetMax,
  estimatedTimelineDays: projects.estimatedTimelineDays,
  teamSize: projects.teamSize,
  finalPrice: projects.finalPrice,
  platformFee: projects.platformFee,
  talentPayout: projects.talentPayout,
  projectType: projects.projectType,
  companyName: projects.companyName,
  companyRole: projects.companyRole,
  progress: projects.progress,
  completenessScore: projects.completenessScore,
  documentFileUrl: projects.documentFileUrl,
  documentType: projects.documentType,
  visibility: projects.visibility,
  preferences: projects.preferences,
  onHoldAt: projects.onHoldAt,
  isDisputed: IS_DISPUTED,
  createdAt: projects.createdAt,
  updatedAt: projects.updatedAt,
} as const

// The reminder marks and the team-complete stamp are sweep bookkeeping, not
// something a list reader shows.
type ProjectListItem = Omit<
  ProjectSelect,
  'deletedAt' | 'startReminderAt' | 'decisionReminderAt' | 'teamCompletedAt'
> & { isDisputed: boolean }
type StatusLogSelect = typeof projectStatusLogs.$inferSelect
type TaskSelect = typeof tasks.$inferSelect
type TaskDependencySelect = typeof taskDependencies.$inferSelect

export type ProjectFilters = {
  status?: ProjectStatus
  category?: ProjectCategory
  ownerId?: string
  /** Visibility gate, undefined skips it. */
  viewerId?: string
}

export type Pagination = {
  page: number
  pageSize: number
}

export class ProjectRepository {
  constructor(private db: Database) {}

  async findById(id: string): Promise<ProjectSelect | undefined> {
    const result = await this.db
      .select()
      .from(projects)
      .where(and(eq(projects.id, id), isNull(projects.deletedAt)))
      .limit(1)

    return result[0]
  }

  async findByOwnerId(
    ownerId: string,
    pagination: Pagination,
  ): Promise<{ items: ProjectListItem[]; total: number }> {
    const offset = (pagination.page - 1) * pagination.pageSize

    const conditions = and(eq(projects.ownerId, ownerId), isNull(projects.deletedAt))

    const [items, countResult] = await Promise.all([
      this.db
        .select(PROJECT_LIST_COLUMNS)
        .from(projects)
        .where(conditions)
        .orderBy(desc(projects.createdAt))
        .limit(pagination.pageSize)
        .offset(offset),
      this.db.select({ count: sql<number>`count(*)::int` }).from(projects).where(conditions),
    ])

    return {
      items,
      total: countResult[0]?.count ?? 0,
    }
  }

  async create(
    data: Omit<ProjectInsert, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ProjectSelect> {
    const id = uuidv7()
    const now = new Date()

    const result = await this.db
      .insert(projects)
      .values({
        ...data,
        id,
        createdAt: now,
        updatedAt: now,
      })
      .returning()

    if (!result[0]) throw new AppError('INTERNAL_ERROR', 'Project insert failed')
    return result[0]
  }

  async updateStatus(
    id: string,
    newStatus: ProjectStatus,
    // Null for a transition the platform made with no user behind it.
    changedBy: string | null,
    reason?: string,
  ): Promise<ProjectSelect | undefined> {
    return await this.db.transaction(async (tx) => {
      const current = await tx
        .select()
        .from(projects)
        .where(and(eq(projects.id, id), isNull(projects.deletedAt)))
        .limit(1)

      if (!current[0]) {
        return undefined
      }

      const fromStatus = current[0].status

      const [updated] = await tx
        .update(projects)
        .set({
          status: newStatus,
          updatedAt: new Date(),
        })
        .where(eq(projects.id, id))
        .returning()

      await tx.insert(projectStatusLogs).values({
        id: uuidv7(),
        projectId: id,
        fromStatus,
        toStatus: newStatus,
        changedBy,
        reason: reason ?? null,
      })

      await appendOutboxEvent(tx, {
        aggregateType: 'project',
        aggregateId: id,
        eventType: PROJECT_SUBJECTS.STATUS_CHANGED,
        payload: {
          projectId: id,
          fromStatus,
          toStatus: newStatus,
          changedBy,
          reason: reason ?? null,
        },
      })

      // Completion event drives owner notification.
      if (newStatus === 'completed') {
        await appendOutboxEvent(tx, {
          aggregateType: 'project',
          aggregateId: id,
          eventType: PROJECT_SUBJECTS.COMPLETED,
          payload: {
            projectId: id,
            ownerId: current[0].ownerId,
          },
        })
      }

      return updated
    })
  }

  async update(
    id: string,
    data: Partial<
      Pick<
        ProjectInsert,
        | 'title'
        | 'description'
        | 'category'
        | 'budgetMin'
        | 'budgetMax'
        | 'estimatedTimelineDays'
        | 'teamSize'
        | 'finalPrice'
        | 'platformFee'
        | 'talentPayout'
        | 'preferences'
      >
    >,
    // Dipakai saat harga proyek dan payout paket ditulis bersamaan.
    tx: DbLike = this.db,
  ): Promise<ProjectSelect | undefined> {
    const result = await tx
      .update(projects)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(and(eq(projects.id, id), isNull(projects.deletedAt)))
      .returning()

    return result[0]
  }

  async list(
    filters: ProjectFilters,
    pagination: Pagination,
  ): Promise<{ items: ProjectListItem[]; total: number }> {
    const offset = (pagination.page - 1) * pagination.pageSize

    const conditions: SQL[] = [isNull(projects.deletedAt)]

    if (filters.status) {
      conditions.push(eq(projects.status, filters.status))
    }
    if (filters.category) {
      conditions.push(eq(projects.category, filters.category))
    }
    if (filters.ownerId) {
      conditions.push(eq(projects.ownerId, filters.ownerId))
    }
    // Filter in SQL, keeps total honest. Third arm matches
    // applyProjectVisibility: an assigned talent is a participant,
    // so a private project they work on stays in their list.
    if (filters.viewerId !== undefined) {
      const gate = or(
        ne(projects.visibility, 'private'),
        eq(projects.ownerId, filters.viewerId),
        sql`EXISTS (
          SELECT 1 FROM ${projectAssignments}
          JOIN ${talentProfiles} ON ${talentProfiles.id} = ${projectAssignments.talentId}
          WHERE ${projectAssignments.projectId} = ${projects.id}
            AND ${talentProfiles.userId} = ${filters.viewerId}
        )`,
      )
      if (gate) conditions.push(gate)
    }

    const whereClause = and(...conditions)

    const [items, countResult] = await Promise.all([
      this.db
        .select(PROJECT_LIST_COLUMNS)
        .from(projects)
        .where(whereClause)
        .orderBy(desc(projects.createdAt))
        .limit(pagination.pageSize)
        .offset(offset),
      this.db.select({ count: sql<number>`count(*)::int` }).from(projects).where(whereClause),
    ])

    return {
      items,
      total: countResult[0]?.count ?? 0,
    }
  }

  async getStatusLogs(projectId: string): Promise<StatusLogSelect[]> {
    return await this.db
      .select()
      .from(projectStatusLogs)
      .where(eq(projectStatusLogs.projectId, projectId))
      .orderBy(desc(projectStatusLogs.createdAt))
  }

  async getProjectTasksWithDependencies(
    projectId: string,
  ): Promise<{ tasks: TaskSelect[]; dependencies: TaskDependencySelect[] }> {
    const taskRows = await this.db
      .select({
        id: tasks.id,
        milestoneId: tasks.milestoneId,
        assignedTalentId: tasks.assignedTalentId,
        title: tasks.title,
        description: tasks.description,
        orderIndex: tasks.orderIndex,
        status: tasks.status,
        estimatedHours: tasks.estimatedHours,
        actualHours: tasks.actualHours,
        startDate: tasks.startDate,
        endDate: tasks.endDate,
        createdAt: tasks.createdAt,
        updatedAt: tasks.updatedAt,
      })
      .from(tasks)
      .innerJoin(milestones, eq(milestones.id, tasks.milestoneId))
      .where(eq(milestones.projectId, projectId))
      .orderBy(tasks.orderIndex)

    const taskIds = taskRows.map((t) => t.id)
    if (taskIds.length === 0) {
      return { tasks: [], dependencies: [] }
    }

    const deps = await this.db
      .select()
      .from(taskDependencies)
      .where(inArray(taskDependencies.taskId, taskIds))

    return { tasks: taskRows, dependencies: deps }
  }

  /**
   * Projects holding team_forming that need an escalation timer.
   *
   * Only real teams: a single-talent project has one work package and the
   * 14-day team-formation deadline does not apply to it, which is the same
   * condition both workflow call sites already test before starting.
   * Oldest first, so a backlog drains in the order it stalled.
   */
  /**
   * Projects with a complete team that never started work, not yet warned.
   *
   * Measured from team_completed_at, not from updated_at: any write to the row
   * touches updated_at, so a project the owner kept editing would keep
   * resetting its own deadline. That stamp replaces the log entry that used to
   * carry the moment - `matched` was a status then, and the collapse makes
   * that entry indistinguishable from entering matching at all.
   *
   * Still `matching`, because the team being complete does not move a project:
   * work starting does, and that is exactly what has not happened here.
   */
  async findStalledStart(cutoff: Date, limit: number): Promise<{ id: string; ownerId: string }[]> {
    return await this.db
      .select({ id: projects.id, ownerId: projects.ownerId })
      .from(projects)
      .where(
        and(
          eq(projects.status, 'matching'),
          isNull(projects.deletedAt),
          isNull(projects.startReminderAt),
          sql`${projects.teamCompletedAt} < ${cutoff.toISOString()}::timestamptz`,
        ),
      )
      .orderBy(projects.updatedAt)
      .limit(limit)
  }

  /** Claim the warning, and emit it with the claim. */
  async claimStartReminder(
    input: { projectId: string; ownerId: string },
    at: Date,
  ): Promise<boolean> {
    return await this.db.transaction(async (tx) => {
      const [claimed] = await tx
        .update(projects)
        .set({ startReminderAt: at })
        .where(and(eq(projects.id, input.projectId), isNull(projects.startReminderAt)))
        .returning({ id: projects.id })

      if (!claimed) return false

      await appendOutboxEvent(tx, {
        aggregateType: 'project',
        aggregateId: input.projectId,
        eventType: PROJECT_SUBJECTS.START_OVERDUE,
        payload: { projectId: input.projectId, ownerId: input.ownerId },
      })

      return true
    })
  }

  /**
   * Projects whose PRD the owner approved and then left, not yet reminded.
   *
   * An approved PRD is the last thing the owner reaches alone: funding escrow
   * moves the project to matching, and nothing else moves it at all. So a
   * project sitting here past the deadline is a decision nobody made, and no
   * escrow exists yet for the start sweep to notice later.
   *
   * The approval is the document's, not the project's. `prd_approved` was a
   * status once; prd_review now spans generated, approved and purchased, so
   * the gate and the clock both come from prd_documents. Measured from
   * approved_at rather than updated_at for the same reason findStalledStart
   * avoids it: a revision would reset the owner's own deadline.
   */
  async findStalledDecision(
    cutoff: Date,
    limit: number,
  ): Promise<{ id: string; ownerId: string }[]> {
    return await this.db
      .select({ id: projects.id, ownerId: projects.ownerId })
      .from(projects)
      .innerJoin(prdDocuments, eq(prdDocuments.projectId, projects.id))
      .where(
        and(
          eq(projects.status, 'prd_review'),
          isNull(projects.deletedAt),
          isNull(projects.decisionReminderAt),
          sql`${prdDocuments.approvedAt} < ${cutoff.toISOString()}::timestamptz`,
        ),
      )
      .orderBy(projects.updatedAt)
      .limit(limit)
  }

  /** Claim the reminder, and emit it with the claim. */
  async claimDecisionReminder(
    input: { projectId: string; ownerId: string },
    at: Date,
  ): Promise<boolean> {
    return await this.db.transaction(async (tx) => {
      const [claimed] = await tx
        .update(projects)
        .set({ decisionReminderAt: at })
        .where(and(eq(projects.id, input.projectId), isNull(projects.decisionReminderAt)))
        .returning({ id: projects.id })

      if (!claimed) return false

      await appendOutboxEvent(tx, {
        aggregateType: 'project',
        aggregateId: input.projectId,
        eventType: PROJECT_SUBJECTS.DECISION_OVERDUE,
        payload: { projectId: input.projectId, ownerId: input.ownerId },
      })

      return true
    })
  }

  /**
   * Projects with offers out and no answer, so the escalation timer is owed.
   *
   * `team_forming` said this, and the collapse folds it into matching: the
   * project is looking for a team either way. Offers being out is a fact about
   * the assignments - a live one still waiting on its talent - so that is what
   * this asks for.
   */
  async findStalledTeamFormation(limit: number): Promise<{ id: string }[]> {
    return await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          eq(projects.status, 'matching'),
          sql`${projects.teamSize} > 1`,
          isNull(projects.deletedAt),
          sql`EXISTS (
            SELECT 1 FROM ${projectAssignments}
            WHERE ${projectAssignments.projectId} = ${projects.id}
              AND ${projectAssignments.status} = 'offered'
          )`,
        ),
      )
      .orderBy(projects.updatedAt)
      .limit(limit)
  }
}
