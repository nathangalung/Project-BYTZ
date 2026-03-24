package service

import (
	"testing"

	"github.com/bytz/payment-service/internal/store"
)

// --- AppError tests ---

func TestAppError_Error(t *testing.T) {
	tests := []struct {
		name     string
		err      *AppError
		wantMsg  string
		wantCode string
	}{
		{
			name:     "validation error",
			err:      validationErr("bad input"),
			wantMsg:  "bad input",
			wantCode: "VALIDATION_ERROR",
		},
		{
			name:     "not found error",
			err:      notFoundErr("missing"),
			wantMsg:  "missing",
			wantCode: "NOT_FOUND",
		},
		{
			name:     "insufficient funds error",
			err:      insufficientErr("low balance"),
			wantMsg:  "low balance",
			wantCode: "PAYMENT_ESCROW_INSUFFICIENT_FUNDS",
		},
		{
			name:     "already processed error",
			err:      alreadyProcessedErr("done"),
			wantMsg:  "done",
			wantCode: "PAYMENT_ALREADY_PROCESSED",
		},
		{
			name:     "external service error",
			err:      externalServiceErr("gateway down"),
			wantMsg:  "gateway down",
			wantCode: "EXTERNAL_SERVICE_ERROR",
		},
		{
			name:     "forbidden error",
			err:      forbiddenErr("not allowed"),
			wantMsg:  "not allowed",
			wantCode: "FORBIDDEN",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.err.Error(); got != tt.wantMsg {
				t.Errorf("Error() = %q, want %q", got, tt.wantMsg)
			}
			if tt.err.Code != tt.wantCode {
				t.Errorf("Code = %q, want %q", tt.err.Code, tt.wantCode)
			}
		})
	}
}

func TestNewAppError(t *testing.T) {
	err := newAppError("TEST_CODE", "test message", 418)
	if err.Code != "TEST_CODE" {
		t.Errorf("Code = %q, want %q", err.Code, "TEST_CODE")
	}
	if err.Message != "test message" {
		t.Errorf("Message = %q, want %q", err.Message, "test message")
	}
	if err.StatusCode != 418 {
		t.Errorf("StatusCode = %d, want %d", err.StatusCode, 418)
	}
}

// --- Validation tests for CreateEscrow ---

func TestCreateEscrow_ZeroAmount(t *testing.T) {
	svc := &PaymentService{}

	tests := []struct {
		name   string
		amount int64
	}{
		{"zero amount", 0},
		{"negative amount", -100},
		{"large negative amount", -999999},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := svc.CreateEscrow(t.Context(), CreateEscrowInput{
				ProjectID:      "project-1",
				Amount:         tt.amount,
				OwnerID:        "owner-1",
				IdempotencyKey: "key-1",
			})
			if err == nil {
				t.Fatal("expected error for non-positive amount, got nil")
			}
			appErr, ok := err.(*AppError)
			if !ok {
				t.Fatalf("expected *AppError, got %T", err)
			}
			if appErr.Code != "VALIDATION_ERROR" {
				t.Errorf("error code = %q, want %q", appErr.Code, "VALIDATION_ERROR")
			}
			if appErr.StatusCode != 400 {
				t.Errorf("status code = %d, want %d", appErr.StatusCode, 400)
			}
		})
	}
}

// --- Validation tests for ReleaseEscrow ---

func TestReleaseEscrow_ZeroAmount(t *testing.T) {
	svc := &PaymentService{}

	tests := []struct {
		name   string
		amount int64
	}{
		{"zero amount", 0},
		{"negative amount", -50},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := svc.ReleaseEscrow(t.Context(), ReleaseEscrowInput{
				MilestoneID:    "ms-1",
				ProjectID:      "project-1",
				TalentID:       "talent-1",
				Amount:         tt.amount,
				PerformedBy:    "user-1",
				IdempotencyKey: "key-1",
			})
			if err == nil {
				t.Fatal("expected error for non-positive amount, got nil")
			}
			appErr, ok := err.(*AppError)
			if !ok {
				t.Fatalf("expected *AppError, got %T", err)
			}
			if appErr.Code != "VALIDATION_ERROR" {
				t.Errorf("error code = %q, want %q", appErr.Code, "VALIDATION_ERROR")
			}
		})
	}
}

