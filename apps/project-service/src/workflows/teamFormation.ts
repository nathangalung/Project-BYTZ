import { condition, defineSignal, proxyActivities, setHandler, sleep } from '@temporalio/workflow'
import type * as activities from '../activities/team-formation.activities'

const { getTeamStatus, finalizeTeam, escalateTeamFormation } = proxyActivities<typeof activities>({
  startToCloseTimeout: '2 minutes',
  retry: { maximumAttempts: 3 },
})

export const talentAcceptedSignal =
  defineSignal<[{ workPackageId: string; talentId: string }]>('talentAccepted')
export const talentDeclinedSignal =
  defineSignal<[{ workPackageId: string; talentId: string }]>('talentDeclined')
export const teamCompleteSignal = defineSignal('teamComplete')

const TEAM_FORMATION_DEADLINE_MS = 14 * 24 * 60 * 60 * 1000
const POLL_INTERVAL_MS = 60 * 60 * 1000

export type TeamFormationResult = {
  outcome: 'complete' | 'escalated' | 'deadline'
  assigned: number
  totalPackages: number
}

/** Coordinate per-work-package matching, accept/decline signals, 14-day escalation. */
export async function teamFormationWorkflow(
  projectId: string,
  deadlineMs: number = TEAM_FORMATION_DEADLINE_MS,
): Promise<TeamFormationResult> {
  let externallyMarkedComplete = false
  let declinedCount = 0

  setHandler(talentAcceptedSignal, () => {
    // Re-check status on next loop tick; no in-workflow DB calls.
  })
  setHandler(talentDeclinedSignal, () => {
    declinedCount += 1
  })
  setHandler(teamCompleteSignal, () => {
    externallyMarkedComplete = true
  })

  const startTimer = sleep(deadlineMs)
  let deadlineHit = false
  startTimer.then(() => {
    deadlineHit = true
  })

  while (true) {
    const status = await getTeamStatus(projectId)
    if (status.isComplete || externallyMarkedComplete) {
      const final = await finalizeTeam(projectId)
      return {
        outcome: final.updated ? 'complete' : 'complete',
        assigned: status.assigned,
        totalPackages: status.totalPackages,
      }
    }

    if (deadlineHit) {
      await escalateTeamFormation(projectId, 'deadline_exceeded')
      return {
        outcome: 'escalated',
        assigned: status.assigned,
        totalPackages: status.totalPackages,
      }
    }

    // Wait for either a signal or the poll interval, whichever comes first.
    await Promise.race([
      condition(
        () => deadlineHit || externallyMarkedComplete || declinedCount > 0,
        POLL_INTERVAL_MS,
      ),
      sleep(POLL_INTERVAL_MS),
    ])
    declinedCount = 0
  }
}
