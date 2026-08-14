package store

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
)

// A mock that ignored its stub would make every handler test using it vacuous,
// so each hook is checked to actually be called, and each unset method is
// checked to be inert rather than panic.
func TestMockDashboardStore_DelegatesAndDefaults(t *testing.T) {
	ctx := context.Background()
	stub := &MockDashboardStore{
		GetProjectStatsFn: func(context.Context) (map[string]int64, error) {
			return map[string]int64{"draft": 1}, nil
		},
		GetRevenueStatsFn: func(context.Context, *DateRange) (*RevenueStats, error) {
			return &RevenueStats{TotalRevenue: 99}, nil
		},
		GetTalentStatsFn: func(context.Context) (*TalentStats, error) {
			return &TalentStats{TotalTalents: 7}, nil
		},
		GetDailyRevenueFn: func(context.Context, *DateRange) ([]DailyRevenuePoint, error) {
			return []DailyRevenuePoint{{Date: "2026-07-01"}}, nil
		},
		GetAiUsageFn: func(context.Context, *DateRange) (*AiUsageStats, error) {
			return &AiUsageStats{TotalRequests: 3}, nil
		},
	}

	if got, _ := stub.GetProjectStats(ctx); got["draft"] != 1 {
		t.Errorf("GetProjectStats = %v, want the stub", got)
	}
	if got, _ := stub.GetRevenueStats(ctx, nil); got == nil || got.TotalRevenue != 99 {
		t.Errorf("GetRevenueStats = %v, want the stub", got)
	}
	if got, _ := stub.GetTalentStats(ctx); got == nil || got.TotalTalents != 7 {
		t.Errorf("GetTalentStats = %v, want the stub", got)
	}
	if got, _ := stub.GetDailyRevenue(ctx, nil); len(got) != 1 {
		t.Errorf("GetDailyRevenue = %v, want the stub", got)
	}
	if got, _ := stub.GetAiUsage(ctx, nil); got == nil || got.TotalRequests != 3 {
		t.Errorf("GetAiUsage = %v, want the stub", got)
	}

	empty := &MockDashboardStore{}
	if v, err := empty.GetDailyRevenue(ctx, nil); v != nil || err != nil {
		t.Errorf("GetDailyRevenue default = (%v, %v)", v, err)
	}
	if v, err := empty.GetAiUsage(ctx, nil); v != nil || err != nil {
		t.Errorf("GetAiUsage default = (%v, %v)", v, err)
	}
}

func TestMockUserStore_DelegatesAndDefaults(t *testing.T) {
	ctx := context.Background()
	sentinel := errors.New("stubbed")
	stub := &MockUserStore{
		GetUsersListFn: func(context.Context, UserFilters) (*UserListResult, error) {
			return &UserListResult{Total: 5}, nil
		},
		GetUserByIDFn:   func(context.Context, string) (*User, error) { return &User{ID: "u-1"}, nil },
		SuspendUserFn:   func(context.Context, string) (*User, error) { return &User{IsVerified: false}, nil },
		UnsuspendUserFn: func(context.Context, string) (*User, error) { return &User{IsVerified: true}, nil },
		GetAuditLogsFn: func(context.Context, int, int) (*AuditLogResult, error) {
			return &AuditLogResult{Total: 2}, nil
		},
		CreateAuditLogFn: func(context.Context, string, string, string, string, string, json.RawMessage) (*AuditLog, error) {
			return nil, sentinel
		},
		GetPlatformSettingsFn: func(context.Context) ([]PlatformSetting, error) {
			return []PlatformSetting{{Key: "k"}}, nil
		},
		GetPlatformSettingFn: func(context.Context, string) (*PlatformSetting, error) {
			return &PlatformSetting{Key: "k"}, nil
		},
		UpsertPlatformSettingFn: func(context.Context, string, string, json.RawMessage, *string, string) (*PlatformSetting, error) {
			return &PlatformSetting{Key: "upserted"}, nil
		},
		GetTalentDetailFn: func(context.Context, string) (*TalentDetail, error) {
			return &TalentDetail{Profile: &TalentProfile{ID: "tp-1"}}, nil
		},
	}

	if got, _ := stub.GetUsersList(ctx, UserFilters{}); got == nil || got.Total != 5 {
		t.Errorf("GetUsersList = %v", got)
	}
	if got, _ := stub.GetUserByID(ctx, "u-1"); got == nil || got.ID != "u-1" {
		t.Errorf("GetUserByID = %v", got)
	}
	if got, _ := stub.SuspendUser(ctx, "u-1"); got == nil || got.IsVerified {
		t.Errorf("SuspendUser = %v, want IsVerified false", got)
	}
	if got, _ := stub.UnsuspendUser(ctx, "u-1"); got == nil || !got.IsVerified {
		t.Errorf("UnsuspendUser = %v, want IsVerified true", got)
	}
	if got, _ := stub.GetAuditLogs(ctx, 1, 10); got == nil || got.Total != 2 {
		t.Errorf("GetAuditLogs = %v", got)
	}
	if _, err := stub.CreateAuditLog(ctx, "", "", "", "", "", nil); !errors.Is(err, sentinel) {
		t.Errorf("CreateAuditLog error = %v, want the stubbed error", err)
	}
	if got, _ := stub.GetPlatformSettings(ctx); len(got) != 1 {
		t.Errorf("GetPlatformSettings = %v", got)
	}
	if got, _ := stub.GetPlatformSetting(ctx, "k"); got == nil || got.Key != "k" {
		t.Errorf("GetPlatformSetting = %v", got)
	}
	if got, _ := stub.UpsertPlatformSetting(ctx, "", "", nil, nil, ""); got == nil || got.Key != "upserted" {
		t.Errorf("UpsertPlatformSetting = %v", got)
	}
	if got, _ := stub.GetTalentDetail(ctx, "u-1"); got == nil || got.Profile == nil {
		t.Errorf("GetTalentDetail = %v", got)
	}

	if v, err := (&MockUserStore{}).GetTalentDetail(ctx, "u-1"); v != nil || err != nil {
		t.Errorf("GetTalentDetail default = (%v, %v)", v, err)
	}
}

