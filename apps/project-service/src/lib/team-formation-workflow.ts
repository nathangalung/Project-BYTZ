import { teamCompleteSignal, teamFormationWorkflow } from '../workflows/teamFormation'
import { getTemporalClient, TEMPORAL_TASK_QUEUE, teamFormationWorkflowId } from './temporal-client'

/**
 * Start the 14-day team-formation escalation workflow for a project.
 *
 * Fire-and-forget: if Temporal is unreachable the caller carries on; the timer
 * is a safety net, not part of the staffing transaction. Reuse policy allows a
 * duplicate so a caller that cannot cheaply tell first-entry from re-entry stays
 * correct -- prefer to start only on the first move into team_forming.
 */
export async function startTeamFormationWorkflow(projectId: string): Promise<void> {
  const client = await getTemporalClient()
  if (!client) return
  await client.workflow.start(teamFormationWorkflow, {
    taskQueue: TEMPORAL_TASK_QUEUE,
    workflowId: teamFormationWorkflowId(projectId),
    args: [projectId],
    workflowIdReusePolicy: 'ALLOW_DUPLICATE',
  })
}

/** Signal the team-formation workflow that the team is complete. */
export async function signalTeamComplete(projectId: string): Promise<void> {
  const client = await getTemporalClient()
  if (!client) return
  try {
    const handle = client.workflow.getHandle(teamFormationWorkflowId(projectId))
    await handle.signal(teamCompleteSignal)
  } catch {
    // workflow may not exist; ignore.
  }
}

/**
 * Whether a team-formation workflow already exists for this project.
 *
 * Tri-state on purpose. `null` means Temporal could not answer, which is not
 * the same as "no workflow": treating an unreachable server as absence would
 * start a second run for a project whose first one already closed, and
 * escalate it to the owner twice.
 *
 * Matched on the error name rather than `instanceof`, because the SDK renames
 * and re-exports this class across versions and a failed instanceof here reads
 * as "unknown" forever.
 */
export async function hasTeamFormationWorkflow(projectId: string): Promise<boolean | null> {
  const client = await getTemporalClient()
  if (!client) return null
  try {
    await client.workflow.getHandle(teamFormationWorkflowId(projectId)).describe()
    return true
  } catch (err) {
    if ((err as { name?: string })?.name === 'WorkflowNotFoundError') return false
    return null
  }
}
