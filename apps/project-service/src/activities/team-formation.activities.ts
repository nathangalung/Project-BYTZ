import { getDb, outboxEvents, projects, workPackages } from '@kerjacus/db'
import { and, eq, inArray } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'

/** Snapshot of team formation state. */
export type TeamStatusSnapshot = {
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
    if (wp.status === 'assigned' || wp.status === 'in_progress' || wp.status === 'completed') {
      assigned += 1
    } else if (wp.status === 'pending_acceptance') {
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

/** Promote a project to MATCHED state once team is complete. */
export async function finalizeTeam(projectId: string): Promise<{ updated: boolean }> {
  const db = getDb()
  return await db.transaction(async (tx) => {
    const result = await tx
      .update(projects)
      .set({ status: 'matched', updatedAt: new Date() })
      .where(
        and(eq(projects.id, projectId), inArray(projects.status, ['matching', 'team_forming'])),
      )
      .returning({ id: projects.id })

    if (result.length === 0) return { updated: false }

    await tx.insert(outboxEvents).values({
      id: uuidv7(),
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
  const db = getDb()
  await db.insert(outboxEvents).values({
    id: uuidv7(),
    aggregateType: 'project',
    aggregateId: projectId,
    eventType: 'project.team.escalated',
    payload: { projectId, reason, source: 'temporal' },
  })
}
