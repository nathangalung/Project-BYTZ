import { type Database, projects, workPackages } from '@kerjacus/db'
import { PROJECT_SUBJECTS } from '@kerjacus/nats-events'
import { and, eq, isNull } from 'drizzle-orm'
import { ensureProjectContracts } from './contract-generation'
import { ensureProjectConversations } from './conversation-provisioning'
import { appendOutboxEvent } from './outbox'
import { allPackagesStaffed } from './team-assignment'

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0]

/** Which door the talent came through, for the event payload. */
export type StaffingSource = 'talent_accept' | 'application_accept'

export type StaffingInput = {
  projectId: string
  assignmentId: string
  workPackageId: string
  source: StaffingSource
}

/**
 * Everything that has to happen once a talent is on a project, wherever they
 * came from.
 *
 * There were two doors into project_assignments with different invariants.
 * The offer protocol created contracts, conversations and the team-complete
 * event; accepting an application wrote the row and stopped, so the owner saw
 * a hired talent with no NDA, no IP transfer and no thread to talk in. One
 * function so the two cannot drift again - the drift is the bug, not either
 * half of it.
 *
 * Every step is idempotent, so calling this on an accept that changes nothing
 * is a no-op: the contracts and conversations are unique-indexed per
 * assignment, and an incomplete team leaves before anything is emitted.
 *
 * Must be called inside the caller's transaction, after the assignment row and
 * its work package have been written, and with the project row already locked
 * FOR UPDATE - ensureProjectConversations takes that lock itself, and every
 * handler here takes project -> assignment -> work package in that order.
 *
 * Returns true only when this call is the one that completed the team, which
 * is what the Temporal escalation timer waits for.
 */
export async function finalizeStaffing(tx: Tx, input: StaffingInput): Promise<boolean> {
  const { projectId, source } = input

  /**
   * The agreements and the threads, for every live assignment on the project.
   *
   * Unconditional, not gated on the team being complete. A replacement talent
   * joining a running project with an open seat never completes anything, and
   * used to receive neither, permanently, because nothing runs again
   * afterwards.
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

  /**
   * Which of the two completions this is, read from the position.
   *
   * A guarded UPDATE used to be the latch: matching/team_forming -> matched for
   * the first completion, partially_active -> in_progress for a refill. Both
   * pairs are now one position each, so the writes are no-ops and the position
   * itself is the discriminator - `matching` means work has not started, so
   * this is the team completing; `in_progress` means it has, so this is a seat
   * being refilled. They cannot both apply.
   *
   * Still exactly once, for the same reasons the guarded writes were: the
   * caller holds the project row FOR UPDATE, so two final accepts serialise,
   * and re-entering the all-staffed edge before work starts is impossible - a
   * package only reopens through an assignment termination, which refuses any
   * project that is not running.
   */
  const [project] = await tx
    .select({ status: projects.status })
    .from(projects)
    .where(eq(projects.id, projectId))
    .for('update')
    .limit(1)

  if (project?.status === 'matching') {
    await tx
      .update(projects)
      .set({ teamCompletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(projects.id, projectId), isNull(projects.teamCompletedAt)))
    await appendOutboxEvent(tx, {
      aggregateType: 'project',
      aggregateId: projectId,
      eventType: PROJECT_SUBJECTS.TEAM_COMPLETE,
      payload: { projectId, source },
    })
    return true
  }

  /**
   * A refilled seat puts a running project back to work.
   *
   * Deliberately not gated on the replacement's contracts being signed, unlike
   * matching -> in_progress (see projects.ts). That gate is about work not
   * starting before both parties have signed; here the work is already under
   * way and the rest of the team is mid-milestone. Holding the whole project
   * up until one new signature lands would punish the talents who never left.
   * The contracts are created above and the contract routes still chase them.
   */
  if (project?.status === 'in_progress') {
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

  return false
}
