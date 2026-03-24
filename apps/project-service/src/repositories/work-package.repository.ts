import type { Database } from '@kerjacus/db'
import { workPackageDependencies, workPackages } from '@kerjacus/db'
import { AppError, type DependencyType, type WorkPackageStatus } from '@kerjacus/shared'
import { eq, inArray } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'

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

  async createMany(inputs: CreateWorkPackageInput[]): Promise<WorkPackageSelect[]> {
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

    return await this.db.insert(workPackages).values(values).returning()
  }

  async updateStatus(
    id: string,
    status: WorkPackageStatus,
  ): Promise<WorkPackageSelect | undefined> {
    const result = await this.db
      .update(workPackages)
      .set({ status, updatedAt: new Date() })
      .where(eq(workPackages.id, id))
      .returning()

    return result[0]
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
