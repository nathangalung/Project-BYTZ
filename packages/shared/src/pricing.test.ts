import { describe, expect, it } from 'vitest'
import { computeProjectPricing, marginRateForValue } from './pricing'

describe('marginRateForValue', () => {
  it('charges the highest rate on the smallest projects', () => {
    expect(marginRateForValue(8_000_000)).toBeCloseTo(0.275)
  })

  it('lowers the rate as the project grows', () => {
    expect(marginRateForValue(30_000_000)).toBeCloseTo(0.225)
    expect(marginRateForValue(75_000_000)).toBeCloseTo(0.175)
    expect(marginRateForValue(150_000_000)).toBeCloseTo(0.125)
  })

  it('is inversely proportional to project size', () => {
    expect(marginRateForValue(8_000_000)).toBeGreaterThan(marginRateForValue(150_000_000))
  })
})

describe('computeProjectPricing', () => {
  it('sums the talent payout across packages and keeps it whole', () => {
    const r = computeProjectPricing([{ talentPayout: 5_000_000 }, { talentPayout: 3_000_000 }])
    expect(r.talentPayout).toBe(8_000_000)
  })

  it('adds a tiered platform fee on top of the payout', () => {
    const r = computeProjectPricing([{ talentPayout: 8_000_000 }])
    expect(r.platformFee).toBe(3_034_483)
    expect(r.finalPrice).toBe(11_034_483)
  })

  it('makes the fee the tiered share of the final price', () => {
    const r = computeProjectPricing([{ talentPayout: 8_000_000 }])
    expect(r.platformFee / r.finalPrice).toBeCloseTo(0.275, 3)
  })

  it('returns zeros for an empty project', () => {
    expect(computeProjectPricing([])).toEqual({ talentPayout: 0, platformFee: 0, finalPrice: 0 })
  })
})
