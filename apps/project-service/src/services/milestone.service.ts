import { AppError, FREE_REVISION_ROUNDS, type MilestoneStatus } from '@bytz/shared'
import type { MilestoneRepository } from '../repositories/milestone.repository'
import type { ProjectRepository } from '../repositories/project.repository'

// Valid milestone status transitions
const MILESTONE_TRANSITIONS: Record<MilestoneStatus, MilestoneStatus[]> = {
  pending: ['in_progress'],
  in_progress: ['submitted'],
  submitted: ['approved', 'revision_requested', 'rejected'],
  revision_requested: ['in_progress'],
  approved: [],
  rejected: [],
}

type CreateMilestoneInput = {
  projectId: string
  workPackageId?: string | null
  assignedWorkerId?: string | null
  title: string
  description: string
  milestoneType?: 'individual' | 'integration'
  orderIndex: number
  amount: number
  dueDate: string
  metadata?: Record<string, unknown> | null
}

export class MilestoneService {
  constructor(
    private milestoneRepo: MilestoneRepository,
    private projectRepo: ProjectRepository,
  ) {}

  async listByProject(projectId: string) {
    const project = await this.projectRepo.findById(projectId)
    if (!project) {
      throw new AppError('PROJECT_NOT_FOUND', 'Project not found')
    }

    return await this.milestoneRepo.findByProjectId(projectId)
  }

  async getMilestone(id: string) {
    const milestone = await this.milestoneRepo.findById(id)
    if (!milestone) {
      throw new AppError('MILESTONE_NOT_FOUND', 'Milestone not found')
    }
    return milestone
  }

  async createMilestone(input: CreateMilestoneInput) {
    const project = await this.projectRepo.findById(input.projectId)
    if (!project) {
      throw new AppError('PROJECT_NOT_FOUND', 'Project not found')
    }

    return await this.milestoneRepo.create({
      projectId: input.projectId,
      workPackageId: input.workPackageId ?? null,
      assignedWorkerId: input.assignedWorkerId ?? null,
      title: input.title,
      description: input.description,
      milestoneType: input.milestoneType ?? 'individual',
      orderIndex: input.orderIndex,
      amount: input.amount,
      status: 'pending',
      revisionCount: 0,
      dueDate: new Date(input.dueDate),
      metadata: input.metadata ?? null,
    })
  }

  async updateMilestoneStatus(id: string, newStatus: MilestoneStatus) {
    const milestone = await this.milestoneRepo.findById(id)
    if (!milestone) {
      throw new AppError('MILESTONE_NOT_FOUND', 'Milestone not found')
    }

    const currentStatus = milestone.status as MilestoneStatus
    const validTargets = MILESTONE_TRANSITIONS[currentStatus]

    if (!validTargets?.includes(newStatus)) {
      throw new AppError(
        'MILESTONE_INVALID_STATUS',
        `Cannot transition milestone from '${currentStatus}' to '${newStatus}'. Valid targets: ${validTargets?.join(', ') || 'none'}`,
      )
    }

    // Handle revision_requested: increment count and check limits
    if (newStatus === 'revision_requested') {
      if (milestone.revisionCount >= FREE_REVISION_ROUNDS) {
        throw new AppError(
          'MILESTONE_REVISION_LIMIT',
          `Free revision limit (${FREE_REVISION_ROUNDS}) reached. Additional revisions require payment.`,
        )
      }
      return await this.milestoneRepo.incrementRevisionCount(id)
    }

    return await this.milestoneRepo.updateStatus(id, newStatus)
  }
}
