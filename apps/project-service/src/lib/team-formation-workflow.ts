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