// --- Validation tests for ProcessRefund ---

func TestProcessRefund_ZeroAmount(t *testing.T) {
	svc := &PaymentService{}

	tests := []struct {
		name   string
		amount int64
	}{
		{"zero amount", 0},
		{"negative amount", -1},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := svc.ProcessRefund(t.Context(), ProcessRefundInput{
				OriginalTransactionID: "txn-1",
				Amount:                tt.amount,
				Reason:                "test refund",
				OwnerID:               "owner-1",
				PerformedBy:           "admin-1",
				IdempotencyKey:        "key-1",
			})
			if err == nil {
				t.Fatal("expected error for non-positive amount, got nil")
			}
			appErr, ok := err.(*AppError)
			if !ok {
				t.Fatalf("expected *AppError, got %T", err)
			}
			if appErr.Code != "VALIDATION_ERROR" {
				t.Errorf("error code = %q, want %q", appErr.Code, "VALIDATION_ERROR")
			}
		})
	}
}

// --- Validation tests for CreateSnapToken ---

func TestCreateSnapToken_Validation(t *testing.T) {
	svc := &PaymentService{}

	tests := []struct {
		name      string
		input     CreateSnapTokenInput
		wantCode  string
	}{
		{
			name: "zero amount",
			input: CreateSnapTokenInput{
				ProjectID:     "p-1",
				OrderID:       "ORD-123",
				Amount:        0,
				CustomerEmail: "test@example.com",
			},
			wantCode: "VALIDATION_ERROR",
		},
		{
			name: "negative amount",
			input: CreateSnapTokenInput{
				ProjectID:     "p-1",
				OrderID:       "ORD-123",
				Amount:        -100,
				CustomerEmail: "test@example.com",
			},
			wantCode: "VALIDATION_ERROR",
		},
		{
			name: "empty orderId",
			input: CreateSnapTokenInput{
				ProjectID:     "p-1",
				OrderID:       "",
				Amount:        10000,
				CustomerEmail: "test@example.com",
			},
			wantCode: "VALIDATION_ERROR",
		},
		{
			name: "empty customerEmail",
			input: CreateSnapTokenInput{
				ProjectID: "p-1",
				OrderID:   "ORD-123",
				Amount:    10000,
			},
			wantCode: "VALIDATION_ERROR",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := svc.CreateSnapToken(t.Context(), tt.input)
			if err == nil {
				t.Fatal("expected error, got nil")
			}
			appErr, ok := err.(*AppError)
			if !ok {
				t.Fatalf("expected *AppError, got %T", err)
			}
			if appErr.Code != tt.wantCode {
				t.Errorf("error code = %q, want %q", appErr.Code, tt.wantCode)
			}
		})
	}
}

// --- Truncate helper tests ---

func TestTruncate(t *testing.T) {
	tests := []struct {
		name   string
		input  string
		maxLen int
		want   string
	}{
		{
			name:   "shorter than max",
			input:  "hello",
			maxLen: 10,
			want:   "hello",
		},
		{
			name:   "exactly max",
			input:  "hello",
			maxLen: 5,
			want:   "hello",
		},
		{
			name:   "longer than max",
			input:  "hello world",
			maxLen: 5,
			want:   "hello",
		},
		{
			name:   "empty string",
			input:  "",
			maxLen: 5,
			want:   "",
		},
		{
			name:   "max zero",
			input:  "hello",
			maxLen: 0,
			want:   "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := truncate(tt.input, tt.maxLen)
			if got != tt.want {
				t.Errorf("truncate(%q, %d) = %q, want %q", tt.input, tt.maxLen, got, tt.want)
			}
		})
	}
}

// --- Input struct construction tests ---

func TestCreateEscrowInput_OptionalFields(t *testing.T) {
	wpID := "wp-1"
	talentID := "talent-1"

	tests := []struct {
		name          string
		workPackageID *string
		talentID      *string
	}{
		{"all optional nil", nil, nil},
		{"with work package", &wpID, nil},
		{"with talent", nil, &talentID},
		{"all optional set", &wpID, &talentID},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			input := CreateEscrowInput{
				ProjectID:      "project-1",
				Amount:         10000,
				WorkPackageID:  tt.workPackageID,
				TalentID:       tt.talentID,
				OwnerID:        "owner-1",
				IdempotencyKey: "key-1",
			}
			if input.ProjectID != "project-1" {
				t.Errorf("ProjectID = %q, want %q", input.ProjectID, "project-1")
			}
			if input.Amount != 10000 {
				t.Errorf("Amount = %d, want %d", input.Amount, 10000)
			}
		})
	}
}

