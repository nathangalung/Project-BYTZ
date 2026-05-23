import type { Database } from '@kerjacus/db'
import { talentPlacementRequests } from '@kerjacus/db'
import { AppError } from '@kerjacus/shared'
import { desc, eq, sql } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'

type PlacementInsert = typeof talentPlacementRequests.$inferInsert
type PlacementSelect = typeof talentPlacementRequests.$inferSelect

export type PlacementStatus = PlacementSelect['status']

export type Pagination = {
  page: number
  pageSize: number
}

export class TalentPlacementRepository {
  constructor(private db: Database) {}

  async create(data: {
    projectId: string
    ownerId: string
    talentId: string
    estimatedAnnualSalary?: number
  }): Promise<PlacementSelect> {
    const id = uuidv7()
    const now = new Date()

    const values: PlacementInsert = {
      id,
      projectId: data.projectId,
      ownerId: data.ownerId,
      talentId: data.talentId,
      estimatedAnnualSalary: data.estimatedAnnualSalary ?? null,
      status: 'requested',
      createdAt: now,
      updatedAt: now,
    }

    const [result] = await this.db.insert(talentPlacementRequests).values(values).returning()

    if (!result) {
      throw new AppError('INTERNAL_ERROR', 'Talent placement insert failed')
    }
    return result
  }

  async findById(id: string): Promise<PlacementSelect | undefined> {
    const [result] = await this.db
      .select()
      .from(talentPlacementRequests)
      .where(eq(talentPlacementRequests.id, id))
      .limit(1)
    return result
  }

  async findByOwner(
    ownerId: string,
    pagination: Pagination,
  ): Promise<{ items: PlacementSelect[]; total: number }> {
    const offset = (pagination.page - 1) * pagination.pageSize

    const [items, countResult] = await Promise.all([
      this.db
        .select()
        .from(talentPlacementRequests)
        .where(eq(talentPlacementRequests.ownerId, ownerId))
        .orderBy(desc(talentPlacementRequests.createdAt))
        .limit(pagination.pageSize)
        .offset(offset),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(talentPlacementRequests)
        .where(eq(talentPlacementRequests.ownerId, ownerId)),
    ])

    return {
      items,
      total: countResult[0]?.count ?? 0,
    }
  }

  async findByTalent(
    talentId: string,
    pagination: Pagination,
  ): Promise<{ items: PlacementSelect[]; total: number }> {
    const offset = (pagination.page - 1) * pagination.pageSize

    const [items, countResult] = await Promise.all([
      this.db
        .select()
        .from(talentPlacementRequests)
        .where(eq(talentPlacementRequests.talentId, talentId))
        .orderBy(desc(talentPlacementRequests.createdAt))
        .limit(pagination.pageSize)
        .offset(offset),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(talentPlacementRequests)
        .where(eq(talentPlacementRequests.talentId, talentId)),
    ])

    return {
      items,
      total: countResult[0]?.count ?? 0,
    }
  }

  async updateStatus(
    id: string,
    status: PlacementStatus,
    notes?: string,
  ): Promise<PlacementSelect | undefined> {
    const updates: Partial<PlacementInsert> = {
      status,
      updatedAt: new Date(),
    }
    if (notes !== undefined) {
      updates.notes = notes
    }

    const [result] = await this.db
      .update(talentPlacementRequests)
      .set(updates)
      .where(eq(talentPlacementRequests.id, id))
      .returning()
    return result
  }

  async updateFee(
    id: string,
    conversionFeePercentage: number,
    conversionFeeAmount: number,
    estimatedAnnualSalary?: number,
  ): Promise<PlacementSelect | undefined> {
    const updates: Partial<PlacementInsert> = {
      conversionFeePercentage,
      conversionFeeAmount,
      updatedAt: new Date(),
    }
    if (estimatedAnnualSalary !== undefined) {
      updates.estimatedAnnualSalary = estimatedAnnualSalary
    }

    const [result] = await this.db
      .update(talentPlacementRequests)
      .set(updates)
      .where(eq(talentPlacementRequests.id, id))
      .returning()
    return result
  }
}
