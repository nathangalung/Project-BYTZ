import { type Database, projectStatusLogs, projects, workPackages } from '@kerjacus/db'
import { PROJECT_SUBJECTS } from '@kerjacus/nats-events'
import { and, eq } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { ensureProjectContracts } from './contract-generation'
import { ensureProjectConversations } from './conversation-provisioning'
import { appendOutboxEvent } from './outbox'
import { allPackagesStaffed } from './team-assignment'

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0]

/**
 * Statuses from which the last staffed position completes the team.
 *
 * Walked one at a time rather than matched with an IN list so the status log
 * can name the status the project actually came from. At most one of them can
 * update a row.
 */
const PRE_MATCHED_STATUSES = ['matching', 'team_forming'] as const

/** Which door the talent came through, for the event payload. */
export type StaffingSource = 'talent_accept' | 'application_accept'

export type StaffingInput = {
  projectId: string
  assignmentId: string
  workPackageId: string
  /** The user whose action staffed the position; recorded in the status log. */
  changedBy: string
  source: StaffingSource
}

/**
 * Everything that has to happen once a talent is on a project, wherever they
 * came from.
 *
 * There were two doors into project_assignments with different invariants.
 * The offer protocol created contracts, conversations and the promotion to
 * `matched`; accepting an application wrote the row and stopped, so the owner
 * saw a hired talent with no NDA, no IP transfer, no thread to talk in, and a
 * project still sitting in `matching`. One function so the two cannot drift
 * again - the drift is the bug, not either half of it.
 *
 * Every step is idempotent and every write is guarded on a from-status, so
 * calling this on an accept that changes nothing is a no-op: the contracts and
 * conversations are unique-indexed per assignment, and a project already past
 * the status a promotion comes from updates zero rows and stays quiet.
 *
 * Must be called inside the caller's transaction, after the assignment row and
 * its work package have been written, and with the project row already locked
 * FOR UPDATE - ensureProjectConversations takes that lock itself, and every
 * handler here takes project -> assignment -> work package in that order.
 *
 * Returns true only when this call is the one that reached `matched`, which is
 * what the Temporal escalation timer waits for.
 */
export async function finalizeStaffing(tx: Tx, input: StaffingInput): Promise<boolean> {
  const { projectId, changedBy, source } = input

  /**
   * The agreements and the threads, for every live assignment on the project.
   *
   * Unconditional, not gated on the team being complete. A replacement talent
   * joining a partially_active project never completes anything - the project
   * was never incomplete in the `matched` sense - and used to receive neither,
   * permanently, because nothing runs again afterwards.
   */
  await ensureProjectContracts(tx, projectId)
  await ensureProjectConversations(tx, projectId)

  // Read package statuses inside the transaction so the just-staffed package is
  // counted; the promotions below only make sense once none is open.
  const pkgs = await tx
    .select({ status: workPackages.status })
    .from(workPackages)
    .where(eq(workPackages.projectId, projectId))
  if (!allPackagesStaffed(pkgs.map((p) => p.status))) return false

  let complete = false
  for (const from of PRE_MATCHED_STATUSES) {
    // Guarded so only the transaction that actually flips the status logs and
    // emits; a concurrent final accept that finds the project already matched
    // updates zero rows and stays quiet.
    const promoted = await tx
      .update(projects)
      .set({ status: 'matched', updatedAt: new Date() })
      .where(and(eq(projects.id, projectId), eq(projects.status, from)))
      .returning({ id: projects.id })
    if (promoted.length === 0) continue

    complete = true
    await tx.insert(projectStatusLogs).values({
      id: uuidv7(),
      projectId,
      fromStatus: from,
      toStatus: 'matched',
      changedBy,
      reason: 'Every position accepted',
    })
    await appendOutboxEvent(tx, {
      aggregateType: 'project',
      aggregateId: projectId,
      eventType: PROJECT_SUBJECTS.TEAM_COMPLETE,
      payload: { projectId, source },
    })
  }

  /**
   * A refilled seat puts a running project back to work.
   *
   * `partially_active` means "running, one position open". Terminating an
   * assignment writes it; nothing wrote the way back, so a restaffed project
   * stayed there until the owner transitioned it by hand.
   *
   * Deliberately not gated on the replacement's contracts being signed, unlike
   * matched -> in_progress (see projects.ts). That gate is about work not
   * starting before both parties have signed; here the work is already under
   * way and the rest of the team is mid-milestone. Holding the whole project
   * in a degraded status until one new signature lands would punish the
   * talents who never left. The contracts are created above and the contract
   * routes still chase them.
   */
  const restored = await tx
    .update(projects)
    .set({ status: 'in_progress', updatedAt: new Date() })
    .where(and(eq(projects.id, projectId), eq(projects.status, 'partially_active')))
    .returning({ id: projects.id })
  if (restored.length > 0) {
    await tx.insert(projectStatusLogs).values({
      id: uuidv7(),
      projectId,
      fromStatus: 'partially_active',
      toStatus: 'in_progress',
      changedBy,
      reason: 'Open position refilled',
    })
    await appendOutboxEvent(tx, {
      aggregateType: 'project',
      aggregateId: projectId,
      eventType: PROJECT_SUBJECTS.TEAM_TALENT_REPLACED,
      payload: {
        projectId,
        assignmentId: input.assignmentId,
        workPackageId: input.workPackageId,
        source,
      },
    })
  }

  return complete
}