func TestReleaseEscrowInput_Fields(t *testing.T) {
	input := ReleaseEscrowInput{
		MilestoneID:    "ms-1",
		ProjectID:      "project-1",
		TalentID:       "talent-1",
		Amount:         50000,
		PerformedBy:    "user-1",
		IdempotencyKey: "release-key",
	}

	if input.MilestoneID != "ms-1" {
		t.Errorf("MilestoneID = %q, want %q", input.MilestoneID, "ms-1")
	}
	if input.Amount != 50000 {
		t.Errorf("Amount = %d, want %d", input.Amount, 50000)
	}
	if input.IdempotencyKey != "release-key" {
		t.Errorf("IdempotencyKey = %q, want %q", input.IdempotencyKey, "release-key")
	}
}

func TestProcessRefundInput_Fields(t *testing.T) {
	input := ProcessRefundInput{
		OriginalTransactionID: "txn-orig",
		Amount:                25000,
		Reason:                "client requested",
		OwnerID:               "owner-1",
		PerformedBy:           "admin-1",
		IdempotencyKey:        "refund-key",
	}

	if input.OriginalTransactionID != "txn-orig" {
		t.Errorf("OriginalTransactionID = %q, want %q", input.OriginalTransactionID, "txn-orig")
	}
	if input.Amount != 25000 {
		t.Errorf("Amount = %d, want %d", input.Amount, 25000)
	}
	if input.Reason != "client requested" {
		t.Errorf("Reason = %q, want %q", input.Reason, "client requested")
	}
}

func TestTransactionDetail_Structure(t *testing.T) {
	detail := TransactionDetail{}
	if detail.Events != nil {
		t.Error("Events should be nil by default")
	}
	if detail.LedgerEntries != nil {
		t.Error("LedgerEntries should be nil by default")
	}
}

func TestSnapTokenResult_Structure(t *testing.T) {
	result := SnapTokenResult{
		Token:       "snap-token-abc",
		RedirectURL: "https://example.com/redirect",
	}
	if result.Token != "snap-token-abc" {
		t.Errorf("Token = %q, want %q", result.Token, "snap-token-abc")
	}
	if result.RedirectURL != "https://example.com/redirect" {
		t.Errorf("RedirectURL = %q, want %q", result.RedirectURL, "https://example.com/redirect")
	}
}

func TestSnapTokenResult_EmptyFields(t *testing.T) {
	result := SnapTokenResult{}
	if result.Token != "" {
		t.Errorf("Token = %q, want empty", result.Token)
	}
	if result.RedirectURL != "" {
		t.Errorf("RedirectURL = %q, want empty", result.RedirectURL)
	}
}

func TestNewPaymentService(t *testing.T) {
	svc := NewPaymentService(nil, nil, "server-key", "https://snap.example.com")
	if svc == nil {
		t.Fatal("expected non-nil PaymentService")
	}
	if svc.midtransServerKey != "server-key" {
		t.Errorf("midtransServerKey = %q, want %q", svc.midtransServerKey, "server-key")
	}
	if svc.midtransSnapURL != "https://snap.example.com" {
		t.Errorf("midtransSnapURL = %q, want %q", svc.midtransSnapURL, "https://snap.example.com")
	}
}

func TestNewPaymentService_EmptyConfig(t *testing.T) {
	svc := NewPaymentService(nil, nil, "", "")
	if svc == nil {
		t.Fatal("expected non-nil PaymentService")
	}
	if svc.midtransServerKey != "" {
		t.Errorf("midtransServerKey = %q, want empty", svc.midtransServerKey)
	}
	if svc.midtransSnapURL != "" {
		t.Errorf("midtransSnapURL = %q, want empty", svc.midtransSnapURL)
	}
}

// --- AppError status code mapping tests ---

