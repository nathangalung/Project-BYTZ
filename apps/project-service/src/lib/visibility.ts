import { AppError } from '@kerjacus/shared'

const SUMMARY_DESCRIPTION_CHARS = 120

export type VisibilityInput = {
  // Absent on public listings, which never select it.
  ownerId?: string | null
  visibility: string
  description: string | null
  finalPrice?: unknown
  platformFee?: unknown
  talentPayout?: unknown
  preferences?: unknown
}

/**
 * Decide what a viewer is allowed to see of a project.
 *
 * GET /projects/:id is deliberately reachable without a session so that public
 * project pages work, which makes this the only thing standing between a project
 * id and the full row - including the internal money columns. `private` throws
 * NOT_FOUND rather than FORBIDDEN so the response never confirms the id exists.
 *
 * Three viewer classes. The owner sees the row as stored. A talent assigned to
 * the project sees it whatever the visibility says, with the full brief but no
 * money, because visibility is the owner's choice about strangers and an
 * assigned talent is under contract - assertProjectAccess already admits them
 * to milestones, time logs and work packages. Everyone else is subject to
 * visibility.
 *
 * Pass viewerId = null for an anonymous request.
 */
export function applyProjectVisibility<T extends VisibilityInput>(
  project: T,
  viewerId: string | null,
  isAssignedTalent = false,
): Partial<T> {
  if (viewerId !== null && project.ownerId != null && viewerId === project.ownerId) {
    return project
  }

  const participant = viewerId !== null && isAssignedTalent

  if (project.visibility === 'private' && !participant) {
    throw new AppError('PROJECT_NOT_FOUND', 'Project not found')
  }

  // finalPrice / platformFee / talentPayout are owner-and-admin only: the
  // platform's fee framing depends on the margin and payout staying invisible.
  const {
    finalPrice: _finalPrice,
    platformFee: _platformFee,
    talentPayout: _talentPayout,
    ...visible
  } = project

  // Summarising the brief for someone building it makes no sense.
  if (project.visibility === 'public_summary' && !participant) {
    return {
      ...visible,
      description: project.description
        ? `${project.description.substring(0, SUMMARY_DESCRIPTION_CHARS)}...`
        : null,
      preferences: null,
    } as Partial<T>
  }

  return visible as Partial<T>
}
