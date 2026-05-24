package store

import (
	"context"
	"encoding/json"
)

// DashboardStoreInterface defines all public methods on DashboardStore.
type DashboardStoreInterface interface {
	GetProjectStats(ctx context.Context) (map[string]int64, error)
	GetRevenueStats(ctx context.Context, dr *DateRange) (*RevenueStats, error)
	GetTalentStats(ctx context.Context) (*TalentStats, error)
	GetDailyRevenue(ctx context.Context, dr *DateRange) ([]DailyRevenuePoint, error)
}

// UserStoreInterface defines all public methods on UserStore.
type UserStoreInterface interface {
	GetUsersList(ctx context.Context, f UserFilters) (*UserListResult, error)
	GetUserByID(ctx context.Context, id string) (*User, error)
	SuspendUser(ctx context.Context, id string) (*User, error)
	UnsuspendUser(ctx context.Context, id string) (*User, error)
	GetAuditLogs(ctx context.Context, page, pageSize int) (*AuditLogResult, error)
	CreateAuditLog(ctx context.Context, id, adminID, action, targetType, targetID string, details json.RawMessage) (*AuditLog, error)
	GetPlatformSettings(ctx context.Context) ([]PlatformSetting, error)
	GetPlatformSetting(ctx context.Context, key string) (*PlatformSetting, error)
	UpsertPlatformSetting(ctx context.Context, id, key string, value json.RawMessage, description *string, adminID string) (*PlatformSetting, error)
	GetTalentDetail(ctx context.Context, userID string) (*TalentDetail, error)
}

// DLQStoreInterface defines all public methods on DLQStore.
type DLQStoreInterface interface {
	GetDLQList(ctx context.Context, f DLQFilters) (*DLQListResult, error)
	GetDLQByID(ctx context.Context, id string) (*DLQEvent, error)
	MarkReprocessed(ctx context.Context, id string) (*DLQEvent, error)
}

// ProjectStoreInterface defines all public methods on ProjectStore.
type ProjectStoreInterface interface {
	GetProjectsList(ctx context.Context, f ProjectFilters) (*ProjectListResult, error)
	GetProjectByID(ctx context.Context, id string) (*ProjectDetail, error)
}

// Compile-time checks
var _ DashboardStoreInterface = (*DashboardStore)(nil)
var _ UserStoreInterface = (*UserStore)(nil)
var _ DLQStoreInterface = (*DLQStore)(nil)
var _ ProjectStoreInterface = (*ProjectStore)(nil)
