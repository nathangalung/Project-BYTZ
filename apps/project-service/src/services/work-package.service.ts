import type { DependencyType, WorkPackageStatus } from '@bytz/shared'
import { AppError } from '@bytz/shared'
import type { ProjectRepository } from '../repositories/project.repository'
import type {
  CreateWorkPackageInput,
  WorkPackageRepository,
} from '../repositories/work-package.repository'

export class WorkPackageService {
  constructor(
    private workPackageRepo: WorkPackageRepository,
    private projectRepo: ProjectRepository,
  ) {}

  async listByProject(projectId: string) {
    const project = await this.projectRepo.findById(projectId)
    if (!project) {
      throw new AppError('PROJECT_NOT_FOUND', 'Project not found')
    }

    return await this.workPackageRepo.findByProjectId(projectId)
  }

  async getWorkPackage(id: string) {
    const wp = await this.workPackageRepo.findById(id)
    if (!wp) {
      throw new AppError('NOT_FOUND', 'Work package not found')
    }
    return wp
  }

  async createWorkPackages(
    projectId: string,
    packages: Array<{
      title: string
      description: string
      requiredSkills: string[]
      estimatedHours: number
      amount: number
      workerPayout: number
      orderIndex: number
    }>,
  ) {
    const project = await this.projectRepo.findById(projectId)
    if (!project) {
      throw new AppError('PROJECT_NOT_FOUND', 'Project not found')
    }

    const inputs: CreateWorkPackageInput[] = packages.map((pkg) => ({
      projectId,
      title: pkg.title,
      description: pkg.description,
      requiredSkills: pkg.requiredSkills,
      estimatedHours: pkg.estimatedHours,
      amount: pkg.amount,
      workerPayout: pkg.workerPayout,
      orderIndex: pkg.orderIndex,
    }))

    return await this.workPackageRepo.createMany(inputs)
  }

  async updateStatus(id: string, status: WorkPackageStatus) {
    const wp = await this.workPackageRepo.findById(id)
    if (!wp) {
      throw new AppError('NOT_FOUND', 'Work package not found')
    }

    return await this.workPackageRepo.updateStatus(id, status)
  }

  async addDependency(
    workPackageId: string,
    dependsOnWorkPackageId: string,
    type?: DependencyType,
  ) {
    // Verify both work packages exist
    const wp = await this.workPackageRepo.findById(workPackageId)
    if (!wp) {
      throw new AppError('NOT_FOUND', 'Work package not found')
    }

    const depWp = await this.workPackageRepo.findById(dependsOnWorkPackageId)
    if (!depWp) {
      throw new AppError('NOT_FOUND', 'Dependency work package not found')
    }

    // Verify both belong to the same project
    if (wp.projectId !== depWp.projectId) {
      throw new AppError('VALIDATION_ERROR', 'Work packages must belong to the same project')
    }

    // Prevent self-dependency
    if (workPackageId === dependsOnWorkPackageId) {
      throw new AppError('VALIDATION_ERROR', 'Work package cannot depend on itself')
    }

    return await this.workPackageRepo.createDependency({
      workPackageId,
      dependsOnWorkPackageId,
      type,
    })
  }

  async getDependencies(projectId: string) {
    const project = await this.projectRepo.findById(projectId)
    if (!project) {
      throw new AppError('PROJECT_NOT_FOUND', 'Project not found')
    }

    return await this.workPackageRepo.getDependenciesByProject(projectId)
  }
}
