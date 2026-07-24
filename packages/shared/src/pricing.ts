/**
 * Platform pricing for development projects.
 *
 * The talent payout is the primitive. The AI estimates what a work package is
 * realistically worth to the talent - from complexity, required skill level and
 * estimated hours - and the owner price is that payout marked up by the bracket
 * rate. The markup is the platform fee. It falls as the payout rises: small
 * packages carry proportionally more curation and management overhead, large
 * ones get a competitive rate to win the deal. Locked by the platform owner on
 * 2026-07-25 against the v6/v7 financial projection; blended take is ~21% of
 * GMV, within the transparent managed-marketplace band and above raw local
 * marketplaces because of the added value (curation, escrow, AI BRD/PRD,
 * milestone and dispute management).
 *
 * The rate is keyed on the payout - the number we have first - so a "<= 5 juta"
 * tier labels the payout, not the marked-up owner price.
 */
const PLATFORM_MARKUP_BRACKETS: readonly { readonly maxPayout: number; readonly rate: number }[] = [
  { maxPayout: 5_000_000, rate: 0.28 },
  { maxPayout: 15_000_000, rate: 0.24 },
  { maxPayout: 35_000_000, rate: 0.2 },
]
const TOP_BRACKET_RATE = 0.16

/** Platform markup rate for a talent payout. */
export function platformMarkupRate(payout: number): number {
  for (const bracket of PLATFORM_MARKUP_BRACKETS) {
    if (payout <= bracket.maxPayout) return bracket.rate
  }
  return TOP_BRACKET_RATE
}

/** Owner-facing amount for a payout: the payout marked up by its bracket. */
export function ownerAmountForPayout(payout: number): number {
  if (payout <= 0) return 0
  return Math.round(payout * (1 + platformMarkupRate(payout)))
}

/**
 * Split one work package from its talent payout.
 *
 * The fee is the difference, not payout * rate, so amount = talentPayout +
 * platformFee holds exactly with no rounding drift.
 */
export function priceWorkPackage(payout: number): {
  amount: number
  platformFee: number
  talentPayout: number
} {
  if (payout <= 0) return { amount: 0, platformFee: 0, talentPayout: 0 }
  const amount = ownerAmountForPayout(payout)
  return { amount, platformFee: amount - payout, talentPayout: payout }
}

/**
 * Roll priced work packages into the project totals.
 *
 * Each package is already split, so the project totals are the plain sums and
 * finalPrice = talentPayout + platformFee holds for the project exactly as it
 * does per package. No second bracket is applied to the sum.
 */
export function computeProjectPricing(
  packages: readonly { amount: number; talentPayout: number }[],
): {
  finalPrice: number
  platformFee: number
  talentPayout: number
} {
  const finalPrice = packages.reduce((sum, p) => sum + p.amount, 0)
  const talentPayout = packages.reduce((sum, p) => sum + p.talentPayout, 0)
  if (finalPrice <= 0) return { finalPrice: 0, platformFee: 0, talentPayout: 0 }
  return { finalPrice, platformFee: finalPrice - talentPayout, talentPayout }
}
