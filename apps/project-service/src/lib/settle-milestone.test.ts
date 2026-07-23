import { getDb } from '@kerjacus/db'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { releaseMilestoneEscrow } from './payment-client'
import { settleMilestoneEscrow } from './settle-milestone'

vi.mock('@kerjacus/db', () => ({ getDb: vi.fn(), milestones: {} }))
vi.mock('./payment-client', () => ({ releaseMilestoneEscrow: vi.fn() }))

function stubMilestone(row: unknown) {
  ;(getDb as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    select: () => ({ from: () => ({ where: () => ({ limit: async () => (row ? [row] : []) }) }) }),
  })
}

describe('settleMilestoneEscrow', () => {
  afterEach(() => vi.clearAllMocks())

  it('pays the assigned talent for an approved milestone', async () => {
    stubMilestone({ projectId: 'p1', talentId: 't1', amount: 80000, status: 'approved' })

    const result = await settleMilestoneEscrow('ms-1', 'owner-1')

    expect(result.paid).toBe(true)
    expect(releaseMilestoneEscrow).toHaveBeenCalledWith({
      milestoneId: 'ms-1',
      projectId: 'p1',
      talentId: 't1',
      amount: 80000,
      performedBy: 'owner-1',
    })
  })

  it('does not pay a milestone that is not approved', async () => {
    stubMilestone({ projectId: 'p1', talentId: 't1', amount: 80000, status: 'submitted' })

    const result = await settleMilestoneEscrow('ms-1', 'owner-1')

    expect(result.paid).toBe(false)
    expect(releaseMilestoneEscrow).not.toHaveBeenCalled()
  })

  it('does not pay an integration milestone with no assigned talent', async () => {
    stubMilestone({ projectId: 'p1', talentId: null, amount: 80000, status: 'approved' })

    const result = await settleMilestoneEscrow('ms-1', 'owner-1')

    expect(result.paid).toBe(false)
    expect(releaseMilestoneEscrow).not.toHaveBeenCalled()
  })

  it('does not pay a zero-amount milestone', async () => {
    stubMilestone({ projectId: 'p1', talentId: 't1', amount: 0, status: 'approved' })

    const result = await settleMilestoneEscrow('ms-1', 'owner-1')

    expect(result.paid).toBe(false)
    expect(releaseMilestoneEscrow).not.toHaveBeenCalled()
  })

  it('returns unpaid when the milestone is gone', async () => {
    stubMilestone(null)

    const result = await settleMilestoneEscrow('ms-1', 'owner-1')

    expect(result.paid).toBe(false)
    expect(releaseMilestoneEscrow).not.toHaveBeenCalled()
  })
})
