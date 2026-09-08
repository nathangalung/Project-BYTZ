import { PLATFORM_FEE_BRACKETS } from '@kerjacus/shared'
import { describe, expect, it } from 'vitest'
import { BUDGET_BANDS, budgetBand } from './budget-ranges'

/**
 * The bands exist to put an owner's answer inside one fee classification.
 * These assert that intent against the fee table itself, which is the only
 * thing that makes "follow the margin" checkable rather than a claim.
 */

describe('the budget bands the wizard offers', () => {
  const feeEdges = new Set(PLATFORM_FEE_BRACKETS.map((bracket) => bracket.maxFee))

  it('cuts every band on a fee-table boundary up to the flat top bracket', () => {
    const edges = BUDGET_BANDS.flatMap((band) => [band.min, band.max]).filter(
      (edge) => edge > 0 && edge <= Math.max(...feeEdges),
    )

    expect(edges.every((edge) => feeEdges.has(edge))).toBe(true)
  })

  /** A gap or an overlap sends the same budget to two different answers. */
  it('runs continuously from zero with no gap between bands', () => {
    expect(BUDGET_BANDS[0].min).toBe(0)
    for (let i = 1; i < BUDGET_BANDS.length; i++) {
      expect(BUDGET_BANDS[i].min).toBe(BUDGET_BANDS[i - 1].max)
    }
  })

  it('never offers a band whose maximum is below its minimum', () => {
    // projects.budget CHECK rejects an inverted range at the database.
    expect(BUDGET_BANDS.every((band) => band.max > band.min)).toBe(true)
  })

  it('resolves a key the wizard offers', () => {
    expect(budgetBand('budget_10_20m')).toEqual({
      key: 'budget_10_20m',
      min: 10_000_000,
      max: 20_000_000,
    })
  })

  /** "Belum tentukan" and any retired key land here, not on a guessed band. */
  it('returns null for a key it does not offer', () => {
    expect(budgetBand('budget_not_decided')).toBeNull()
    expect(budgetBand('budget_under_20m')).toBeNull()
  })
})