func TestMockDLQStore_DelegatesAndDefaults(t *testing.T) {
	ctx := context.Background()
	stub := &MockDLQStore{
		GetDLQListFn: func(context.Context, DLQFilters) (*DLQListResult, error) {
			return &DLQListResult{Total: 3}, nil
		},
		GetDLQByIDFn:      func(context.Context, string) (*DLQEvent, error) { return &DLQEvent{ID: "dl-1"}, nil },
		MarkReprocessedFn: func(context.Context, string) (*DLQEvent, error) { return &DLQEvent{Reprocessed: true}, nil },
	}

	if got, _ := stub.GetDLQList(ctx, DLQFilters{}); got == nil || got.Total != 3 {
		t.Errorf("GetDLQList = %v", got)
	}
	if got, _ := stub.GetDLQByID(ctx, "dl-1"); got == nil || got.ID != "dl-1" {
		t.Errorf("GetDLQByID = %v", got)
	}
	if got, _ := stub.MarkReprocessed(ctx, "dl-1"); got == nil || !got.Reprocessed {
		t.Errorf("MarkReprocessed = %v", got)
	}

	empty := &MockDLQStore{}
	if v, err := empty.GetDLQList(ctx, DLQFilters{}); v != nil || err != nil {
		t.Errorf("GetDLQList default = (%v, %v)", v, err)
	}
	if v, err := empty.GetDLQByID(ctx, "x"); v != nil || err != nil {
		t.Errorf("GetDLQByID default = (%v, %v)", v, err)
	}
	if v, err := empty.MarkReprocessed(ctx, "x"); v != nil || err != nil {
		t.Errorf("MarkReprocessed default = (%v, %v)", v, err)
	}
}

func TestMockProjectStore_DelegatesAndDefaults(t *testing.T) {
	ctx := context.Background()
	stub := &MockProjectStore{
		GetProjectsListFn: func(context.Context, ProjectFilters) (*ProjectListResult, error) {
			return &ProjectListResult{Total: 8}, nil
		},
		GetProjectByIDFn: func(context.Context, string) (*ProjectDetail, error) {
			return &ProjectDetail{}, nil
		},
	}

	if got, _ := stub.GetProjectsList(ctx, ProjectFilters{}); got == nil || got.Total != 8 {
		t.Errorf("GetProjectsList = %v", got)
	}
	if got, _ := stub.GetProjectByID(ctx, "p-1"); got == nil {
		t.Error("GetProjectByID returned nil despite the stub")
	}

	empty := &MockProjectStore{}
	if v, err := empty.GetProjectsList(ctx, ProjectFilters{}); v != nil || err != nil {
		t.Errorf("GetProjectsList default = (%v, %v)", v, err)
	}
	if v, err := empty.GetProjectByID(ctx, "x"); v != nil || err != nil {
		t.Errorf("GetProjectByID default = (%v, %v)", v, err)
	}
}

