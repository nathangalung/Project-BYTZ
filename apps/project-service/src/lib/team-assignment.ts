import { AppError } from '@kerjacus/shared'

export type TeamAssignmentInput = { workPackageId: string; talentId: string }

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
