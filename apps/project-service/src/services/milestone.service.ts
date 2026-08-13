import { AppError, FREE_MILESTONE_REVISIONS, type MilestoneStatus } from '@kerjacus/shared'
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
  assignedTalentId?: string | null
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
      assignedTalentId: input.assignedTalentId ?? null,
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

    // Handle revision_requested: two free rounds, then one paid credit per
    // extra revision. The credit is created by the REV- payment callback; with
    // none available the owner is sent to pay first.
    if (newStatus === 'revision_requested') {
      if (milestone.revisionCount >= FREE_MILESTONE_REVISIONS) {
        const consumed = await this.milestoneRepo.consumePaidRevisionCredit(id)
        if (!consumed) {
          throw new AppError(
            'MILESTONE_REVISION_LIMIT',
            `Free revision limit (${FREE_MILESTONE_REVISIONS}) reached. Additional revisions require payment.`,
          )
        }
      }
      return await this.milestoneRepo.incrementRevisionCount(id)
    }

    // currentStatus is what the transition above was validated against, so it
    // has to reach the write or two callers who both read it both succeed.
    return await this.milestoneRepo.updateStatus(id, newStatus, currentStatus)
  }
}
