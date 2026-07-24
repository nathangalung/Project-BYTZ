import { AppError } from '@kerjacus/shared'

export type TeamAssignmentInput = { workPackageId: string; talentId: string }

const STAFFED_PACKAGE_STATUSES = new Set(['assigned', 'in_progress', 'completed'])

/**
 * True once every package on the project is held by an accepted talent.
 *
 * A package reaches 'assigned' only when its offered talent accepts, so this is
 * the promote-to-matched gate: matched means every position accepted, never a
 * package left open or an offer still pending. An empty project is not matched.
 */
export function allPackagesStaffed(statuses: readonly string[]): boolean {
  return statuses.length > 0 && statuses.every((s) => STAFFED_PACKAGE_STATUSES.has(s))
}

/**
 * Guard that an assignment is still awaiting the talent's response.
 *
 * Accepting or declining is valid only on a live, pending offer; a second
 * response, or one on a terminated assignment, is rejected instead of silently
 * flipping state.
 */
export function assertAssignmentPending(assignment: {
  status: string
  acceptanceStatus: string
}): void {
  if (assignment.status !== 'active' || assignment.acceptanceStatus !== 'pending') {
    throw new AppError('MATCHING_INVALID_ASSIGNMENT', 'Assignment is not awaiting a response')
  }
}

/**
 * Validate position assignments before writing them.
 *
 * Every target must be an open (unassigned) package, and no package or talent
 * may appear twice -- including a talent already on the project -- so one talent
 * never holds two positions and no package is double staffed. Throws
 * MATCHING_INVALID_ASSIGNMENT on any violation.
 */
export function validateTeamAssignments(
  openWorkPackageIds: ReadonlySet<string>,
  assignedTalentIds: ReadonlySet<string>,
  assignments: readonly TeamAssignmentInput[],
): void {
  const seenWp = new Set<string>()
  const seenTalent = new Set<string>()
  for (const { workPackageId, talentId } of assignments) {
    if (!openWorkPackageIds.has(workPackageId)) {
      throw new AppError('MATCHING_INVALID_ASSIGNMENT', `Work package ${workPackageId} is not open`)
    }
    if (seenWp.has(workPackageId)) {
      throw new AppError(
        'MATCHING_INVALID_ASSIGNMENT',
        `Work package ${workPackageId} staffed twice`,
      )
    }
    if (seenTalent.has(talentId) || assignedTalentIds.has(talentId)) {
      throw new AppError('MATCHING_INVALID_ASSIGNMENT', `Talent ${talentId} holds two positions`)
    }
    seenWp.add(workPackageId)
    seenTalent.add(talentId)
  }
}
