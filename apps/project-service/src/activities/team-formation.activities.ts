import { getDb, projects, workPackages } from '@kerjacus/db'
import { and, eq, isNull } from 'drizzle-orm'
import { appendOutboxEvent } from '../lib/outbox'

/**
 * Snapshot of team formation state.
 *
 * The three counters keep their names through the work_package_status
 * collapse. They are buckets, not enum values - `assigned` has always counted
 * in_progress and completed too - and this shape is a Temporal activity
 * result, so it is written into workflow history and read back on replay. A
 * rename would leave an in-flight workflow decoding a payload whose keys no
 * longer exist; teamFormation.ts returns `assigned` in its own result as well.
 */
type TeamStatusSnapshot = {
  totalPackages: number
  assigned: number
  pending: number
  unassigned: number
  isComplete: boolean
}

/** Inspect work package fulfillment for a project. */
export async function getTeamStatus(projectId: string): Promise<TeamStatusSnapshot> {
  const db = getDb()
  const rows = await db
    .select({ id: workPackages.id, status: workPackages.status })
    .from(workPackages)
    .where(eq(workPackages.projectId, projectId))

  let assigned = 0
  let pending = 0
  let unassigned = 0
  for (const wp of rows) {
    if (wp.status === 'staffed' || wp.status === 'in_progress' || wp.status === 'completed') {
      assigned += 1
    } else if (wp.status === 'offered') {
      pending += 1
    } else {
      unassigned += 1
    }
  }
  return {
    totalPackages: rows.length,
    assigned,
    pending,
    unassigned,
    isComplete: rows.length > 0 && assigned === rows.length,
  }
}

/**
 * Record that a project's team is complete, once.
 *
 * `matched` used to be the position this wrote, and the write was the latch.
 * The team being complete is not a position - the project is matching until
 * work starts either way - so team_completed_at is both the record and the
 * latch: still null means this call is the one that completed the team.
 */
export async function finalizeTeam(projectId: string): Promise<{ updated: boolean }> {
  const db = getDb()
  return await db.transaction(async (tx) => {
    const result = await tx
      .update(projects)
      .set({ teamCompletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(projects.id, projectId),
          eq(projects.status, 'matching'),
          isNull(projects.teamCompletedAt),
        ),
      )
      .returning({ id: projects.id })

    if (result.length === 0) return { updated: false }

    await appendOutboxEvent(tx, {
      aggregateType: 'project',
      aggregateId: projectId,
      eventType: 'project.team.complete',
      payload: { projectId, source: 'temporal' },
    })
    return { updated: true }
  })
}

/** Emit an escalation event when team formation deadline is reached. */
export async function escalateTeamFormation(projectId: string, reason: string): Promise<void> {
  await appendOutboxEvent(getDb(), {
    aggregateType: 'project',
    aggregateId: projectId,
    eventType: 'project.team.escalated',
    payload: { projectId, reason, source: 'temporal' },
  })
}
