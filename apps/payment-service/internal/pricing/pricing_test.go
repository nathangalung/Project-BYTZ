package pricing

import "testing"

// Both sides of every bracket edge. The table is inclusive, so the rate only
// changes one rupiah past MaxFee.
func TestTalentShareRate_BracketBoundaries(t *testing.T) {
	tests := []struct {
		name       string
		fee        int64
		wantTalent float64
	}{
		{"one rupiah", 1, 0.815},
		{"exactly 3 juta", 3_000_000, 0.815},
		{"3 juta plus one", 3_000_001, 0.765},
		{"exactly 5 juta", 5_000_000, 0.765},
		{"5 juta plus one", 5_000_001, 0.715},
		{"exactly 10 juta", 10_000_000, 0.715},
		{"10 juta plus one", 10_000_001, 0.665},
		{"exactly 15 juta", 15_000_000, 0.665},
		{"15 juta plus one", 15_000_001, 0.615},
		{"exactly 20 juta", 20_000_000, 0.615},
		{"20 juta plus one", 20_000_001, 0.565},
		{"exactly 30 juta", 30_000_000, 0.565},
		{"30 juta plus one", 30_000_001, 0.515},
		{"exactly 50 juta", 50_000_000, 0.515},
		{"50 juta plus one", 50_000_001, 0.465},
		{"far above the table", 500_000_000, 0.465},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := TalentShareRate(tt.fee); got != tt.wantTalent {
				t.Errorf("TalentShareRate(%d) = %v, want %v", tt.fee, got, tt.wantTalent)
			}
		})
	}
}

// The platform's share rises with project size. A table sorted the other way
// would still pass the boundary test above while inverting the policy.
func TestBrackets_FeeRisesWithProjectSize(t *testing.T) {
	prev := 0.0
	for _, b := range Brackets {
		if b.FeeRate <= prev {
			t.Fatalf("bracket %d fee rate %v does not exceed the previous %v", b.MaxFee, b.FeeRate, prev)
		}
		if b.TalentShare+b.FeeRate != 1 {
			t.Errorf("bracket %d shares sum to %v, want 1", b.MaxFee, b.TalentShare+b.FeeRate)
		}
		prev = b.FeeRate
	}
	if TopShare.FeeRate <= prev {
		t.Errorf("top share fee rate %v does not exceed the last bracket %v", TopShare.FeeRate, prev)
	}
}

// Vectors produced by running packages/shared/src/pricing.ts. This is what
// proves the Go rounding matches, rather than a second reading of the spec.
func TestProjectTalentPayout_MatchesTypeScript(t *testing.T) {
	for _, v := range ProjectVectors {
		payout := ProjectTalentPayout(v.FinalPrice)
		if payout != v.TalentPayout {
			t.Errorf("ProjectTalentPayout(%d) = %d, want %d", v.FinalPrice, payout, v.TalentPayout)
		}
		if fee := v.FinalPrice - payout; fee != v.PlatformFee {
			t.Errorf("platform fee for %d = %d, want %d", v.FinalPrice, fee, v.PlatformFee)
		}
	}
}

func TestMilestoneFee_MatchesTypeScript(t *testing.T) {
	for _, v := range MilestoneVectors {
		fee, err := MilestoneFee(v.Amount, v.Gross, v.Payout)
		// Where the TypeScript abandons the ratio it returns a fee of zero and
		// the platform earns nothing on the milestone. Go refuses instead, so
		// the anomaly surfaces as a failed release rather than lost margin.
		if v.Anomalous {
			if err == nil {
				t.Errorf("MilestoneFee(%d, %d, %d) = %d, want rejection", v.Amount, v.Gross, v.Payout, fee)
			}
			continue
		}
		if err != nil {
			t.Errorf("MilestoneFee(%d, %d, %d): %v", v.Amount, v.Gross, v.Payout, err)
			continue
		}
		if fee != v.Fee {
			t.Errorf("MilestoneFee(%d, %d, %d) = %d, want %d", v.Amount, v.Gross, v.Payout, fee, v.Fee)
		}
	}
}

func TestProjectTalentPayout_NonPositive(t *testing.T) {
	for _, price := range []int64{0, -1} {
		if got := ProjectTalentPayout(price); got != 0 {
			t.Errorf("ProjectTalentPayout(%d) = %d, want 0", price, got)
		}
	}
}

func TestMilestoneFee_Rejects(t *testing.T) {
	tests := []struct {
		name                  string
		amount, gross, payout int64
	}{
		{"zero amount", 0, 1_000_000, 800_000},
		{"negative amount", -1, 1_000_000, 800_000},
		{"unpriced work package", 1_000, 0, 0},
		{"negative gross", 1_000, -5, 0},
		{"negative payout", 1_000, 1_000_000, -1},
		// A payout of zero would hand the platform the whole milestone. That is
		// corrupted pricing, not a 100% fee bracket.
		{"payout takes everything", 1_000, 1_000_000, 0},
		{"payout above gross", 1_000, 1_000_000, 1_200_000},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := MilestoneFee(tt.amount, tt.gross, tt.payout); err == nil {
				t.Errorf("MilestoneFee(%d, %d, %d) = nil error, want rejection", tt.amount, tt.gross, tt.payout)
			}
		})
	}
}

func TestProjectPayoutMatchesBracket(t *testing.T) {
	// 10 juta brackets to 71.5%, so the payout is 7,150,000 and nothing else.
	if !ProjectPayoutMatchesBracket(10_000_000, 7_150_000) {
		t.Error("the bracket payout for 10 juta was rejected")
	}
	// One bracket down: what a project decomposed into small packages would
	// have paid if the bracket had keyed on a package instead of the total.
	if ProjectPayoutMatchesBracket(10_000_000, 8_150_000) {
		t.Error("a payout from the wrong bracket was accepted")
	}
	if ProjectPayoutMatchesBracket(10_000_000, 7_150_001) {
		t.Error("a payout one rupiah off the bracket was accepted")
	}
}