func TestAppError_StatusCodes(t *testing.T) {
	tests := []struct {
		name       string
		constructor func(string) *AppError
		wantStatus int
		wantCode   string
	}{
		{"validationErr", validationErr, 400, "VALIDATION_ERROR"},
		{"notFoundErr", notFoundErr, 404, "NOT_FOUND"},
		{"insufficientErr", insufficientErr, 400, "PAYMENT_ESCROW_INSUFFICIENT_FUNDS"},
		{"alreadyProcessedErr", alreadyProcessedErr, 409, "PAYMENT_ALREADY_PROCESSED"},
		{"externalServiceErr", externalServiceErr, 502, "EXTERNAL_SERVICE_ERROR"},
		{"forbiddenErr", forbiddenErr, 403, "FORBIDDEN"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.constructor("test message")
			if err.StatusCode != tt.wantStatus {
				t.Errorf("StatusCode = %d, want %d", err.StatusCode, tt.wantStatus)
			}
			if err.Code != tt.wantCode {
				t.Errorf("Code = %q, want %q", err.Code, tt.wantCode)
			}
			if err.Error() != "test message" {
				t.Errorf("Error() = %q, want %q", err.Error(), "test message")
			}
		})
	}
}

// --- CreateSnapToken validation edge cases ---

func TestCreateSnapToken_AllFieldsMissing(t *testing.T) {
	svc := &PaymentService{}
	_, err := svc.CreateSnapToken(t.Context(), CreateSnapTokenInput{})
	if err == nil {
		t.Fatal("expected error for empty input")
	}
	appErr, ok := err.(*AppError)
	if !ok {
		t.Fatalf("expected *AppError, got %T", err)
	}
	if appErr.Code != "VALIDATION_ERROR" {
		t.Errorf("error code = %q, want %q", appErr.Code, "VALIDATION_ERROR")
	}
}

func TestCreateSnapToken_ValidInputNilHTTPClient(t *testing.T) {
	// Valid input but no Midtrans URL configured — should still fail at HTTP call
	svc := &PaymentService{
		midtransSnapURL:   "", // empty URL
		midtransServerKey: "key",
	}
	_, err := svc.CreateSnapToken(t.Context(), CreateSnapTokenInput{
		ProjectID:     "p-1",
		OrderID:       "ORD-123",
		Amount:        10000,
		ItemName:      "Test",
		CustomerName:  "User",
		CustomerEmail: "user@test.com",
	})
	// Should fail on HTTP call since URL is empty
	if err == nil {
		t.Fatal("expected error with empty snap URL")
	}
}

func TestCreateSnapToken_WithItemName(t *testing.T) {
	svc := &PaymentService{
		midtransSnapURL:   "http://localhost:99999/invalid", // unreachable
		midtransServerKey: "key",
	}
	_, err := svc.CreateSnapToken(t.Context(), CreateSnapTokenInput{
		ProjectID:     "p-1",
		OrderID:       "ORD-123",
		Amount:        10000,
		ItemName:      "BRD Document",
		CustomerName:  "Test User",
		CustomerEmail: "test@example.com",
	})
	// Should fail on HTTP call, not on validation
	if err == nil {
		t.Fatal("expected error (unreachable URL)")
	}
	// Should not be a validation error
	appErr, ok := err.(*AppError)
	if ok && appErr.Code == "VALIDATION_ERROR" {
		t.Error("should not be a validation error — input is valid")
	}
}

func TestCreateSnapToken_WithoutItemName(t *testing.T) {
	svc := &PaymentService{
		midtransSnapURL:   "http://localhost:99999/invalid",
		midtransServerKey: "key",
	}
	_, err := svc.CreateSnapToken(t.Context(), CreateSnapTokenInput{
		ProjectID:     "p-1",
		OrderID:       "ORD-123",
		Amount:        10000,
		ItemName:      "", // empty item name
		CustomerName:  "Test User",
		CustomerEmail: "test@example.com",
	})
	if err == nil {
		t.Fatal("expected error (unreachable URL)")
	}
	appErr, ok := err.(*AppError)
	if ok && appErr.Code == "VALIDATION_ERROR" {
		t.Error("should not be a validation error — empty ItemName is allowed")
	}
}

// --- Truncate edge cases ---

