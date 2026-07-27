import { getDb, projectAssignments, projects, talentProfiles, workPackages } from '@kerjacus/db'
import { AppError } from '@kerjacus/shared'
import { and, eq, inArray } from 'drizzle-orm'

/**
 * Throw unless `userId` may read project-scoped data - time logs, work packages,
 * milestones, activity.
 *
 * Access means the project owner, or a talent assigned to the project. Session
 * middleware already guarantees the caller is signed in; this is the missing
 * second half, authorisation.
 *
 * This check existed inline on `GET /time-logs/project/:projectId/summary` but
 * not on its sibling routes, so any signed-in user could read another project's
 * data by guessing or observing an id. It lives here so every project-scoped
 * route shares one implementation instead of each re-deriving it.
 *
 * A missing project is NOT_FOUND; a real project the caller cannot see is
 * AUTH_FORBIDDEN. That mirrors the existing handler and is deliberate: these
 * routes are reachable only with a session, so confirming a project exists to a
 * signed-in user is not the disclosure that `applyProjectVisibility` guards
 * against on the public project-detail route.
 */
/**
 * Throw unless `userId` owns the project.
 *
 * Stricter than assertProjectAccess, which also admits assigned talents. Use it
 * for decisions that belong to the owner alone, such as confirming who joins the
 * team.
 */
export async function assertProjectOwner(
  projectId: string,
  userId: string,
  // Handlers that had this check inline told the caller what they were being
  // refused - "Only the project owner can view BRD" reads better than a bare
  // "Not authorized". Keeping that specific is what makes adopting the helper
  // an improvement rather than a regression in the UI.
  forbiddenMessage = 'Not authorized',
): Promise<void> {
  const db = getDb()

  const [project] = await db
    .select({ ownerId: projects.ownerId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)

  if (!project) {
    throw new AppError('NOT_FOUND', 'Project not found')
  }
  if (project.ownerId !== userId) {
    throw new AppError('AUTH_FORBIDDEN', forbiddenMessage)
  }
}

export async function assertProjectAccess(projectId: string, userId: string): Promise<void> {
  const db = getDb()

  const [project] = await db
    .select({ ownerId: projects.ownerId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)

  if (!project) {
    throw new AppError('NOT_FOUND', 'Project not found')
  }

  if (project.ownerId === userId) {
    return
  }

  if (!(await isAssignedTalent(projectId, userId))) {
    throw new AppError('AUTH_FORBIDDEN', 'Not authorized')
  }
}

/**
 * Assignment states that still admit the talent to the project.
 *
 * A terminated or replaced assignment means someone else took the work over,
 * so the row is history - keeping it live handed a removed talent the project's
 * milestones, files and Centrifugo subscription tokens for as long as they
 * stayed signed in. `completed` stays in: a talent who delivered still needs
 * their own invoices and milestone record. The same pair is what
 * `WORKED_STATUSES` in invoices.ts and the `uq_project_assignments_wp_live`
 * partial index already treat as the live assignment.
 */
export const LIVE_ASSIGNMENT_STATUSES = ['active', 'completed'] as const

/**
 * True when this user holds a live assignment on this project.
 *
 * The non-throwing half of assertProjectAccess, for callers that need to shape
 * a response rather than refuse it. applyProjectVisibility uses it to tell an
 * assigned talent apart from a stranger.
 */
/**
 * Throw unless `userId` has ever been one of the two sides of this project.
 *
 * assertProjectAccess asks a similar question about the caller, and answers it
 * with LIVE_ASSIGNMENT_STATUSES because it is deciding what someone may read
 * right now. This is a different question. It asks whether somebody the caller
 * named - the user a dispute is filed against - was ever party to the work, and
 * the answer must include the talent who walked away: abandonment is one of the
 * things disputes exist for, and terminating their assignment is what the
 * platform does in response. Restricting this to live assignments would refuse
 * the dispute precisely when it is most warranted.
 */
export async function assertProjectParty(
  projectId: string,
  userId: string,
  forbiddenMessage: string,
): Promise<void> {
  const db = getDb()

  const [project] = await db
    .select({ ownerId: projects.ownerId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)

  if (!project) {
    throw new AppError('NOT_FOUND', 'Project not found')
  }
  if (project.ownerId === userId) {
    return
  }

  const [everAssigned] = await db
    .select({ id: projectAssignments.id })
    .from(projectAssignments)
    .innerJoin(talentProfiles, eq(talentProfiles.id, projectAssignments.talentId))
    .where(and(eq(projectAssignments.projectId, projectId), eq(talentProfiles.userId, userId)))
    .limit(1)

  if (!everAssigned) {
    throw new AppError('VALIDATION_ERROR', forbiddenMessage)
  }
}

/**
 * Throw unless `userId` may raise a dispute scoped to this work package.
 *
 * The package decides whose escrow a resolution refunds, so scoping it to a
 * teammate's package aims the refund at their money. The owner may dispute any
 * package on their own project; a talent may dispute only the one they hold.
 */
export async function assertDisputableWorkPackage(
  projectId: string,
  workPackageId: string,
  userId: string,
): Promise<void> {
  const db = getDb()

  const [pkg] = await db
    .select({ id: workPackages.id })
    .from(workPackages)
    .where(and(eq(workPackages.id, workPackageId), eq(workPackages.projectId, projectId)))
    .limit(1)

  if (!pkg) {
    throw new AppError('NOT_FOUND', 'Work package not found on this project')
  }

  const [project] = await db
    .select({ ownerId: projects.ownerId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)

  if (project?.ownerId === userId) {
    return
  }

  const [own] = await db
    .select({ id: projectAssignments.id })
    .from(projectAssignments)
    .innerJoin(talentProfiles, eq(talentProfiles.id, projectAssignments.talentId))
    .where(
      and(
        eq(projectAssignments.workPackageId, workPackageId),
        eq(talentProfiles.userId, userId),
        inArray(projectAssignments.status, LIVE_ASSIGNMENT_STATUSES),
      ),
    )
    .limit(1)

  if (!own) {
    throw new AppError('AUTH_FORBIDDEN', 'Can only dispute your own work package')
  }
}

export async function isAssignedTalent(projectId: string, userId: string): Promise<boolean> {
  const db = getDb()

  const [assignment] = await db
    .select({ id: projectAssignments.id })
    .from(projectAssignments)
    .innerJoin(talentProfiles, eq(talentProfiles.id, projectAssignments.talentId))
    .where(
      and(
        eq(projectAssignments.projectId, projectId),
        eq(talentProfiles.userId, userId),
        inArray(projectAssignments.status, LIVE_ASSIGNMENT_STATUSES),
      ),
    )
    .limit(1)

  return assignment !== undefined
}
