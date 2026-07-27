import { describe, expect, it } from 'vitest'
import { normalizePrdContent } from './prd-content'

/**
 * work_packages.amount is an integer column holding Rupiah, and the model
 * writes it. A fractional amount reached the insert unchanged, Postgres
 * rejected the row, projects.ts swallowed the error to a console line, and the
 * project moved to prd_generated with zero work packages. The owner saw a
 * successful PRD and then MATCHING_NO_WORK_PACKAGES at the one step that
 * matters, with only a server log to explain it.
 *
 * The amount also picks the fee bracket, so it is the last place to be relaxed
 * about what the model returned.
 */

function prdWith(amount: unknown) {
  return normalizePrdContent({
    workPackages: [
      { name: 'Backend', requiredSkills: ['go'], estimatedHours: 40, amount, dependencies: [] },
    ],
  })
}

describe('work package amount', () => {
  it('rounds a fractional amount to whole Rupiah', () => {
    expect(prdWith(12_500_000.5).workPackages[0].amount).toBe(12_500_001)
    expect(prdWith(12_500_000.4).workPackages[0].amount).toBe(12_500_000)
  })

  it('reads a numeric string the model quoted', () => {
    expect(prdWith('12500000').workPackages[0].amount).toBe(12_500_000)
  })

  /**
   * planWorkPackages drops anything not strictly positive, so these become an
   * empty plan rather than a constraint violation. What matters here is that
   * they never arrive as a float or a NaN.
   */
  it('floors anything unusable to zero', () => {
    for (const bad of [null, undefined, 'Rp 10 juta', Number.NaN, Number.POSITIVE_INFINITY, -5]) {
      const amount = prdWith(bad).workPackages[0].amount
      expect(Number.isInteger(amount), `${String(bad)} produced ${amount}`).toBe(true)
      expect(amount).toBeLessThanOrEqual(0)
    }
  })

  /**
   * Hours stay fractional: estimated_hours is a real column and half an hour
   * is a real estimate.
   */
  it('leaves estimated hours fractional', () => {
    const prd = normalizePrdContent({
      workPackages: [{ name: 'x', estimatedHours: 7.5, amount: 1_000_000 }],
    })
    expect(prd.workPackages[0].estimatedHours).toBe(7.5)
  })
})
