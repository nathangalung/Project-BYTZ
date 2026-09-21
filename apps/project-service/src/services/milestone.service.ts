import { AppError, FREE_MILESTONE_REVISIONS, type MilestoneStatus } from '@kerjacus/shared'
import type { MilestoneRepository } from '../repositories/milestone.repository'
import type { ProjectRepository } from '../repositories/project.repository'

// Valid milestone status transitions
const MILESTONE_TRANSITIONS: Record<MilestoneStatus, MilestoneStatus[]> = {
  pending: ['in_progress'],
  in_progress: ['submitted'],
  // A submission is either taken or sent back; 'rejected' and
  // 'revision_requested' were the same edge twice. Sending it back is not
  // terminal - terminal 'rejected' stranded the milestone's escrow, because
  // the auto-release sweep compare-and-swaps on 'submitted', no path reached
  // 'approved', and dispute refunds are project-scoped.
  submitted: ['approved', 'changes_requested'],
  changes_requested: ['in_progress'],
  approved: [],
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

    // Escrow release resolves its pool from the milestone's work package alone,
    // so a milestone keyed to another project's package would draw that
    // owner's escrow. The reference must be scoped to this project at creation,
    // the one place it enters the system.
    if (input.workPackageId) {
      const belongs = await this.milestoneRepo.workPackageBelongsToProject(
        input.workPackageId,
        input.projectId,
      )
      if (!belongs) {
        throw new AppError('VALIDATION_ERROR', 'Work package does not belong to this project')
      }
    } else if (await this.milestoneRepo.projectHasWorkPackages(input.projectId)) {
      /**
       * On a decomposed project the package is not optional - it is where the
       * money is.
       *
       * Funding splits the payment across one escrow liability account per
       * work package, so a decomposed project has per-package pools and no
       * project-level one. Release resolves the pool from the milestone's work
       * package and falls back to the project when there is none, which on
       * this shape of project targets an account that was never created: the
       * approval fails with "no escrow account holds funds", after the talent
       * has delivered. The column is nullable for the project the PRD never
       * decomposed, which has exactly one pool and can carry it; requiring it
       * here is the cheap half of that distinction.
       *
       * Both milestone types, integration included. An integration milestone
       * is the case the project-level fallback was written for, and that pool
       * does not exist here either - exempting it would keep the bug rather
       * than close it. Nominate the package the integration work is paid from.
       */
      throw new AppError(
        'VALIDATION_ERROR',
        'This project is split into work packages, so a milestone must name the work package it is paid from',
      )
    }

    // Likewise the payout is sent to the milestone's assigned talent, so an
    // off-project profile id would pay a stranger. Require an assignment on
    // this project.
    if (input.assignedTalentId) {
      const staffed = await this.milestoneRepo.talentStaffedOnProject(
        input.assignedTalentId,
        input.projectId,
      )
      if (!staffed) {
        throw new AppError('VALIDATION_ERROR', 'Assigned talent is not staffed on this project')
      }
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
    if (newStatus === 'changes_requested') {
      if (milestone.revisionCount >= FREE_MILESTONE_REVISIONS) {
        const consumed = await this.milestoneRepo.consumePaidRevisionCredit(id)
        if (!consumed) {
          throw new AppError(
            'MILESTONE_REVISION_LIMIT',
            `Free revision limit (${FREE_MILESTONE_REVISIONS}) reached. Additional revisions require payment.`,
          )
        }
      }
      // Escalation is the nuance rejection used to carry in its own status:
      // once the free rounds are spent, admins read the round in against the
      // agreed scope. Measured after the increment, so the round being spent
      // here is the one that counts, and paid rounds past the ceiling keep
      // escalating rather than going quiet.
      const escalated = milestone.revisionCount + 1 >= FREE_MILESTONE_REVISIONS
      // This one writes the status and emits the event itself.
      return await this.milestoneRepo.incrementRevisionCount(id, escalated)
    }

    // currentStatus is what the transition above was validated against, so it
    // has to reach the write or two callers who both read it both succeed.
    return await this.milestoneRepo.updateStatus(id, newStatus, currentStatus)
  }
}
