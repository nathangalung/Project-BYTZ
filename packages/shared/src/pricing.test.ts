import { describe, expect, it } from 'vitest'
import {
  computeProjectPricing,
  milestoneFeeFromTotals,
  platformFeeRate,
  talentShareRate,
} from './pricing'

describe('talentShareRate', () => {
  it('applies the published share at every bracket ceiling', () => {
    expect(talentShareRate(3_000_000)).toBe(0.815)
    expect(talentShareRate(5_000_000)).toBe(0.765)
    expect(talentShareRate(10_000_000)).toBe(0.715)
    expect(talentShareRate(15_000_000)).toBe(0.665)
    expect(talentShareRate(20_000_000)).toBe(0.615)
    expect(talentShareRate(30_000_000)).toBe(0.565)
    expect(talentShareRate(50_000_000)).toBe(0.515)
    expect(talentShareRate(50_000_001)).toBe(0.465)
  })

  it('moves to the next bracket one rupiah over a boundary', () => {
    expect(talentShareRate(3_000_001)).toBe(0.765)
    expect(talentShareRate(5_000_001)).toBe(0.715)
    expect(talentShareRate(10_000_001)).toBe(0.665)
    expect(talentShareRate(15_000_001)).toBe(0.615)
    expect(talentShareRate(20_000_001)).toBe(0.565)
    expect(talentShareRate(30_000_001)).toBe(0.515)
  })

  it('leaves the talent a smaller share as the project grows', () => {
    expect(talentShareRate(1_000_000)).toBeGreaterThan(talentShareRate(100_000_000))
  })
})

describe('platformFeeRate', () => {
  it('is the exact complement of the talent share', () => {
    expect(platformFeeRate(3_000_000)).toBe(0.185)
    expect(platformFeeRate(10_000_000)).toBe(0.285)
    expect(platformFeeRate(50_000_000)).toBe(0.485)
    expect(platformFeeRate(60_000_000)).toBe(0.535)
  })
})

describe('computeProjectPricing', () => {
  it('takes the bracket fee off the project total', () => {
    const r = computeProjectPricing([{ amount: 10_000_000 }])
    expect(r.finalPrice).toBe(10_000_000)
    expect(r.talentPayout).toBe(7_150_000)
    expect(r.platformFee).toBe(2_850_000)
  })

  /**
   * The bracket keys on the project, not the package. Bracketing per package
   * and summing would charge this 60 juta project the 15 juta rate, and would
   * make the platform's take a function of how finely the AI decomposed the
   * PRD.
   */
  it('charges a split project the rate its total earns, not its packages', () => {
    const split = computeProjectPricing([
      { amount: 15_000_000 },
      { amount: 15_000_000 },
      { amount: 15_000_000 },
      { amount: 15_000_000 },
    ])
    const whole = computeProjectPricing([{ amount: 60_000_000 }])
    expect(split.finalPrice).toBe(60_000_000)
    expect(split.platformFee).toBe(32_100_000)
    expect(split.platformFee / split.finalPrice).toBeCloseTo(0.535, 10)
    expect(split.platformFee).toBe(whole.platformFee)
    expect(split.talentPayout).toBe(whole.talentPayout)
  })

  it('always reconciles finalPrice to platformFee plus talentPayout', () => {
    for (const amount of [1, 999, 2_999_999, 7_333_333, 33_333_333, 123_456_789]) {
      const r = computeProjectPricing([{ amount }])
      expect(r.platformFee + r.talentPayout).toBe(r.finalPrice)
    }
  })

  it('splits the payout across packages in proportion to their amounts', () => {
    const r = computeProjectPricing([{ amount: 6_000_000 }, { amount: 2_000_000 }])
    expect(r.packagePayouts).toEqual([4_290_000, 1_430_000])
  })

  it('allocates every rupiah of the payout, letting the last package absorb rounding', () => {
    const r = computeProjectPricing([
      { amount: 3_333_333 },
      { amount: 3_333_333 },
      { amount: 3_333_334 },
    ])
    expect(r.packagePayouts.reduce((s, p) => s + p, 0)).toBe(r.talentPayout)
  })

  it('never allocates a package more than its own amount', () => {
    const r = computeProjectPricing([{ amount: 1 }, { amount: 1 }, { amount: 9_999_998 }])
    for (const [i, payout] of r.packagePayouts.entries()) {
      expect(payout).toBeGreaterThanOrEqual(0)
      expect(payout).toBeLessThanOrEqual([1, 1, 9_999_998][i] as number)
    }
    expect(r.packagePayouts.reduce((s, p) => s + p, 0)).toBe(r.talentPayout)
  })

  it('keeps the package ratio equal to the project ratio, which settlement reads', () => {
    const r = computeProjectPricing([{ amount: 12_000_000 }, { amount: 8_000_000 }])
    const projectRatio = r.talentPayout / r.finalPrice
    expect((r.packagePayouts[0] as number) / 12_000_000).toBeCloseTo(projectRatio, 6)
    expect((r.packagePayouts[1] as number) / 8_000_000).toBeCloseTo(projectRatio, 6)
  })

  it('returns zeros for an empty project', () => {
    expect(computeProjectPricing([])).toEqual({
      finalPrice: 0,
      platformFee: 0,
      talentPayout: 0,
      packagePayouts: [],
    })
  })

  it('prices an unpriced package at zero rather than charging for it', () => {
    const r = computeProjectPricing([{ amount: 0 }, { amount: 0 }])
    expect(r).toEqual({ finalPrice: 0, platformFee: 0, talentPayout: 0, packagePayouts: [0, 0] })
  })
})

