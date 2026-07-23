import { MARGIN_RATES } from './constants'

/**
 * Tiered platform margin rate for a project.
 *
 * The rate falls as the project grows: a small job needs about the same
 * curation effort as a large one, so its percentage is higher. Keyed on the
 * talent payout, the base cost, rather than the final price, because a rate
 * defined against the final price is circular - the price depends on the rate.
 * The applied rate is the midpoint of the documented band.
 */
export function marginRateForValue(talentPayout: number): number {
  const tier =
    talentPayout < 10_000_000
      ? MARGIN_RATES.BELOW_10M
      : talentPayout < 50_000_000
        ? MARGIN_RATES.FROM_10M_TO_50M
        : talentPayout < 100_000_000
          ? MARGIN_RATES.FROM_50M_TO_100M
          : MARGIN_RATES.ABOVE_100M
  return (tier.min + tier.max) / 2
}

/**
 * Roll a project's price up from its work packages.
 *
 * Talents keep 100% of what they quoted; the platform fee sits on top and is
 * included in what the client pays. The fee is the tiered share of the final
 * price, so finalPrice = talentPayout + platformFee and platformFee / finalPrice
 * equals the tier rate.
 */
export function computeProjectPricing(packages: readonly { talentPayout: number }[]): {
  talentPayout: number
  platformFee: number
  finalPrice: number
} {
  const talentPayout = packages.reduce((sum, p) => sum + p.talentPayout, 0)
  if (talentPayout <= 0) return { talentPayout: 0, platformFee: 0, finalPrice: 0 }

  const rate = marginRateForValue(talentPayout)
  const platformFee = Math.round((talentPayout * rate) / (1 - rate))
  return { talentPayout, platformFee, finalPrice: talentPayout + platformFee }
}