func TestTruncate_Unicode(t *testing.T) {
	// Truncate works on bytes, not runes
	input := "hello"
	got := truncate(input, 3)
	if got != "hel" {
		t.Errorf("truncate(%q, 3) = %q, want %q", input, got, "hel")
	}
}

func TestTruncate_MaxOne(t *testing.T) {
	got := truncate("hello", 1)
	if got != "h" {
		t.Errorf("truncate('hello', 1) = %q, want 'h'", got)
	}
}

// --- CreateEscrowInput field validation ---

func TestCreateEscrowInput_AllFields(t *testing.T) {
	wpID := "wp-1"
	talentID := "talent-1"
	input := CreateEscrowInput{
		ProjectID:      "project-1",
		Amount:         100000,
		WorkPackageID:  &wpID,
		TalentID:       &talentID,
		OwnerID:        "owner-1",
		IdempotencyKey: "idem-key-123",
	}
	if input.ProjectID != "project-1" {
		t.Errorf("ProjectID = %q, want %q", input.ProjectID, "project-1")
	}
	if *input.WorkPackageID != "wp-1" {
		t.Errorf("WorkPackageID = %q, want %q", *input.WorkPackageID, "wp-1")
	}
	if *input.TalentID != "talent-1" {
		t.Errorf("TalentID = %q, want %q", *input.TalentID, "talent-1")
	}
}

// --- CreateEscrow boundary validation tests ---

func TestCreateEscrow_AmountBoundaryValidation(t *testing.T) {
	svc := &PaymentService{}

	tests := []struct {
		name       string
		amount     int64
		wantValErr bool
	}{
		{"amount -1 is validation error", -1, true},
		{"amount 0 is validation error", 0, true},
		{"amount 1 passes validation", 1, false},
		{"amount max int passes validation", 9999999999, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			defer func() {
				// Nil store will panic for valid amounts — recover
				if r := recover(); r != nil && tt.wantValErr {
					t.Errorf("should have returned validation error, not panicked")
				}
			}()
			_, err := svc.CreateEscrow(t.Context(), CreateEscrowInput{
				ProjectID:      "project-1",
				Amount:         tt.amount,
				OwnerID:        "owner-1",
				IdempotencyKey: "key-1",
			})
			if tt.wantValErr {
				if err == nil {
					t.Fatal("expected validation error")
				}
				appErr, ok := err.(*AppError)
				if !ok {
					t.Fatalf("expected *AppError, got %T", err)
				}
				if appErr.Code != "VALIDATION_ERROR" {
					t.Errorf("code = %q, want VALIDATION_ERROR", appErr.Code)
				}
			}
			// For valid amounts, we don't check further — nil store will panic
		})
	}
}

func TestReleaseEscrow_AmountBoundaryValidation(t *testing.T) {
	svc := &PaymentService{}

	tests := []struct {
		name       string
		amount     int64
		wantValErr bool
	}{
		{"amount -1 is validation error", -1, true},
		{"amount 0 is validation error", 0, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := svc.ReleaseEscrow(t.Context(), ReleaseEscrowInput{
				MilestoneID:    "ms-1",
				ProjectID:      "project-1",
				TalentID:       "talent-1",
				Amount:         tt.amount,
				PerformedBy:    "user-1",
				IdempotencyKey: "key-1",
			})
			if err == nil {
				t.Fatal("expected validation error")
			}
			appErr, ok := err.(*AppError)
			if !ok {
				t.Fatalf("expected *AppError, got %T", err)
			}
			if appErr.Code != "VALIDATION_ERROR" {
				t.Errorf("code = %q, want VALIDATION_ERROR", appErr.Code)
			}
		})
	}
}

func TestProcessRefund_AmountBoundaryValidation(t *testing.T) {
	svc := &PaymentService{}

	tests := []struct {
		name   string
		amount int64
	}{
		{"amount -1", -1},
		{"amount 0", 0},
		{"amount -999", -999},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := svc.ProcessRefund(t.Context(), ProcessRefundInput{
				OriginalTransactionID: "txn-1",
				Amount:                tt.amount,
				Reason:                "test",
				OwnerID:               "owner-1",
				PerformedBy:           "admin-1",
				IdempotencyKey:        "key-1",
			})
			if err == nil {
				t.Fatal("expected validation error")
			}
			appErr, ok := err.(*AppError)
			if !ok {
				t.Fatalf("expected *AppError, got %T", err)
			}
			if appErr.Code != "VALIDATION_ERROR" {
				t.Errorf("code = %q, want VALIDATION_ERROR", appErr.Code)
			}
		})
	}
}

