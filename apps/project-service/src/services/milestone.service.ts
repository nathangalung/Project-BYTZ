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
  // Rejection sends the work back, it does not end it. Terminal 'rejected'
  // stranded the milestone's escrow: the auto-release sweep compare-and-swaps
  // on 'submitted', no path reached 'approved', and dispute refunds are
  // project-scoped, so the money had no exit at all.
  rejected: ['in_progress'],
}

// Both outcomes reject the submitted work, so both spend a revision round.
const REVISION_OUTCOMES: MilestoneStatus[] = ['revision_requested', 'rejected']

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

    // Free rounds first, then one paid credit per extra round. The credit is
    // created by the REV- payment callback; with none available the owner is
    // sent to pay first. Beyond the free rounds the deliverable is expected to
    // match the BRD and PRD, so further rounds are a priced change, not a fix.
    if (REVISION_OUTCOMES.includes(newStatus)) {
      if (milestone.revisionCount >= FREE_MILESTONE_REVISIONS) {
        const consumed = await this.milestoneRepo.consumePaidRevisionCredit(id)
        if (!consumed) {
          throw new AppError(
            'MILESTONE_REVISION_LIMIT',
            `Free revision limit (${FREE_MILESTONE_REVISIONS}) reached. Additional revisions require payment.`,
          )
        }
      }
      if (newStatus === 'revision_requested') {
        // This one writes the status and emits the revision event itself.
        return await this.milestoneRepo.incrementRevisionCount(id)
      }
      // Rejection only spends the round here; its status write is below, and it
      // must still find the milestone in the status it was validated against.
      await this.milestoneRepo.bumpRevisionCount(id)
    }

    // currentStatus is what the transition above was validated against, so it
    // has to reach the write or two callers who both read it both succeed.
    return await this.milestoneRepo.updateStatus(id, newStatus, currentStatus)
  }
}
