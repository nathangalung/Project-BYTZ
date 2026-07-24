import { describe, expect, it } from 'vitest'
import {
  computeProjectPricing,
  ownerAmountForPayout,
  platformMarkupRate,
  priceWorkPackage,
} from './pricing'

describe('platformMarkupRate', () => {
  it('applies each payout bracket', () => {
    expect(platformMarkupRate(5_000_000)).toBe(0.28)
    expect(platformMarkupRate(15_000_000)).toBe(0.24)
    expect(platformMarkupRate(35_000_000)).toBe(0.2)
    expect(platformMarkupRate(35_000_001)).toBe(0.16)
  })

  it('drops to the next bracket one rupiah over a boundary', () => {
    expect(platformMarkupRate(5_000_001)).toBe(0.24)
    expect(platformMarkupRate(15_000_001)).toBe(0.2)
  })

  it('takes a smaller markup on larger payouts', () => {
    expect(platformMarkupRate(1_000_000)).toBeGreaterThan(platformMarkupRate(100_000_000))
  })
})

describe('ownerAmountForPayout', () => {
  it('marks the payout up by its bracket', () => {
    expect(ownerAmountForPayout(5_000_000)).toBe(6_400_000)
    expect(ownerAmountForPayout(15_000_000)).toBe(18_600_000)
    expect(ownerAmountForPayout(35_000_000)).toBe(42_000_000)
  })

  it('returns zero for a non-positive payout', () => {
    expect(ownerAmountForPayout(0)).toBe(0)
    expect(ownerAmountForPayout(-1)).toBe(0)
  })

  // Declining brackets make the owner price non-monotonic at a boundary: a
  // 5.00 juta payout prices higher than 5.000001 juta. Inherent to the scheme.
  it('can price a smaller payout above a larger one across a boundary', () => {
    expect(ownerAmountForPayout(5_000_000)).toBeGreaterThan(ownerAmountForPayout(5_000_001))
  })
})

describe('priceWorkPackage', () => {
  it('splits a payout into owner amount, fee and payout', () => {
    expect(priceWorkPackage(5_000_000)).toEqual({
      amount: 6_400_000,
      platformFee: 1_400_000,
      talentPayout: 5_000_000,
    })
  })

  it('keeps the fee as the exact difference, no rounding drift', () => {
    const r = priceWorkPackage(7_333_333)
    expect(r.talentPayout).toBe(7_333_333)
    expect(r.amount).toBe(9_093_333)
    expect(r.platformFee).toBe(r.amount - r.talentPayout)
  })

  it('returns zeros for a non-positive payout', () => {
    expect(priceWorkPackage(0)).toEqual({ amount: 0, platformFee: 0, talentPayout: 0 })
  })
})

describe('computeProjectPricing', () => {
  it('sums the priced packages into the project totals', () => {
    const r = computeProjectPricing([
      { amount: 6_400_000, talentPayout: 5_000_000 },
      { amount: 18_600_000, talentPayout: 15_000_000 },
    ])
    expect(r.finalPrice).toBe(25_000_000)
    expect(r.talentPayout).toBe(20_000_000)
    expect(r.platformFee).toBe(5_000_000)
  })

  it('always reconciles finalPrice to platformFee plus talentPayout', () => {
    const r = computeProjectPricing([{ amount: 9_093_333, talentPayout: 7_333_333 }])
    expect(r.platformFee + r.talentPayout).toBe(r.finalPrice)
  })

  it('returns zeros for an empty project', () => {
    expect(computeProjectPricing([])).toEqual({ finalPrice: 0, platformFee: 0, talentPayout: 0 })
  })
})
