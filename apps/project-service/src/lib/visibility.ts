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

/**
 * Withhold the PRD from anyone but the owner and assigned talents.
 *
 * GET /projects/:id is anonymous-reachable, and the PRD is the owner's paid
 * technical deliverable - work package pricing, decomposition, dependencies -
 * not public marketing like the BRD summary. Returned raw, it hands a public
 * viewer the money the visibility rules above exist to hide.
 */
export function gateProjectPrd<T>(
  prd: T | null | undefined,
  viewerId: string | null,
  ownerId: string | null,
  isAssignedTalent = false,
): T | null {
  if (!prd) return null
  const isOwner = viewerId !== null && ownerId != null && viewerId === ownerId
  return isOwner || (viewerId !== null && isAssignedTalent) ? prd : null
}

/**
 * Withhold a project's owner-documents (BRD, PRD) from anyone but the owner
 * and its assigned talents.
 *
 * GET /projects/:id is anonymous-reachable. The BRD and PRD are the owner's
 * documents - business brief, technical spec, work-package pricing - not public
 * marketing, so a stranger gets null. Payment does not gate the content: the
 * owner sees the whole document and the app watermarks the on-screen preview,
 * while the clean PDF download and revisions past the free two are the paid
 * unlock (see isDocumentPaid). Assigned talents read both as their brief.
 */
export function gateProjectBrd<T>(
  brd: T | null | undefined,
  viewerId: string | null,
  ownerId: string | null,
  isAssignedTalent = false,
): T | null {
  if (!brd) return null
  const isOwner = viewerId !== null && ownerId != null && viewerId === ownerId
  return isOwner || (viewerId !== null && isAssignedTalent) ? brd : null
}
