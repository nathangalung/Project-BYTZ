import { getDb } from '@kerjacus/db'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { releaseMilestoneEscrow } from './payment-client'
import { computeMilestoneFee, settleMilestoneEscrow } from './settle-milestone'

vi.mock('@kerjacus/db', () => ({ getDb: vi.fn(), milestones: {}, projects: {}, workPackages: {} }))
vi.mock('@kerjacus/logger', () => ({ createLogger: () => ({ warn: vi.fn() }) }))
vi.mock('./payment-client', () => ({ releaseMilestoneEscrow: vi.fn() }))

// Each select() call shifts the next scripted row set.
function stubSelects(rowSets: unknown[][]) {
  const queue = [...rowSets]
  ;(getDb as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => queue.shift() ?? [] }) }),
    }),
  })
}

describe('computeMilestoneFee', () => {
  afterEach(() => vi.clearAllMocks())

  it('derives the fee from the work package ratio', async () => {
    stubSelects([[{ amount: 100000, talentPayout: 51500 }]])

    const fee = await computeMilestoneFee({ amount: 80000, workPackageId: 'wp1', projectId: 'p1' })

    expect(fee).toBe(80000 - Math.round((80000 * 51500) / 100000))
  })

  it('falls back to the project totals without a work package', async () => {
    stubSelects([[{ finalPrice: 200000, talentPayout: 103000 }]])

    const fee = await computeMilestoneFee({ amount: 80000, workPackageId: null, projectId: 'p1' })

    expect(fee).toBe(80000 - Math.round(80000 * 0.515))
  })

  it('returns zero when no pricing data exists', async () => {
    stubSelects([[], []])

    const fee = await computeMilestoneFee({ amount: 80000, workPackageId: 'wp1', projectId: 'p1' })

    expect(fee).toBe(0)
  })

  it('pays the talent in full on a corrupted ratio', async () => {
    stubSelects([[{ amount: 100000, talentPayout: 0 }]])

    const fee = await computeMilestoneFee({ amount: 80000, workPackageId: 'wp1', projectId: 'p1' })

    expect(fee).toBe(0)
  })
})

describe('settleMilestoneEscrow', () => {
  afterEach(() => vi.clearAllMocks())

  it('pays the talent share and books the fee for an approved milestone', async () => {
    stubSelects([
      [
        {
          projectId: 'p1',
          talentId: 't1',
          workPackageId: 'wp1',
          amount: 80000,
          status: 'approved',
        },
      ],
      [{ amount: 100000, talentPayout: 51500 }],
    ])

    const result = await settleMilestoneEscrow('ms-1', 'owner-1')

    expect(result.paid).toBe(true)
    expect(releaseMilestoneEscrow).toHaveBeenCalledWith({
      milestoneId: 'ms-1',
      projectId: 'p1',
      talentId: 't1',
      amount: 80000,
      feeAmount: 38800,
      performedBy: 'owner-1',
    })
  })

  it('does not pay a milestone that is not approved', async () => {
    stubSelects([
      [
        {
          projectId: 'p1',
          talentId: 't1',
          workPackageId: 'wp1',
          amount: 80000,
          status: 'submitted',
        },
      ],
    ])

    const result = await settleMilestoneEscrow('ms-1', 'owner-1')

    expect(result.paid).toBe(false)
    expect(releaseMilestoneEscrow).not.toHaveBeenCalled()
  })

  it('does not pay an integration milestone with no assigned talent', async () => {
    stubSelects([
      [{ projectId: 'p1', talentId: null, workPackageId: null, amount: 80000, status: 'approved' }],
    ])

    const result = await settleMilestoneEscrow('ms-1', 'owner-1')

    expect(result.paid).toBe(false)
    expect(releaseMilestoneEscrow).not.toHaveBeenCalled()
  })

  it('does not pay a zero-amount milestone', async () => {
    stubSelects([
      [{ projectId: 'p1', talentId: 't1', workPackageId: 'wp1', amount: 0, status: 'approved' }],
    ])

    const result = await settleMilestoneEscrow('ms-1', 'owner-1')

    expect(result.paid).toBe(false)
    expect(releaseMilestoneEscrow).not.toHaveBeenCalled()
  })

  it('returns unpaid when the milestone is gone', async () => {
    stubSelects([[]])

    const result = await settleMilestoneEscrow('ms-1', 'owner-1')

    expect(result.paid).toBe(false)
    expect(releaseMilestoneEscrow).not.toHaveBeenCalled()
  })
})
