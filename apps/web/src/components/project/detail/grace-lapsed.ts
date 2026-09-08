import { MILESTONE_GRACE_PERIOD_DAYS, type Milestone } from '@kerjacus/shared'
import type { ProjectAssignmentSummary } from '@/hooks/use-projects'

const DAY_MS = 24 * 60 * 60 * 1000

/** A late milestone and the seat in `assignments` that answers for it. */
export type GraceLapsedMilestone = {
  milestoneId: string
  title: string
  /** Index into the assignments array, which is what the dispute modal selects by. */
  assignmentIndex: number
}

/** Work still outstanding. Anything else is either delivered or already judged. */
const OUTSTANDING = new Set(['pending', 'in_progress', 'revision_requested'])

/**
 * Milestones whose grace period has run out, paired with who answers for them.
 *
 * The overdue notification fires the day a due date passes; this is the later
 * threshold, the one after which the owner may escalate. Keeping them apart
 * matters because a reader otherwise assumes the message and the control appear
 * together, and they do not.
 *
 * Two exclusions, both deliberate:
 *
 * Submitted work is not late any more. The clock that matters after a
 * submission is the owner's own fourteen-day review, and offering to escalate
 * there would let an owner dispute work they simply have not looked at.
 *
 * Integration milestones carry no work package and no assigned talent, so there
 * is no single respondent to name. They are dropped rather than aimed at
 * whichever assignment comes first, which is the defect this list exists to
 * avoid repeating.
 */
export function graceLapsedMilestones(
  milestones: Milestone[],
  assignments: ProjectAssignmentSummary[],
  now: Date,
): GraceLapsedMilestone[] {
  const seatOf = new Map<string, number>()
  assignments.forEach((assignment, index) => {
    if (assignment.workPackageId) seatOf.set(assignment.workPackageId, index)
  })

  const cutoff = now.getTime() - MILESTONE_GRACE_PERIOD_DAYS * DAY_MS

  return milestones.flatMap((milestone) => {
    if (!OUTSTANDING.has(milestone.status)) return []
    if (!milestone.dueDate) return []
    if (new Date(milestone.dueDate).getTime() > cutoff) return []

    const assignmentIndex = milestone.workPackageId
      ? seatOf.get(milestone.workPackageId)
      : undefined
    if (assignmentIndex === undefined) return []

    return [{ milestoneId: milestone.id, title: milestone.title, assignmentIndex }]
  })
}
