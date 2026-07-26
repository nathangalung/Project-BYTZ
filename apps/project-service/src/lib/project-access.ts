import { getDb, projectAssignments, projects, talentProfiles } from '@kerjacus/db'
import { AppError } from '@kerjacus/shared'
import { and, eq } from 'drizzle-orm'

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
 * True when this user holds an assignment on this project.
 *
 * The non-throwing half of assertProjectAccess, for callers that need to shape
 * a response rather than refuse it. applyProjectVisibility uses it to tell an
 * assigned talent apart from a stranger.
 */
export async function isAssignedTalent(projectId: string, userId: string): Promise<boolean> {
  const db = getDb()

  const [assignment] = await db
    .select({ id: projectAssignments.id })
    .from(projectAssignments)
    .innerJoin(talentProfiles, eq(talentProfiles.id, projectAssignments.talentId))
    .where(and(eq(projectAssignments.projectId, projectId), eq(talentProfiles.userId, userId)))
    .limit(1)

  return assignment !== undefined
}
