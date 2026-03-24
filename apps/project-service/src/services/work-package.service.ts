import type { DependencyType, WorkPackageStatus } from '@kerjacus/shared'
import { AppError } from '@kerjacus/shared'
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
      talentPayout: number
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
      talentPayout: pkg.talentPayout,
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

    // Cycle detection via DFS on the dependency DAG
    const allDeps = await this.workPackageRepo.getDependenciesByProject(wp.projectId)

    // Build adjacency list
    const graph = new Map<string, string[]>()
    for (const dep of allDeps) {
      const edges = graph.get(dep.workPackageId) ?? []
      edges.push(dep.dependsOnWorkPackageId)
      graph.set(dep.workPackageId, edges)
    }

    // Add the proposed new edge
    const newEdges = graph.get(workPackageId) ?? []
    newEdges.push(dependsOnWorkPackageId)
    graph.set(workPackageId, newEdges)

    // DFS cycle detection
    const visited = new Set<string>()
    const inStack = new Set<string>()

    function hasCycle(node: string): boolean {
      if (inStack.has(node)) return true
      if (visited.has(node)) return false
      visited.add(node)
      inStack.add(node)
      for (const neighbor of graph.get(node) ?? []) {
        if (hasCycle(neighbor)) return true
      }
      inStack.delete(node)
      return false
    }

    for (const node of graph.keys()) {
      visited.clear()
      inStack.clear()
      if (hasCycle(node)) {
        throw new AppError('VALIDATION_ERROR', 'Adding this dependency would create a cycle')
      }
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
