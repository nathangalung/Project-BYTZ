/**
 * What the owner asked for against what the document estimates.
 *
 * The owner states a budget band and a timeline range at intake; the BRD and
 * PRD come back with their own numbers. Until now nothing put the two side by
 * side, so an owner deciding whether to continue into development had to do
 * the arithmetic themselves, on two numbers shown on different pages.
 *
 * Derived on read, never stored. This is the same reasoning as
 * `pemerataan_skor` and `health_score`: a stored copy has to be recomputed
 * every time either side changes, and this branch has already removed one
 * column that had a reader and no writer.
 *
 * Three outcomes, not two. A document generated before these fields existed,
 * and every PRD field that defaults to 0, normalise to zero - and zero is not
 * "free" or "instant". Saying so is the difference between a comparison and a
 * fabricated one.
 */

export type EstimateGap =
  | { kind: 'unknown' }
  | { kind: 'fits'; estimate: number }
  /**
   * `over` carries both numbers because the shortfall alone does not say
   * whether the whole estimate is out of reach or only its upper end. An
   * estimate of 18-25 juta against a 20 juta ceiling is a conversation; one of
   * 40-50 juta against the same ceiling is a different one.
   */
  | { kind: 'over'; estimate: number; ceiling: number; shortfall: number; lowEndFits: boolean }

/**
 * Budget: the owner's ceiling against the estimated range.
 *
 * Compared against budget_max rather than the midpoint of the band, because
 * the ceiling is the number the owner actually committed to.
 */
export function budgetGap(ownerMax: number, estimateMin: number, estimateMax: number): EstimateGap {
  if (ownerMax <= 0 || estimateMax <= 0) return { kind: 'unknown' }
  if (estimateMax <= ownerMax) return { kind: 'fits', estimate: estimateMax }
  return {
    kind: 'over',
    estimate: estimateMax,
    ceiling: ownerMax,
    shortfall: estimateMax - ownerMax,
    lowEndFits: estimateMin > 0 && estimateMin <= ownerMax,
  }
}

/**
 * Timeline: the days the owner allowed against the days the document needs.
 *
 * A single number on each side, so `lowEndFits` is always false - the estimate
 * has no low end to fit.
 */
export function timelineGap(ownerDays: number, estimateDays: number): EstimateGap {
  if (ownerDays <= 0 || estimateDays <= 0) return { kind: 'unknown' }
  if (estimateDays <= ownerDays) return { kind: 'fits', estimate: estimateDays }
  return {
    kind: 'over',
    estimate: estimateDays,
    ceiling: ownerDays,
    shortfall: estimateDays - ownerDays,
    lowEndFits: false,
  }
}
