package store

import (
	"context"
	"encoding/json"
)

// MockDashboardStore implements DashboardStoreInterface for testing.
type MockDashboardStore struct {
	GetProjectStatsFn func(ctx context.Context) (map[string]int64, error)
	GetRevenueStatsFn func(ctx context.Context, dr *DateRange) (*RevenueStats, error)
	GetTalentStatsFn  func(ctx context.Context) (*TalentStats, error)
	GetDailyRevenueFn func(ctx context.Context, dr *DateRange) ([]DailyRevenuePoint, error)
}

func (m *MockDashboardStore) GetProjectStats(ctx context.Context) (map[string]int64, error) {
	if m.GetProjectStatsFn != nil {
		return m.GetProjectStatsFn(ctx)
	}
	return nil, nil
}

func (m *MockDashboardStore) GetRevenueStats(ctx context.Context, dr *DateRange) (*RevenueStats, error) {
	if m.GetRevenueStatsFn != nil {
		return m.GetRevenueStatsFn(ctx, dr)
	}
	return nil, nil
}

func (m *MockDashboardStore) GetTalentStats(ctx context.Context) (*TalentStats, error) {
	if m.GetTalentStatsFn != nil {
		return m.GetTalentStatsFn(ctx)
	}
	return nil, nil
}

func (m *MockDashboardStore) GetDailyRevenue(ctx context.Context, dr *DateRange) ([]DailyRevenuePoint, error) {
	if m.GetDailyRevenueFn != nil {
		return m.GetDailyRevenueFn(ctx, dr)
	}
	return nil, nil
}

// MockUserStore implements UserStoreInterface for testing.
type MockUserStore struct {
	GetUsersListFn          func(ctx context.Context, f UserFilters) (*UserListResult, error)
	GetUserByIDFn           func(ctx context.Context, id string) (*User, error)
	SuspendUserFn           func(ctx context.Context, id string) (*User, error)
	UnsuspendUserFn         func(ctx context.Context, id string) (*User, error)
	GetAuditLogsFn          func(ctx context.Context, page, pageSize int) (*AuditLogResult, error)
	CreateAuditLogFn        func(ctx context.Context, id, adminID, action, targetType, targetID string, details json.RawMessage) (*AuditLog, error)
	GetPlatformSettingsFn   func(ctx context.Context) ([]PlatformSetting, error)
	GetPlatformSettingFn    func(ctx context.Context, key string) (*PlatformSetting, error)
	UpsertPlatformSettingFn func(ctx context.Context, id, key string, value json.RawMessage, description *string, adminID string) (*PlatformSetting, error)
	GetTalentDetailFn       func(ctx context.Context, userID string) (*TalentDetail, error)
}

func (m *MockUserStore) GetUsersList(ctx context.Context, f UserFilters) (*UserListResult, error) {
	if m.GetUsersListFn != nil {
		return m.GetUsersListFn(ctx, f)
	}
	return nil, nil
}

func (m *MockUserStore) GetUserByID(ctx context.Context, id string) (*User, error) {
	if m.GetUserByIDFn != nil {
		return m.GetUserByIDFn(ctx, id)
	}
	return nil, nil
}

func (m *MockUserStore) SuspendUser(ctx context.Context, id string) (*User, error) {
	if m.SuspendUserFn != nil {
		return m.SuspendUserFn(ctx, id)
	}
	return nil, nil
}

func (m *MockUserStore) UnsuspendUser(ctx context.Context, id string) (*User, error) {
	if m.UnsuspendUserFn != nil {
		return m.UnsuspendUserFn(ctx, id)
	}
	return nil, nil
}

func (m *MockUserStore) GetAuditLogs(ctx context.Context, page, pageSize int) (*AuditLogResult, error) {
	if m.GetAuditLogsFn != nil {
		return m.GetAuditLogsFn(ctx, page, pageSize)
	}
	return nil, nil
}

func (m *MockUserStore) CreateAuditLog(ctx context.Context, id, adminID, action, targetType, targetID string, details json.RawMessage) (*AuditLog, error) {
	if m.CreateAuditLogFn != nil {
		return m.CreateAuditLogFn(ctx, id, adminID, action, targetType, targetID, details)
	}
	return nil, nil
}

func (m *MockUserStore) GetPlatformSettings(ctx context.Context) ([]PlatformSetting, error) {
	if m.GetPlatformSettingsFn != nil {
		return m.GetPlatformSettingsFn(ctx)
	}
	return nil, nil
}

func (m *MockUserStore) GetPlatformSetting(ctx context.Context, key string) (*PlatformSetting, error) {
	if m.GetPlatformSettingFn != nil {
		return m.GetPlatformSettingFn(ctx, key)
	}
	return nil, nil
}

func (m *MockUserStore) UpsertPlatformSetting(ctx context.Context, id, key string, value json.RawMessage, description *string, adminID string) (*PlatformSetting, error) {
	if m.UpsertPlatformSettingFn != nil {
		return m.UpsertPlatformSettingFn(ctx, id, key, value, description, adminID)
	}
	return nil, nil
}

func (m *MockUserStore) GetTalentDetail(ctx context.Context, userID string) (*TalentDetail, error) {
	if m.GetTalentDetailFn != nil {
		return m.GetTalentDetailFn(ctx, userID)
	}
	return nil, nil
}

// MockDLQStore implements DLQStoreInterface for testing.
type MockDLQStore struct {
	GetDLQListFn      func(ctx context.Context, f DLQFilters) (*DLQListResult, error)
	GetDLQByIDFn      func(ctx context.Context, id string) (*DLQEvent, error)
	MarkReprocessedFn func(ctx context.Context, id string) (*DLQEvent, error)
}

func (m *MockDLQStore) GetDLQList(ctx context.Context, f DLQFilters) (*DLQListResult, error) {
	if m.GetDLQListFn != nil {
		return m.GetDLQListFn(ctx, f)
	}
	return nil, nil
}

func (m *MockDLQStore) GetDLQByID(ctx context.Context, id string) (*DLQEvent, error) {
	if m.GetDLQByIDFn != nil {
		return m.GetDLQByIDFn(ctx, id)
	}
	return nil, nil
}

func (m *MockDLQStore) MarkReprocessed(ctx context.Context, id string) (*DLQEvent, error) {
	if m.MarkReprocessedFn != nil {
		return m.MarkReprocessedFn(ctx, id)
	}
	return nil, nil
}

// MockProjectStore implements ProjectStoreInterface for testing.
type MockProjectStore struct {
	GetProjectsListFn func(ctx context.Context, f ProjectFilters) (*ProjectListResult, error)
	GetProjectByIDFn  func(ctx context.Context, id string) (*ProjectDetail, error)
}

func (m *MockProjectStore) GetProjectsList(ctx context.Context, f ProjectFilters) (*ProjectListResult, error) {
	if m.GetProjectsListFn != nil {
		return m.GetProjectsListFn(ctx, f)
	}
	return nil, nil
}

func (m *MockProjectStore) GetProjectByID(ctx context.Context, id string) (*ProjectDetail, error) {
	if m.GetProjectByIDFn != nil {
		return m.GetProjectByIDFn(ctx, id)
	}
	return nil, nil
}
