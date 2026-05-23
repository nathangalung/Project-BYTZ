import { defineSignal, proxyActivities, setHandler, sleep } from '@temporalio/workflow'
import type * as activities from '../activities/milestone.activities'

const { checkMilestoneReleased, releaseEscrow, notifyAutoRelease } = proxyActivities<
  typeof activities
>({
  startToCloseTimeout: '1 minute',
  retry: { maximumAttempts: 3 },
})

export const milestoneApprovedSignal = defineSignal('milestoneApproved')

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000

export type MilestoneAutoReleaseResult = {
  released: boolean
  reason?: 'already_approved' | 'already_released' | 'auto_released'
}

/** Wait 14 days, then auto-release milestone unless approval signal fires. */
export async function milestoneAutoReleaseWorkflow(
  milestoneId: string,
  delayMs: number = FOURTEEN_DAYS_MS,
): Promise<MilestoneAutoReleaseResult> {
  let approved = false
  setHandler(milestoneApprovedSignal, () => {
    approved = true
  })

  await sleep(delayMs)

  if (approved) {
    return { released: false, reason: 'already_approved' }
  }

  const state = await checkMilestoneReleased(milestoneId)
  if (state.alreadyReleased) {
    return { released: false, reason: 'already_released' }
  }

  const result = await releaseEscrow(milestoneId)
  if (!result.released) {
    return { released: false, reason: 'already_released' }
  }

  await notifyAutoRelease(milestoneId)
  return { released: true, reason: 'auto_released' }
}