func TestMockFinanceStore_DelegatesAndDefaults(t *testing.T) {
	ctx := context.Background()
	stub := &MockFinanceStore{
		GetSummaryFn: func(context.Context) (*FinanceSummary, error) {
			return &FinanceSummary{TotalRevenue: 1}, nil
		},
		GetEscrowByProjectFn: func(context.Context, int) ([]EscrowProjectRow, error) {
			return []EscrowProjectRow{{ProjectID: "p-1"}}, nil
		},
		GetTransactionsListFn: func(context.Context, TransactionFilters) (*TransactionListResult, error) {
			return &TransactionListResult{Total: 4}, nil
		},
		ReconcileLedgerFn: func(context.Context) (*LedgerReconciliation, error) {
			return &LedgerReconciliation{DriftedAccounts: 2}, nil
		},
	}

	if got, _ := stub.GetSummary(ctx); got == nil || got.TotalRevenue != 1 {
		t.Errorf("GetSummary = %v", got)
	}
	if got, _ := stub.GetEscrowByProject(ctx, 20); len(got) != 1 {
		t.Errorf("GetEscrowByProject = %v", got)
	}
	if got, _ := stub.GetTransactionsList(ctx, TransactionFilters{}); got == nil || got.Total != 4 {
		t.Errorf("GetTransactionsList = %v", got)
	}
	if got, _ := stub.ReconcileLedger(ctx); got == nil || got.DriftedAccounts != 2 {
		t.Errorf("ReconcileLedger = %v", got)
	}

	empty := &MockFinanceStore{}
	if v, err := empty.GetSummary(ctx); v != nil || err != nil {
		t.Errorf("GetSummary default = (%v, %v)", v, err)
	}
	if v, err := empty.GetEscrowByProject(ctx, 20); v != nil || err != nil {
		t.Errorf("GetEscrowByProject default = (%v, %v)", v, err)
	}
	if v, err := empty.GetTransactionsList(ctx, TransactionFilters{}); v != nil || err != nil {
		t.Errorf("GetTransactionsList default = (%v, %v)", v, err)
	}
	if v, err := empty.ReconcileLedger(ctx); v != nil || err != nil {
		t.Errorf("ReconcileLedger default = (%v, %v)", v, err)
	}
}

func TestMockDisputeStore_DelegatesAndDefaults(t *testing.T) {
	ctx := context.Background()
	stub := &MockDisputeStore{
		GetDisputesListFn: func(context.Context, DisputeFilters) (*DisputeListResult, error) {
			return &DisputeListResult{Total: 6}, nil
		},
		GetStatusCountsFn: func(context.Context) (map[string]int64, error) {
			return map[string]int64{"open": 2}, nil
		},
		GetDisputeByIDFn: func(context.Context, string) (*DisputeDetail, error) {
			return &DisputeDetail{}, nil
		},
	}

	if got, _ := stub.GetDisputesList(ctx, DisputeFilters{}); got == nil || got.Total != 6 {
		t.Errorf("GetDisputesList = %v", got)
	}
	if got, _ := stub.GetStatusCounts(ctx); got["open"] != 2 {
		t.Errorf("GetStatusCounts = %v", got)
	}
	if got, _ := stub.GetDisputeByID(ctx, "d-1"); got == nil {
		t.Error("GetDisputeByID returned nil despite the stub")
	}

	empty := &MockDisputeStore{}
	if v, err := empty.GetDisputesList(ctx, DisputeFilters{}); v != nil || err != nil {
		t.Errorf("GetDisputesList default = (%v, %v)", v, err)
	}
	if v, err := empty.GetStatusCounts(ctx); v != nil || err != nil {
		t.Errorf("GetStatusCounts default = (%v, %v)", v, err)
	}
	if v, err := empty.GetDisputeByID(ctx, "x"); v != nil || err != nil {
		t.Errorf("GetDisputeByID default = (%v, %v)", v, err)
	}
}
