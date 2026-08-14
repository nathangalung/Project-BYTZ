import { describe, expect, it } from 'vitest'
import { PLACEMENT_FEE_TIERS, placementConversionFee } from './placement-fee'

/**
 * What the platform charges an owner who hires a talent directly after a
 * project.
 *
 * The fee slides down with how long the two have already worked together:
 * early on the platform has recouped little of what it spent introducing and
 * vetting them, and by two years it has earned most of it through margin. The
 * fee is compensation for the introduction, not a restraint on the talent -
 * which is why the ceiling stays at 15%, inside the staffing norm CLAUDE.md
 * cites, and why refusing the hire is never the platform's answer.
 *
 * This lived as an if/else in a route handler, next to nothing that read it.
 */

describe('placementConversionFee', () => {
  it('charges the most on a new relationship', () => {
    const fee = placementConversionFee(120_000_000, 3)
    expect(fee.percentage).toBe(0.15)
    expect(fee.amount).toBe(18_000_000)
  })

  it('eases off once they have worked a year together', () => {
    expect(placementConversionFee(120_000_000, 18).percentage).toBe(0.12)
  })

  it('charges the least past two years', () => {
    expect(placementConversionFee(120_000_000, 36).percentage).toBe(0.1)
  })

  /**
   * The boundaries, which an if/else chain gets wrong quietly. Twelve months
   * is a year served and must not be billed at the newcomer rate; twenty-four
   * is still inside the middle band.
   */
  it('puts each boundary on the cheaper side', () => {
    expect(placementConversionFee(100_000_000, 11).percentage).toBe(0.15)
    expect(placementConversionFee(100_000_000, 12).percentage).toBe(0.12)
    expect(placementConversionFee(100_000_000, 24).percentage).toBe(0.12)
    expect(placementConversionFee(100_000_000, 25).percentage).toBe(0.1)
  })

  // Rupiah has no subunit in this ledger.
  it('rounds to a whole rupiah', () => {
    expect(Number.isInteger(placementConversionFee(99_999_999, 6).amount)).toBe(true)
  })

  /**
   * A salary of zero means the owner has not supplied one yet. Quoting a fee
   * of zero is the honest answer - it is not a free hire, it is a quote that
   * cannot be produced until a figure exists.
   */
  it('quotes nothing without a salary figure', () => {
    expect(placementConversionFee(0, 6).amount).toBe(0)
  })

  it('refuses a negative salary rather than crediting the owner', () => {
    expect(placementConversionFee(-1_000_000, 6).amount).toBe(0)
  })

  it('treats a nonsensical duration as the newest relationship', () => {
    expect(placementConversionFee(100_000_000, -3).percentage).toBe(0.15)
  })
})

describe('PLACEMENT_FEE_TIERS', () => {
  // The admin panel shows these read-only, as it does the platform brackets.
  it('is ordered and covers every duration', () => {
    expect(PLACEMENT_FEE_TIERS.map((t) => t.percentage)).toEqual([0.15, 0.12, 0.1])
    expect(PLACEMENT_FEE_TIERS.at(-1)?.maxMonths).toBe(Number.POSITIVE_INFINITY)
  })

  /**
   * The last tier is Infinity, so `find` matches for any finite duration and
   * the `?? PLACEMENT_FEE_TIERS[0]` after it looks unreachable. NaN reaches it:
   * `NaN <= anything` is false, so nothing matches. Landing on the first tier
   * is the right answer, since that is the highest fee and an unreadable
   * duration must not quietly become the cheapest bracket.
   */
  it('charges the newest-relationship rate when the duration is not a number', () => {
    expect(placementConversionFee(120_000_000, Number.NaN).percentage).toBe(0.15)
    expect(placementConversionFee(120_000_000, Number.NaN).amount).toBe(18_000_000)
  })
})
