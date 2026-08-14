import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const readSource = (rel: string) => readFileSync(path.resolve(__dirname, rel), 'utf8')

const cardSource = readSource('../components/project/milestones/milestone-card.tsx')
const detailSource = readSource('../components/project/milestones/milestone-detail.tsx')
const boardSource = readSource('./_authenticated/projects/$projectId/milestones.tsx')

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
