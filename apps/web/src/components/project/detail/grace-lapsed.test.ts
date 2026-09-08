import { MILESTONE_GRACE_PERIOD_DAYS, type Milestone } from '@kerjacus/shared'
import { describe, expect, it } from 'vitest'
import type { ProjectAssignmentSummary } from '@/hooks/use-projects'
import { graceLapsedMilestones } from './grace-lapsed'

/**
 * The step between "this is late" and "you may act on it".
 *
 * The sweep has told both sides a milestone is overdue since the day it
 * slipped. Nothing brought the owner to the remedy the policy grants once the
 * grace period runs out, so the remedy existed and was never offered.
 */

const NOW = new Date('2026-06-01T00:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000

const TEAM: ProjectAssignmentSummary[] = [
  { workPackageId: 'wp-1', talentUserId: 'u-backend', roleLabel: 'Backend' },
  { workPackageId: 'wp-2', talentUserId: 'u-frontend', roleLabel: 'Frontend' },
]

function milestone(overrides: Partial<Milestone> = {}): Milestone {
  return {
    id: 'm-1',
    projectId: 'p-1',
    workPackageId: 'wp-2',
    assignedTalentId: 'talent-profile-2',
    title: 'Frontend integration',
    description: '',
    milestoneType: 'individual',
    orderIndex: 0,
    amount: 5_000_000,
    status: 'in_progress',
    revisionCount: 0,
    dueDate: new Date(NOW.getTime() - (MILESTONE_GRACE_PERIOD_DAYS + 1) * DAY).toISOString(),
    submittedAt: null,
    completedAt: null,
    metadata: null,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  }
}

describe('milestones past their grace period', () => {
  it('names the seat that answers for the late work', () => {
    expect(graceLapsedMilestones([milestone()], TEAM, NOW)).toEqual([
      { milestoneId: 'm-1', title: 'Frontend integration', assignmentIndex: 1 },
    ])
  })

  /** Overdue is the day the date passes; this threshold is a week later. */
  it('leaves a milestone that is late but still inside the grace period', () => {
    const late = milestone({
      dueDate: new Date(NOW.getTime() - (MILESTONE_GRACE_PERIOD_DAYS - 1) * DAY).toISOString(),
    })

    expect(graceLapsedMilestones([late], TEAM, NOW)).toEqual([])
  })

  it('leaves a milestone that is not due yet', () => {
    const upcoming = milestone({ dueDate: new Date(NOW.getTime() + 5 * DAY).toISOString() })

    expect(graceLapsedMilestones([upcoming], TEAM, NOW)).toEqual([])
  })

  /**
   * After a submission the clock that matters is the owner's own fourteen-day
   * review, so offering to escalate here would let an owner dispute work they
   * have simply not looked at.
   */
  it('leaves work that has already been submitted or judged', () => {
    for (const status of ['submitted', 'approved', 'rejected'] as const) {
      expect(graceLapsedMilestones([milestone({ status })], TEAM, NOW)).toEqual([])
    }
  })

  it('still counts work sent back for revision', () => {
    const returned = milestone({ status: 'revision_requested' })

    expect(graceLapsedMilestones([returned], TEAM, NOW)).toHaveLength(1)
  })

  /**
   * An integration milestone has no work package and no single talent behind
   * it. Dropping it is the point: aiming it at whichever assignment came first
   * is the defect this list exists to avoid repeating.
   */
  it('drops an integration milestone rather than guessing a respondent', () => {
    const integration = milestone({ milestoneType: 'integration', workPackageId: null })

    expect(graceLapsedMilestones([integration], TEAM, NOW)).toEqual([])
  })

  it('drops a milestone whose work package nobody holds', () => {
    const orphan = milestone({ workPackageId: 'wp-gone' })

    expect(graceLapsedMilestones([orphan], TEAM, NOW)).toEqual([])
  })

  it('returns every late milestone, not just the first', () => {
    const backend = milestone({ id: 'm-2', workPackageId: 'wp-1', title: 'Backend API' })

    expect(graceLapsedMilestones([milestone(), backend], TEAM, NOW).map((m) => m.title)).toEqual([
      'Frontend integration',
      'Backend API',
    ])
  })
})
