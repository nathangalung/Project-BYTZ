/**
 * The budget bands the intake wizard offers, cut where the platform's own fee
 * classification changes.
 *
 * The old bands were under-20, 20-50, 50-150 and over-150 juta - round numbers
 * that matched nothing. The fee table steps at 3, 5, 10, 15, 20, 30 and 50
 * juta, so a single "20-50 juta" answer spanned three different margins and
 * told neither the owner nor the AI which one the project sat in.
 *
 * PLATFORM_FEE_BRACKETS is deliberately NOT imported. The bracket is chosen
 * from the final price the AI computes per work package, never from what the
 * owner guessed at intake, and importing it would encode a coupling that does
 * not exist - a later pricing change would quietly rewrite the questions this
 * wizard asks.
 *
 * Above 50 juta the fee is flat, so the last two bands carry no classification
 * meaning. They stay because they still tell the model the size of the job,
 * which is the other thing this answer is for.
 */

export type BudgetBand = { key: string; min: number; max: number }

const JUTA = 1_000_000

export const BUDGET_BANDS: readonly BudgetBand[] = [
  { key: 'budget_under_5m', min: 0, max: 5 * JUTA },
  { key: 'budget_5_10m', min: 5 * JUTA, max: 10 * JUTA },
  { key: 'budget_10_20m', min: 10 * JUTA, max: 20 * JUTA },
  { key: 'budget_20_30m', min: 20 * JUTA, max: 30 * JUTA },
  { key: 'budget_30_50m', min: 30 * JUTA, max: 50 * JUTA },
  { key: 'budget_50_150m', min: 50 * JUTA, max: 150 * JUTA },
  { key: 'budget_over_150m', min: 150 * JUTA, max: 500 * JUTA },
]

/** The band an owner picked, or null when the key is not one we offer. */
export function budgetBand(key: string): BudgetBand | null {
  return BUDGET_BANDS.find((band) => band.key === key) ?? null
}