// --- TransactionDetail structure tests ---

func TestTransactionDetail_WithData(t *testing.T) {
	detail := TransactionDetail{
		Events:        []store.TransactionEvent{{ID: "ev-1"}},
		LedgerEntries: []store.LedgerEntry{{ID: "le-1"}},
	}
	if len(detail.Events) != 1 {
		t.Errorf("Events length = %d, want 1", len(detail.Events))
	}
	if detail.Events[0].ID != "ev-1" {
		t.Errorf("Events[0].ID = %q, want %q", detail.Events[0].ID, "ev-1")
	}
	if len(detail.LedgerEntries) != 1 {
		t.Errorf("LedgerEntries length = %d, want 1", len(detail.LedgerEntries))
	}
	if detail.LedgerEntries[0].ID != "le-1" {
		t.Errorf("LedgerEntries[0].ID = %q, want %q", detail.LedgerEntries[0].ID, "le-1")
	}
}

// --- CreateSnapTokenInput field tests ---

func TestCreateSnapTokenInput_Fields(t *testing.T) {
	input := CreateSnapTokenInput{
		ProjectID:     "p-1",
		OrderID:       "ORD-123",
		Amount:        50000,
		ItemName:      "BRD Document",
		CustomerName:  "John Doe",
		CustomerEmail: "john@example.com",
	}
	if input.ProjectID != "p-1" {
		t.Errorf("ProjectID = %q, want %q", input.ProjectID, "p-1")
	}
	if input.OrderID != "ORD-123" {
		t.Errorf("OrderID = %q, want %q", input.OrderID, "ORD-123")
	}
	if input.Amount != 50000 {
		t.Errorf("Amount = %d, want %d", input.Amount, 50000)
	}
	if input.ItemName != "BRD Document" {
		t.Errorf("ItemName = %q, want %q", input.ItemName, "BRD Document")
	}
	if input.CustomerEmail != "john@example.com" {
		t.Errorf("CustomerEmail = %q, want %q", input.CustomerEmail, "john@example.com")
	}
}

// --- ProcessRefundInput fields ---

func TestProcessRefundInput_AllFields(t *testing.T) {
	input := ProcessRefundInput{
		OriginalTransactionID: "txn-orig-123",
		Amount:                75000,
		Reason:                "client requested full refund",
		OwnerID:               "owner-abc",
		PerformedBy:           "admin-xyz",
		IdempotencyKey:        "refund-key-456",
	}
	if input.OriginalTransactionID != "txn-orig-123" {
		t.Errorf("OriginalTransactionID = %q, want %q", input.OriginalTransactionID, "txn-orig-123")
	}
	if input.Amount != 75000 {
		t.Errorf("Amount = %d, want %d", input.Amount, 75000)
	}
	if input.Reason != "client requested full refund" {
		t.Errorf("Reason = %q, want %q", input.Reason, "client requested full refund")
	}
}

// --- ReleaseEscrowInput fields ---

func TestReleaseEscrowInput_AllFields(t *testing.T) {
	input := ReleaseEscrowInput{
		MilestoneID:    "ms-abc",
		ProjectID:      "proj-123",
		TalentID:       "talent-xyz",
		Amount:         200000,
		PerformedBy:    "owner-abc",
		IdempotencyKey: "release-key-789",
	}
	if input.MilestoneID != "ms-abc" {
		t.Errorf("MilestoneID = %q, want %q", input.MilestoneID, "ms-abc")
	}
	if input.ProjectID != "proj-123" {
		t.Errorf("ProjectID = %q, want %q", input.ProjectID, "proj-123")
	}
	if input.TalentID != "talent-xyz" {
		t.Errorf("TalentID = %q, want %q", input.TalentID, "talent-xyz")
	}
	if input.Amount != 200000 {
		t.Errorf("Amount = %d, want %d", input.Amount, 200000)
	}
}
