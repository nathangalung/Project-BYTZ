import { describe, expect, it } from 'vitest'
import { computeProjectPricing, platformFeeRate, talentShareOfAmount } from './pricing'

describe('platformFeeRate', () => {
  it('applies each project-fee bracket', () => {
    expect(platformFeeRate(3_000_000)).toBe(0.185)
    expect(platformFeeRate(5_000_000)).toBe(0.235)
    expect(platformFeeRate(10_000_000)).toBe(0.285)
    expect(platformFeeRate(15_000_000)).toBe(0.335)
    expect(platformFeeRate(20_000_000)).toBe(0.385)
    expect(platformFeeRate(30_000_000)).toBe(0.435)
    expect(platformFeeRate(50_000_000)).toBe(0.485)
    expect(platformFeeRate(50_000_001)).toBe(0.535)
  })

  it('takes the next bracket one rupiah over a boundary', () => {
    expect(platformFeeRate(3_000_001)).toBe(0.235)
  })

  it('takes a larger share on larger projects', () => {
    expect(platformFeeRate(1_000_000)).toBeLessThan(platformFeeRate(100_000_000))
  })
})

describe('computeProjectPricing', () => {
  it('splits the project fee into platform fee and talent payout', () => {
    const r = computeProjectPricing([{ amount: 6_000_000 }, { amount: 3_600_000 }])
    expect(r.finalPrice).toBe(9_600_000)
    expect(r.platformFee).toBe(2_736_000)
    expect(r.talentPayout).toBe(6_864_000)
  })

  it('always reconciles finalPrice to platformFee plus talentPayout', () => {
    const r = computeProjectPricing([{ amount: 7_333_333 }])
    expect(r.platformFee + r.talentPayout).toBe(r.finalPrice)
  })

  it('returns zeros for an empty project', () => {
    expect(computeProjectPricing([])).toEqual({ finalPrice: 0, platformFee: 0, talentPayout: 0 })
  })
})

describe('talentShareOfAmount', () => {
  it('gives the talent the bracket remainder of a work package amount', () => {
    expect(talentShareOfAmount(6_000_000, 9_600_000)).toBe(4_290_000)
  })
})
