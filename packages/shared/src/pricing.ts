/**
 * Platform pricing for development projects.
 *
 * The project fee is the primitive. The AI estimates what each work package is
 * worth to the owner; the project fee is their sum, and the bracket table below
 * splits it between the talent and the platform. The platform's share rises
 * with project size. Locked by the platform owner on 2026-07-25.
 *
 * Two properties the rest of the system depends on:
 *
 * The bracket keys on the project total, never on a single package. Bracketing
 * each package and summing would let a 60 juta project decomposed into four 15
 * juta packages pay the 15 juta rate, which makes the platform's take a
 * function of how finely the AI split the PRD rather than of the deal size.
 *
 * Every package is allocated at the same share, so a package's
 * talent_payout / amount ratio equals the project's. Milestone settlement reads
 * that per-package ratio and falls back to the project one, and the two must
 * agree or a milestone settles at a different rate than the project was priced.
 */
const TALENT_SHARE_BRACKETS: readonly {
  readonly maxFee: number
  readonly talentShare: number
  readonly feeRate: number
}[] = [
  { maxFee: 3_000_000, talentShare: 0.815, feeRate: 0.185 },
  { maxFee: 5_000_000, talentShare: 0.765, feeRate: 0.235 },
  { maxFee: 10_000_000, talentShare: 0.715, feeRate: 0.285 },
  { maxFee: 15_000_000, talentShare: 0.665, feeRate: 0.335 },
  { maxFee: 20_000_000, talentShare: 0.615, feeRate: 0.385 },
  { maxFee: 30_000_000, talentShare: 0.565, feeRate: 0.435 },
  { maxFee: 50_000_000, talentShare: 0.515, feeRate: 0.485 },
]
const TOP_BRACKET = { talentShare: 0.465, feeRate: 0.535 } as const

/** The published bracket table, for the admin panel to render read-only. */
export const PLATFORM_FEE_BRACKETS = TALENT_SHARE_BRACKETS
export const PLATFORM_FEE_TOP_BRACKET = TOP_BRACKET

/** Talent's share of a project fee. */
export function talentShareRate(fee: number): number {
  for (const bracket of TALENT_SHARE_BRACKETS) {
    if (fee <= bracket.maxFee) return bracket.talentShare
  }
  return TOP_BRACKET.talentShare
}

/**
 * Platform's share of a project fee.
 *
 * Read off the table rather than computed as 1 - talentShare, which lands on
 * 0.18500000000000005 in binary floating point.
 */
export function platformFeeRate(fee: number): number {
  for (const bracket of TALENT_SHARE_BRACKETS) {
    if (fee <= bracket.maxFee) return bracket.feeRate
  }
  return TOP_BRACKET.feeRate
}

/**
 * Price a project from its work package amounts.
 *
 * The fee is the difference rather than finalPrice * feeRate, so
 * finalPrice = talentPayout + platformFee holds exactly. Package payouts are
 * allocated pro rata and the last priced package absorbs the rounding
 * remainder, so they sum to talentPayout to the rupiah. The remainder is at
 * most one rupiah per package, far below any package's own amount, and is
 * clamped anyway so a package can never be allocated more than it is worth.
 */
export function computeProjectPricing(packages: readonly { amount: number }[]): {
  finalPrice: number
  platformFee: number
  talentPayout: number
  packagePayouts: number[]
} {
  const finalPrice = packages.reduce((sum, p) => sum + Math.max(0, p.amount), 0)
  if (finalPrice <= 0) {
    return { finalPrice: 0, platformFee: 0, talentPayout: 0, packagePayouts: packages.map(() => 0) }
  }

  const share = talentShareRate(finalPrice)
  const talentPayout = Math.round(finalPrice * share)
  const packagePayouts = packages.map((p) => Math.round(Math.max(0, p.amount) * share))

  const lastPriced = packages.reduce((last, p, i) => (p.amount > 0 ? i : last), -1)
  if (lastPriced >= 0) {
    const allocated = packagePayouts.reduce((sum, p) => sum + p, 0)
    const corrected = (packagePayouts[lastPriced] as number) + (talentPayout - allocated)
    packagePayouts[lastPriced] = Math.min(
      Math.max(0, corrected),
      packages[lastPriced]?.amount as number,
    )
  }

  return { finalPrice, platformFee: finalPrice - talentPayout, talentPayout, packagePayouts }
}
