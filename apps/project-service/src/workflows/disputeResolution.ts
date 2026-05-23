import { condition, defineSignal, proxyActivities, setHandler, sleep } from '@temporalio/workflow'
import type * as activities from '../activities/dispute.activities'

const { advanceDisputePhase, isDisputeResolved } = proxyActivities<typeof activities>({
  startToCloseTimeout: '1 minute',
  retry: { maximumAttempts: 3 },
})

export const disputeResolvedSignal = defineSignal('disputeResolved')

const DAY_MS = 24 * 60 * 60 * 1000

export type DisputeResolutionResult = {
  outcome: 'resolved' | 'binding_decision'
  phase: 'direct' | 'mediation' | 'binding'
}

/** Three-phase dispute resolution: 3d direct → 5d mediation → 2d binding. */
export async function disputeResolutionWorkflow(
  disputeId: string,
  options: { directDays?: number; mediationDays?: number; bindingDays?: number } = {},
): Promise<DisputeResolutionResult> {
  const directMs = (options.directDays ?? 3) * DAY_MS
  const mediationMs = (options.mediationDays ?? 5) * DAY_MS
  const bindingMs = (options.bindingDays ?? 2) * DAY_MS

  let resolved = false
  setHandler(disputeResolvedSignal, () => {
    resolved = true
  })

  // Phase 1: direct resolution
  await advanceDisputePhase(disputeId, 'direct')
  await condition(() => resolved, directMs)
  if (resolved || (await isDisputeResolved(disputeId))) {
    return { outcome: 'resolved', phase: 'direct' }
  }

  // Phase 2: admin mediation
  await advanceDisputePhase(disputeId, 'mediation')
  await condition(() => resolved, mediationMs)
  if (resolved || (await isDisputeResolved(disputeId))) {
    return { outcome: 'resolved', phase: 'mediation' }
  }

  // Phase 3: binding decision
  await advanceDisputePhase(disputeId, 'binding')
  await sleep(bindingMs)
  return { outcome: 'binding_decision', phase: 'binding' }
}
