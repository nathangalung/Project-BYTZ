import {
  adminAuditLogs,
  getDb,
  platformSettings,
  projects,
  transactions,
  user as userTable,
  workerProfiles,
} from '@bytz/db'
import { and, count, desc, eq, gte, isNull, lte, sql } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'

export type DateRange = {
  from: Date
  to: Date
}

export type CreateAuditLogInput = {
  adminId: string
  action: string
  targetType: string
  targetId: string
  details?: Record<string, unknown>
}

function db() {
  return getDb()
}

export const adminRepository = {
  async getProjectStats() {
    const result = await db()
      .select({
        status: projects.status,
        count: count(),
      })
      .from(projects)
      .where(isNull(projects.deletedAt))
      .groupBy(projects.status)

    const stats: Record<string, number> = {}
    for (const row of result) {
      stats[row.status] = row.count
    }
    return stats
  },

  async getRevenueStats(dateRange?: DateRange) {
    const conditions = [eq(transactions.status, 'completed'), isNull(transactions.deletedAt)]

    if (dateRange) {
      conditions.push(gte(transactions.createdAt, dateRange.from))
      conditions.push(lte(transactions.createdAt, dateRange.to))
    }

    const result = await db()
      .select({
        type: transactions.type,
        totalAmount: sql<number>`COALESCE(SUM(${transactions.amount}), 0)::int`,
        transactionCount: count(),
      })
      .from(transactions)
      .where(and(...conditions))
      .groupBy(transactions.type)

    let totalRevenue = 0
    const breakdown: Record<string, { amount: number; count: number }> = {}

    for (const row of result) {
      const amount = Number(row.totalAmount)
      // Only count revenue-generating transaction types
      if (
        row.type === 'escrow_in' ||
        row.type === 'brd_payment' ||
        row.type === 'prd_payment' ||
        row.type === 'revision_fee' ||
        row.type === 'talent_placement_fee'
      ) {
        totalRevenue += amount
      }
      // Subtract refunds from total
      if (row.type === 'refund' || row.type === 'partial_refund') {
        totalRevenue -= amount
      }
      breakdown[row.type] = {
        amount,
        count: row.transactionCount,
      }
    }

    return { totalRevenue, breakdown }
  },

  async getWorkerStats() {
    const tierResult = await db()
      .select({
        tier: workerProfiles.tier,
        count: count(),
      })
      .from(workerProfiles)
      .groupBy(workerProfiles.tier)

    const tierDistribution: Record<string, number> = {}
    let totalWorkers = 0
    for (const row of tierResult) {
      tierDistribution[row.tier] = row.count
      totalWorkers += row.count
    }

    // Utilization: workers with active projects
    const activeWorkersResult = await db()
      .select({ count: count() })
      .from(workerProfiles)
      .where(sql`${workerProfiles.totalProjectsActive} > 0`)

    const activeWorkers = activeWorkersResult[0]?.count ?? 0
    const utilizationRate = totalWorkers > 0 ? activeWorkers / totalWorkers : 0

    // Average rating
    const ratingResult = await db()
      .select({
        avgRating: sql<number>`COALESCE(AVG(${workerProfiles.averageRating}), 0)::float`,
      })
      .from(workerProfiles)
      .where(sql`${workerProfiles.averageRating} IS NOT NULL`)

    const avgRating = ratingResult[0]?.avgRating ?? 0

    return {
      totalWorkers,
      tierDistribution,
      activeWorkers,
      utilizationRate: Math.round(utilizationRate * 100) / 100,
      averageRating: Math.round(avgRating * 100) / 100,
    }
  },

  async getUsersList(filters: { role?: string; search?: string; page: number; pageSize: number }) {
    const { role, search, page, pageSize } = filters
    const offset = (page - 1) * pageSize

    const conditions = [isNull(userTable.deletedAt)]

    if (role) {
      conditions.push(sql`${userTable.role} = ${role}`)
    }

    if (search) {
      conditions.push(
        sql`(${userTable.name} ILIKE ${`%${search}%`} OR ${userTable.email} ILIKE ${`%${search}%`})`,
      )
    }

    const whereClause = and(...conditions)

    const [items, totalResult] = await Promise.all([
      db()
        .select({
          id: userTable.id,
          email: userTable.email,
          name: userTable.name,
          phone: userTable.phone,
          role: userTable.role,
          avatarUrl: userTable.avatarUrl,
          isVerified: userTable.isVerified,
          locale: userTable.locale,
          createdAt: userTable.createdAt,
          updatedAt: userTable.updatedAt,
        })
        .from(userTable)
        .where(whereClause)
        .orderBy(desc(userTable.createdAt))
        .limit(pageSize)
        .offset(offset),
      db().select({ count: count() }).from(userTable).where(whereClause),
    ])

    const total = totalResult[0]?.count ?? 0
    return { items, total }
  },

  async getUserById(id: string) {
    const result = await db()
      .select()
      .from(userTable)
      .where(and(eq(userTable.id, id), isNull(userTable.deletedAt)))
      .limit(1)
    return result[0] ?? null
  },

  async suspendUser(id: string) {
    const now = new Date()
    const [updated] = await db()
      .update(userTable)
      .set({ isVerified: false, updatedAt: now })
      .where(eq(userTable.id, id))
      .returning()
    return updated ?? null
  },

  async unsuspendUser(id: string) {
    const now = new Date()
    const [updated] = await db()
      .update(userTable)
      .set({ isVerified: true, updatedAt: now })
      .where(eq(userTable.id, id))
      .returning()
    return updated ?? null
  },

  async getAuditLogs(pagination: { page: number; pageSize: number }) {
    const { page, pageSize } = pagination
    const offset = (page - 1) * pageSize

    const [items, totalResult] = await Promise.all([
      db()
        .select()
        .from(adminAuditLogs)
        .orderBy(desc(adminAuditLogs.createdAt))
        .limit(pageSize)
        .offset(offset),
      db().select({ count: count() }).from(adminAuditLogs),
    ])

    const total = totalResult[0]?.count ?? 0
    return { items, total }
  },

  async createAuditLog(data: CreateAuditLogInput) {
    const id = uuidv7()
    const [log] = await db()
      .insert(adminAuditLogs)
      .values({
        id,
        adminId: data.adminId,
        action: data.action,
        targetType: data.targetType,
        targetId: data.targetId,
        details: data.details ?? null,
        createdAt: new Date(),
      })
      .returning()
    if (!log) {
      throw new Error('Failed to create audit log')
    }
    return log
  },

  async getPlatformSettings() {
    return db().select().from(platformSettings).orderBy(platformSettings.key)
  },

  async getPlatformSetting(key: string) {
    const result = await db()
      .select()
      .from(platformSettings)
      .where(eq(platformSettings.key, key))
      .limit(1)
    return result[0] ?? null
  },

  async updatePlatformSetting(key: string, value: unknown, adminId: string) {
    const existing = await this.getPlatformSetting(key)
    const now = new Date()

    if (existing) {
      const [updated] = await db()
        .update(platformSettings)
        .set({
          value,
          updatedBy: adminId,
          updatedAt: now,
        })
        .where(eq(platformSettings.key, key))
        .returning()
      if (!updated) {
        throw new Error(`Failed to update platform setting: ${key}`)
      }
      return updated
    }

    // Create new setting
    const id = uuidv7()
    const [created] = await db()
      .insert(platformSettings)
      .values({
        id,
        key,
        value,
        updatedBy: adminId,
        updatedAt: now,
      })
      .returning()
    if (!created) {
      throw new Error(`Failed to create platform setting: ${key}`)
    }
    return created
  },
}
