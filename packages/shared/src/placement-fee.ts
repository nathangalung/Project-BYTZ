/**
 * What the platform charges an owner who hires a talent directly after a
 * project ends.
 *
 * The fee slides down with how long the two have already worked together.
 * Early on the platform has recouped little of what it spent introducing and
 * vetting the talent; by two years it has earned most of that back through
 * project margin. It is compensation for the introduction, not a restraint on
 * the talent - which is why the ceiling stays at 15%, inside the staffing
 * norm, and why refusing the hire is never the answer. The talent may always
 * decline.
 *
 * Lives here beside pricing.ts because it is a pricing decision. It was an
 * if/else in a route handler with nothing reading it.
 */
export type PlacementFeeTier = {
  /** Upper bound in months, inclusive. */
  maxMonths: number
  percentage: number
}

export const PLACEMENT_FEE_TIERS: readonly PlacementFeeTier[] = [
  { maxMonths: 11, percentage: 0.15 },
  { maxMonths: 24, percentage: 0.12 },
  { maxMonths: Number.POSITIVE_INFINITY, percentage: 0.1 },
]

export type PlacementFee = {
  percentage: number
  amount: number
}

export function placementConversionFee(
  estimatedAnnualSalary: number,
  durationMonths: number,
): PlacementFee {
  // A duration below the first boundary - including a nonsensical negative -
  // is the newest relationship, which is the tier the platform has recouped
  // the least of.
  const tier =
    PLACEMENT_FEE_TIERS.find((t) => durationMonths <= t.maxMonths) ?? PLACEMENT_FEE_TIERS[0]

  // No salary yet means no quote, not a free hire. A negative one is input
  // error and must never become a credit to the owner.
  const salary = Math.max(estimatedAnnualSalary, 0)

  return {
    percentage: tier.percentage,
    // Rupiah carries no subunit in this ledger.
    amount: Math.round(salary * tier.percentage),
  }
}
