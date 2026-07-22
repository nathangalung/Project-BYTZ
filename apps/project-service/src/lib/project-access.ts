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
export async function assertProjectOwner(projectId: string, userId: string): Promise<void> {
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
    throw new AppError('AUTH_FORBIDDEN', 'Not authorized')
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

  const [talentProfile] = await db
    .select({ id: talentProfiles.id })
    .from(talentProfiles)
    .where(eq(talentProfiles.userId, userId))
    .limit(1)

  if (!talentProfile) {
    throw new AppError('AUTH_FORBIDDEN', 'Not authorized')
  }

  const [assignment] = await db
    .select({ id: projectAssignments.id })
    .from(projectAssignments)
    .where(
      and(
        eq(projectAssignments.projectId, projectId),
        eq(projectAssignments.talentId, talentProfile.id),
      ),
    )
    .limit(1)

  if (!assignment) {
    throw new AppError('AUTH_FORBIDDEN', 'Not authorized')
  }
}