describe('milestoneFeeFromTotals', () => {
  it('slices the fee in proportion to the work package ratio', () => {
    // 10jt project at the <=10jt bracket: talent keeps 71.5%.
    const gross = 10_000_000
    const payout = 7_150_000
    expect(milestoneFeeFromTotals(gross, payout, gross)).toBe(2_850_000)
    // Half the package carries half the fee.
    expect(milestoneFeeFromTotals(5_000_000, payout, gross)).toBe(1_425_000)
  })

  it('refuses a ratio that would take the whole milestone or go negative', () => {
    // payout of zero means the fee would be 100% of the milestone.
    expect(milestoneFeeFromTotals(1_000, 0, 10_000)).toBeNull()
    // A payout above gross would make the fee negative.
    expect(milestoneFeeFromTotals(1_000, 20_000, 10_000)).toBeNull()
  })

  it('refuses unusable totals rather than dividing by zero', () => {
    expect(milestoneFeeFromTotals(1_000, 500, 0)).toBeNull()
    expect(milestoneFeeFromTotals(1_000, 500, null)).toBeNull()
    expect(milestoneFeeFromTotals(1_000, null, 10_000)).toBeNull()
  })

  /**
   * The Go mirror is generated from this function, so its rounding order is
   * part of the cross-language contract: multiply then divide, then round.
   */
  it('rounds after multiplying, not before', () => {
    // 333 * 715000 / 1000000 = 238.095 -> 238 talent, fee 95.
    expect(milestoneFeeFromTotals(333, 715_000, 1_000_000)).toBe(95)
  })
})

/**
 * The rounding correction lands on the last package that carries money, so
 * there has to be one. With nothing priced the index is -1 and the correction
 * is skipped rather than writing to the end of the array.
 */
describe('computeProjectPricing with nothing priced', () => {
  it('leaves every payout at zero rather than correcting into the last slot', () => {
    const result = computeProjectPricing([{ amount: 0 }, { amount: 0 }])

    expect(result.finalPrice).toBe(0)
    expect(result.talentPayout).toBe(0)
    expect(result.platformFee).toBe(0)
    expect(result.packagePayouts).toEqual([0, 0])
  })

  it('holds the invariant on an empty package list', () => {
    const result = computeProjectPricing([])

    expect(result.finalPrice).toBe(result.talentPayout + result.platformFee)
    expect(result.packagePayouts).toEqual([])
  })
})

/**
 * The last package and the last package that carries money are not the same
 * one. An unpriced package at the end is a real shape: normalizePrdContent
 * writes 0 for an amount the model omitted or garbled, and the work package is
 * still created. Pushing the remainder into it would clamp the remainder away
 * against that package's own amount of zero, so the payouts would sum to less
 * than the talentPayout the escrow was funded for, and the per-package ratio
 * that milestone settlement reads would no longer match the project's.
 */
describe('computeProjectPricing with an unpriced package at the end', () => {
  it('lands the rounding remainder on the last package that carries money', () => {
    const result = computeProjectPricing([
      { amount: 1_000_001 },
      { amount: 2_000_002 },
      { amount: 0 },
    ])

    expect(result.finalPrice).toBe(3_000_003)
    expect(result.talentPayout).toBe(2_295_002)
    // Pro rata puts 1_530_002 on the middle package; the -1 remainder lands there.
    expect(result.packagePayouts).toEqual([765_001, 1_530_001, 0])
    expect(result.packagePayouts.at(-1)).toBe(0)
    expect(result.packagePayouts.reduce((s, p) => s + p, 0)).toBe(result.talentPayout)
  })
})

/**
 * A non-finite amount must not quote a project at zero.
 *
 * Nothing in production produces one: the route validates
 * `z.number().int().positive()` and work_packages.amount is an integer column
 * under CHECK (amount > 0). The guard on the correction exists anyway, because
 * without it a non-finite total makes lastPriced -1 and the correction writes
 * to packagePayouts[-1] - a property that is not an element, so it survives
 * every length check and every sum while corrupting nothing visibly. The right
 * answer to corrupt pricing data is an unusable quote: a `|| 0` added here
 * later would price a corrupt project as free.
 */
describe('computeProjectPricing on a non-finite amount', () => {
  it('yields an unusable quote rather than a plausible zero', () => {
    const result = computeProjectPricing([{ amount: Number.NaN }])

    expect(Number.isNaN(result.finalPrice)).toBe(true)
    expect(Number.isNaN(result.talentPayout)).toBe(true)
    expect(result.talentPayout).not.toBe(0)
  })

  it('leaves the payout array with elements only, never an index of -1', () => {
    const result = computeProjectPricing([{ amount: Number.NaN }])

    expect(result.packagePayouts).toHaveLength(1)
    expect(Object.keys(result.packagePayouts)).toEqual(['0'])
  })
})
