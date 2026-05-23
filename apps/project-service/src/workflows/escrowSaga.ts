import { ApplicationFailure, proxyActivities } from '@temporalio/workflow'
import type * as activities from '../activities/escrow.activities'

const { reserveEscrow, refundEscrow, setProjectStatus, notifySagaComplete } = proxyActivities<
  typeof activities
>({
  startToCloseTimeout: '2 minutes',
  retry: { maximumAttempts: 5 },
})

export type EscrowSagaInput = {
  projectId: string
  amount: number
}

export type EscrowSagaResult = {
  reserved: boolean
  statusUpdated: boolean
  notified: boolean
}

/** Saga: reserve escrow → update project status → notify. Compensates with refund on failure. */
export async function escrowSagaWorkflow(input: EscrowSagaInput): Promise<EscrowSagaResult> {
  // Step 1: reserve escrow funds
  const reserve = await reserveEscrow({ projectId: input.projectId, amount: input.amount })
  if (!reserve.reserved) {
    throw ApplicationFailure.nonRetryable('Failed to reserve escrow', 'ESCROW_RESERVE_FAILED')
  }

  // Step 2: update project status. Compensate if it fails.
  let statusUpdated = false
  try {
    const status = await setProjectStatus({ projectId: input.projectId, status: 'in_progress' })
    statusUpdated = status.updated
    if (!statusUpdated) {
      throw ApplicationFailure.nonRetryable(
        'Status update returned no rows',
        'STATUS_UPDATE_FAILED',
      )
    }
  } catch (err) {
    await refundEscrow({
      projectId: input.projectId,
      amount: input.amount,
      reason: 'status_update_failed',
    })
    throw err
  }

  // Step 3: notify completion. Failure here is non-fatal — saga succeeds with notify=false.
  let notified = true
  try {
    await notifySagaComplete({ projectId: input.projectId, event: 'project.in_progress' })
  } catch {
    notified = false
  }

  return { reserved: true, statusUpdated: true, notified }
}
