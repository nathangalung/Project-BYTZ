import type { MilestoneStatus } from '@kerjacus/shared'
import {
  milestoneApprovedSignal,
  milestoneAutoReleaseWorkflow,
} from '../workflows/milestoneAutoRelease'
import {
  getTemporalClient,
  milestoneAutoReleaseWorkflowId,
  TEMPORAL_TASK_QUEUE,
} from './temporal-client'

/**
 * Keep the milestone auto-release timer in step with the milestone's status.
 *
 * Fire-and-forget: if Temporal is unreachable the caller carries on and the
 * scheduled sweep settles the milestone instead.
 */
export async function triggerTemporalForMilestoneStatus(
  milestoneId: string,
  status: MilestoneStatus,
): Promise<void> {
  if (
    status !== 'submitted' &&
    status !== 'approved' &&
    status !== 'rejected' &&
    status !== 'revision_requested'
  ) {
    return
  }

  const client = await getTemporalClient()
  if (!client) return

  const workflowId = milestoneAutoReleaseWorkflowId(milestoneId)

  if (status === 'submitted') {
    await client.workflow.start(milestoneAutoReleaseWorkflow, {
      taskQueue: TEMPORAL_TASK_QUEUE,
      workflowId,
      args: [milestoneId],
      workflowIdReusePolicy: 'ALLOW_DUPLICATE',
    })
    return
  }

  // A revision buys the owner a fresh 14 days on the resubmission, so the timer
  // from the previous submission has to die first. ALLOW_DUPLICATE only lets a
  // new run start once the old one is closed: without this terminate, the
  // resubmit's start throws WorkflowExecutionAlreadyStarted, the caller swallows
  // it, and the original workflow releases escrow on the leftover of the FIRST
  // window -- work the owner never got the contracted time to review.
  if (status === 'revision_requested') {
    try {
      await client.workflow.getHandle(workflowId).terminate('milestone revision requested')
    } catch {
      // no open workflow (never submitted, or already closed); nothing to stop.
    }
    return
  }

  // status === 'approved' or 'rejected' -> signal the workflow to short-circuit.
  try {
    const handle = client.workflow.getHandle(workflowId)
    await handle.signal(milestoneApprovedSignal)
  } catch {
    // workflow may not exist (e.g., never submitted); ignore.
  }
}
