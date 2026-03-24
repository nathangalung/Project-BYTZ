import { AppError, type CreateProjectInput, type ProjectStatus } from '@kerjacus/shared'
import { getValidTransitions, validateTransitionViaXState } from '../lib/state-machine'
import type {
  Pagination,
  ProjectFilters,
  ProjectRepository,
} from '../repositories/project.repository'

// Statuses that allow editing project fields
const EDITABLE_STATUSES: ProjectStatus[] = ['draft', 'scoping', 'brd_generated', 'brd_approved']

export class ProjectService {
  constructor(private projectRepo: ProjectRepository) {}

  async createProject(ownerId: string, input: CreateProjectInput) {
    if (input.budgetMax < input.budgetMin) {
      throw new AppError('PROJECT_VALIDATION_MISSING_FIELDS', 'budgetMax must be >= budgetMin')
    }

    return await this.projectRepo.create({
      ownerId: ownerId,
      title: input.title,
      description: input.description,
      category: input.category,
      status: 'draft',
      budgetMin: input.budgetMin,
      budgetMax: input.budgetMax,
      estimatedTimelineDays: input.estimatedTimelineDays,
      teamSize: 1,
      preferences: input.preferences ?? null,
    })
  }

  async getProject(id: string) {
    const project = await this.projectRepo.findById(id)
    if (!project) {
      throw new AppError('PROJECT_NOT_FOUND', 'Project not found')
    }
    return project
  }

  async listProjects(filters: ProjectFilters, pagination: Pagination) {
    return await this.projectRepo.list(filters, pagination)
  }

  async listOwnerProjects(ownerId: string, pagination: Pagination) {
    return await this.projectRepo.findByOwnerId(ownerId, pagination)
  }

  async transitionStatus(
    projectId: string,
    targetStatus: ProjectStatus,
    userId: string,
    reason?: string,
  ) {
    const project = await this.projectRepo.findById(projectId)
    if (!project) {
      throw new AppError('PROJECT_NOT_FOUND', 'Project not found')
    }

    const currentStatus = project.status as ProjectStatus

    // Validate transition through XState state machine engine
    const result = validateTransitionViaXState(currentStatus, targetStatus)
    if (!result.valid) {
      const validTargets = getValidTransitions(currentStatus)
      throw new AppError(
        'PROJECT_VALIDATION_INVALID_TRANSITION',
        `Cannot transition from '${currentStatus}' to '${targetStatus}'. Valid targets: ${validTargets.join(', ') || 'none'}`,
        { currentStatus, targetStatus, validTargets },
      )
    }

    // Update status, log transition, and insert outbox event atomically in repository
    const updated = await this.projectRepo.updateStatus(projectId, targetStatus, userId, reason)

    if (!updated) {
      throw new AppError('PROJECT_NOT_FOUND', 'Project not found during update')
    }

    return updated
  }

  async updateProject(
    id: string,
    _userId: string,
    data: Partial<
      Pick<
        CreateProjectInput,
        | 'title'
        | 'description'
        | 'category'
        | 'budgetMin'
        | 'budgetMax'
        | 'estimatedTimelineDays'
        | 'preferences'
      >
    >,
  ) {
    const project = await this.projectRepo.findById(id)
    if (!project) {
      throw new AppError('PROJECT_NOT_FOUND', 'Project not found')
    }

    const currentStatus = project.status as ProjectStatus
    if (!EDITABLE_STATUSES.includes(currentStatus)) {
      throw new AppError(
        'PROJECT_VALIDATION_INVALID_STATUS',
        `Cannot update project in '${currentStatus}' status. Editable statuses: ${EDITABLE_STATUSES.join(', ')}`,
      )
    }

    if (data.budgetMin !== undefined && data.budgetMax !== undefined) {
      if (data.budgetMax < data.budgetMin) {
        throw new AppError('PROJECT_VALIDATION_MISSING_FIELDS', 'budgetMax must be >= budgetMin')
      }
    }

    const updated = await this.projectRepo.update(id, data)
    if (!updated) {
      throw new AppError('PROJECT_NOT_FOUND', 'Project not found during update')
    }

    return updated
  }

  async getStatusLogs(projectId: string) {
    const project = await this.projectRepo.findById(projectId)
    if (!project) {
      throw new AppError('PROJECT_NOT_FOUND', 'Project not found')
    }

    return await this.projectRepo.getStatusLogs(projectId)
  }
}
