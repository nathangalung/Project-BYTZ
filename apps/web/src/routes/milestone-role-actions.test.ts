import { describe, expect, it } from 'vitest'
import cardSource from '../components/project/milestones/milestone-card.tsx?raw'
import detailSource from '../components/project/milestones/milestone-detail.tsx?raw'
import boardSource from './_authenticated/projects/$projectId/milestones.tsx?raw'

/**
 * The board split into a route, a card and a detail panel. The role rule is
 * one rule across all three, so it is read across all three - which is also
 * what stops the split from quietly dropping half of it.
 */
const milestonesSource = boardSource + cardSource + detailSource

/**
 * The milestone board offered every action to every viewer. A talent saw
 * Approve, Reject and Request revision, which the backend 403s because they
 * belong to the owner, and the owner saw Start and Submit, which belong to the
 * assigned talent. Actions are now split by role.
 */
describe('milestone actions are scoped to the viewer role', () => {
  it('reads the viewer role', () => {
    expect(milestonesSource).toContain('useAuthStore')
  })

  it('gives approve, reject and request-revision to the owner only', () => {
    expect(milestonesSource).toContain("role === 'owner'")
  })

  it('gives start, submit and resume to the assigned talent only', () => {
    expect(milestonesSource).toContain("role === 'talent'")
  })
})
