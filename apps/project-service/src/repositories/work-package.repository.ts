import type { Database } from '@kerjacus/db'
import { workPackageDependencies, workPackages } from '@kerjacus/db'
import { AppError, type DependencyType, type WorkPackageStatus } from '@kerjacus/shared'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'

/** Database atau transaksi yang sedang berjalan. */
type DbLike = Database | Parameters<Parameters<Database['transaction']>[0]>[0]

type WorkPackageSelect = typeof workPackages.$inferSelect
type DependencySelect = typeof workPackageDependencies.$inferSelect

export type CreateWorkPackageInput = {
  projectId: string
  title: string
  description: string
  requiredSkills: string[]
  estimatedHours: number
  amount: number
  talentPayout: number
  orderIndex: number
}

export type CreateDependencyInput = {
  workPackageId: string
  dependsOnWorkPackageId: string
  type?: DependencyType
}

export class WorkPackageRepository {
  constructor(private db: Database) {}

  async findByProjectId(projectId: string): Promise<WorkPackageSelect[]> {
    return await this.db
      .select()
      .from(workPackages)
      .where(eq(workPackages.projectId, projectId))
      .orderBy(workPackages.orderIndex)
  }

  async findById(id: string): Promise<WorkPackageSelect | undefined> {
    const result = await this.db.select().from(workPackages).where(eq(workPackages.id, id)).limit(1)

    return result[0]
  }

  async create(data: CreateWorkPackageInput): Promise<WorkPackageSelect> {
    const id = uuidv7()
    const now = new Date()

    const result = await this.db
      .insert(workPackages)
      .values({
        id,
        projectId: data.projectId,
        title: data.title,
        description: data.description,
        requiredSkills: data.requiredSkills,
        estimatedHours: data.estimatedHours,
        amount: data.amount,
        talentPayout: data.talentPayout,
        orderIndex: data.orderIndex,
        status: 'unassigned',
        createdAt: now,
        updatedAt: now,
      })
      .returning()

    if (!result[0]) throw new AppError('INTERNAL_ERROR', 'Work package insert failed')
    return result[0]
  }

  /**
   * Terima transaksi dari pemanggil.
   *
   * Harga proyek dan payout paket lama ikut bergeser saat paket baru masuk,
   * jadi ketiganya harus jadi satu operasi. Tanpa parameter ini service
   * terpaksa menulis lewat pool dan transaksinya kehilangan arti.
   */
  async createMany(
    inputs: CreateWorkPackageInput[],
    tx: DbLike = this.db,
  ): Promise<WorkPackageSelect[]> {
    if (inputs.length === 0) return []

    const now = new Date()
    const values = inputs.map((data) => ({
      id: uuidv7(),
      projectId: data.projectId,
      title: data.title,
      description: data.description,
      requiredSkills: data.requiredSkills,
      estimatedHours: data.estimatedHours,
      amount: data.amount,
      talentPayout: data.talentPayout,
      orderIndex: data.orderIndex,
      status: 'unassigned' as WorkPackageStatus,
      createdAt: now,
      updatedAt: now,
    }))

    return await tx.insert(workPackages).values(values).returning()
  }

  async updatePayout(
    id: string,
    talentPayout: number,
    tx: DbLike = this.db,
  ): Promise<WorkPackageSelect | undefined> {
    const result = await tx
      .update(workPackages)
      .set({ talentPayout, updatedAt: new Date() })
      .where(eq(workPackages.id, id))
      .returning()

    return result[0]
  }

  /**
   * Move a work package to `status`, but only while it still holds
   * `expectedStatus`.
   *
   * The caller reads the row and checks it exists, so the write has to carry
   * that read forward or two callers who both saw the same status both write.
   * This column is the team formation gate: matching offers positions
   * `WHERE status IN ('unassigned')`, applications picks its free package from
   * ('unassigned','declined'), and allPackagesStaffed counts these values to
   * promote a project to matched.
   *
   * Only one of those writers serialises on the project row, the accept path
   * in routes/matching.ts. The confirm and decline paths there and the accept
   * in routes/applications.ts write on the work package id alone, so this
   * predicate is the route's own guard rather than a stricter version of a
   * lock the others already hold. Unguarded it could overwrite the `assigned`
   * a talent acceptance had just committed, leaving a matched project holding
   * a package that /positions would reoffer.
   */
  async updateStatus(
    id: string,
    status: WorkPackageStatus,
    expectedStatus: WorkPackageStatus,
  ): Promise<WorkPackageSelect | undefined> {
    return await this.db.transaction(async (tx) => {
      const [result] = await tx
        .update(workPackages)
        .set({ status, updatedAt: new Date() })
        .where(and(eq(workPackages.id, id), eq(workPackages.status, expectedStatus)))
        .returning()

      // Row exists but moved on: somebody else won the same transition.
      if (!result) {
        const [current] = await tx
          .select({ status: workPackages.status })
          .from(workPackages)
          .where(eq(workPackages.id, id))
          .limit(1)
        if (current) {
          throw new AppError(
            'CONFLICT',
            `Work package is already ${current.status}, not ${expectedStatus}`,
          )
        }
        return undefined
      }

      return result
    })
  }

  async getDependencies(workPackageId: string): Promise<DependencySelect[]> {
    return await this.db
      .select()
      .from(workPackageDependencies)
      .where(eq(workPackageDependencies.workPackageId, workPackageId))
  }

  async getDependenciesByProject(projectId: string): Promise<DependencySelect[]> {
    const packages = await this.findByProjectId(projectId)
    const packageIds = packages.map((p) => p.id)
    if (packageIds.length === 0) return []

    return await this.db
      .select()
      .from(workPackageDependencies)
      .where(inArray(workPackageDependencies.workPackageId, packageIds))
  }

  /**
   * Serialise dependency changes on one project.
   *
   * Adding an edge is read-all-edges, check for a cycle in JS, insert. Two
   * concurrent adds each validated against a graph missing the other's edge,
   * so together they could commit a cycle that neither would have allowed -
   * and a cyclic graph has no topological order, so the critical path has
   * nothing to compute. The unique index only stops the same edge twice.
   *
   * The project row is the lock, which is what routes/matching.ts already uses
   * to serialise team staffing.
   */
  async withDependencyLock<T>(projectId: string, run: () => Promise<T>): Promise<T> {
    return await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM projects WHERE id = ${projectId} FOR UPDATE`)
      return await run()
    })
  }

  async createDependency(data: CreateDependencyInput): Promise<DependencySelect> {
    const result = await this.db
      .insert(workPackageDependencies)
      .values({
        id: uuidv7(),
        workPackageId: data.workPackageId,
        dependsOnWorkPackageId: data.dependsOnWorkPackageId,
        type: data.type ?? 'finish_to_start',
      })
      .returning()

    if (!result[0]) throw new AppError('INTERNAL_ERROR', 'Work package dependency insert failed')
    return result[0]
  }
}
