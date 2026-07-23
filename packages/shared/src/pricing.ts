/**
 * Platform fee schedule for development projects not sourced from BD.
 *
 * The fee is a share of the project fee (the total the client pays), and it
 * rises as the project shrinks because a small job needs about the same
 * curation effort as a large one. Talent keeps the remainder.
 */
const PLATFORM_FEE_BRACKETS: readonly { readonly maxFee: number; readonly rate: number }[] = [
  { maxFee: 3_000_000, rate: 0.185 },
  { maxFee: 5_000_000, rate: 0.235 },
  { maxFee: 10_000_000, rate: 0.285 },
  { maxFee: 15_000_000, rate: 0.335 },
  { maxFee: 20_000_000, rate: 0.385 },
  { maxFee: 30_000_000, rate: 0.435 },
  { maxFee: 50_000_000, rate: 0.485 },
]
const TOP_BRACKET_RATE = 0.535

/** Platform fee share for a project fee. */
export function platformFeeRate(projectFee: number): number {
  for (const bracket of PLATFORM_FEE_BRACKETS) {
    if (projectFee <= bracket.maxFee) return bracket.rate
  }
  return TOP_BRACKET_RATE
}

/** Talent keeps the bracket remainder of a work package amount. */
export function talentShareOfAmount(amount: number, projectFee: number): number {
  return Math.round(amount * (1 - platformFeeRate(projectFee)))
}

/**
 * Split a project fee into the platform fee and the talent payout.
 *
 * The project fee is the sum of the work package amounts. The platform takes
 * its bracket share and the talent keeps the rest, so the three always
 * reconcile: finalPrice equals platformFee plus talentPayout.
 */
export function computeProjectPricing(packages: readonly { amount: number }[]): {
  finalPrice: number
  platformFee: number
  talentPayout: number
} {
  const finalPrice = packages.reduce((sum, p) => sum + p.amount, 0)
  if (finalPrice <= 0) return { finalPrice: 0, platformFee: 0, talentPayout: 0 }

  const platformFee = Math.round(finalPrice * platformFeeRate(finalPrice))
  return { finalPrice, platformFee, talentPayout: finalPrice - platformFee }
}
