/*
Package pricing mirrors the platform fee split defined in
packages/shared/src/pricing.ts.

The table itself lives in brackets_gen.go and is generated from that file, so
the rates here cannot drift from the ones the AI prices projects at. The
arithmetic below is hand written but has to agree with the TypeScript to the
rupiah: project-service computes a milestone's fee and payment-service rejects
a release that disagrees, so a one rupiah divergence would fail every
settlement rather than catch anything.

That is why the milestone fee goes through float64 in the same order
Math.round((amount * payout) / gross) does. Exact integer arithmetic would be
more defensible in isolation and differently wrong here. golden_gen_test.go
carries vectors produced by running the TypeScript, which is what actually
holds the two implementations together.
*/
package pricing

import (
	"fmt"
	"math"
)

// TalentShareRate is the talent's share of a project fee. The bracket
// comparison is inclusive, so exactly 3,000,000 pays 81.5% and 3,000,001 pays
// 76.5%.
func TalentShareRate(fee int64) float64 {
	for _, b := range Brackets {
		if fee <= b.MaxFee {
			return b.TalentShare
		}
	}
	return TopShare.TalentShare
}

// PlatformFeeRate is the platform's share of a project fee. Read off the table
// rather than computed as 1 - TalentShareRate, which lands on
// 0.18500000000000005 in binary floating point.
func PlatformFeeRate(fee int64) float64 {
	for _, b := range Brackets {
		if fee <= b.MaxFee {
			return b.FeeRate
		}
	}
	return TopShare.FeeRate
}

// ProjectTalentPayout is the total the talents receive for a project priced at
// finalPrice. The platform fee is the difference, so
// finalPrice = payout + fee holds exactly.
func ProjectTalentPayout(finalPrice int64) int64 {
	if finalPrice <= 0 {
		return 0
	}
	return int64(math.Round(float64(finalPrice) * TalentShareRate(finalPrice)))
}

/*
MilestoneFee is the platform's slice of a gross milestone amount.

gross and payout are the milestone's work package amount and talent payout,
falling back to the project totals for a milestone that has no package. The
ratio between them, not a bracket lookup on the milestone amount, is what
decides the fee: a milestone is a slice of a project and brackets key on the
project total.

Returns an error where project-service logs an anomaly and pays the talent in
full. Paying in full is the safe side for one talent and a silent margin leak
for the platform, so the release is refused and the pricing data gets fixed
instead.
*/
func MilestoneFee(amount, gross, payout int64) (int64, error) {
	if amount <= 0 {
		return 0, fmt.Errorf("milestone amount must be positive, got %d", amount)
	}
	if gross <= 0 || payout < 0 {
		return 0, fmt.Errorf("unpriced work package: gross %d, payout %d", gross, payout)
	}

	talentSlice := int64(math.Round(float64(amount) * float64(payout) / float64(gross)))
	fee := amount - talentSlice
	if fee < 0 || fee >= amount {
		return 0, fmt.Errorf("implausible fee ratio: payout %d of gross %d yields fee %d on %d",
			payout, gross, fee, amount)
	}
	return fee, nil
}

// ProjectPayoutMatchesBracket reports whether a project's stored talent payout
// is the one its final price brackets to. The milestone ratio above is only as
// trustworthy as the numbers it divides, and nothing else re-checks them
// against the published table once the PRD has been priced.
func ProjectPayoutMatchesBracket(finalPrice, talentPayout int64) bool {
	return talentPayout == ProjectTalentPayout(finalPrice)
}
