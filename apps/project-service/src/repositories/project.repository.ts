import type { Database } from '@bytz/db'
import { outboxEvents, projectStatusLogs, projects } from '@bytz/db'
import { PROJECT_SUBJECTS } from '@bytz/nats-events'
import { AppError, type ProjectCategory, type ProjectStatus } from '@bytz/shared'
import { and, desc, eq, isNull, type SQL, sql } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'

type ProjectInsert = typeof projects.$inferInsert
type ProjectSelect = typeof projects.$inferSelect
type StatusLogSelect = typeof projectStatusLogs.$inferSelect

export type ProjectFilters = {
  status?: ProjectStatus
  category?: ProjectCategory
  clientId?: string
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

  async findByClientId(
    clientId: string,
    pagination: Pagination,
  ): Promise<{ items: ProjectSelect[]; total: number }> {
    const offset = (pagination.page - 1) * pagination.pageSize

    const conditions = and(eq(projects.clientId, clientId), isNull(projects.deletedAt))

    const [items, countResult] = await Promise.all([
      this.db
        .select()
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
    changedBy: string,
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

      // Write to outbox for reliable event publishing
      await tx.insert(outboxEvents).values({
        id: uuidv7(),
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
        | 'workerPayout'
        | 'preferences'
      >
    >,
  ): Promise<ProjectSelect | undefined> {
    const result = await this.db
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
  ): Promise<{ items: ProjectSelect[]; total: number }> {
    const offset = (pagination.page - 1) * pagination.pageSize

    const conditions: SQL[] = [isNull(projects.deletedAt)]

    if (filters.status) {
      conditions.push(eq(projects.status, filters.status))
    }
    if (filters.category) {
      conditions.push(eq(projects.category, filters.category))
    }
    if (filters.clientId) {
      conditions.push(eq(projects.clientId, filters.clientId))
    }

    const whereClause = and(...conditions)

    const [items, countResult] = await Promise.all([
      this.db
        .select()
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
}
