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
}

// Compile-time checks
var _ DashboardStoreInterface = (*DashboardStore)(nil)
var _ UserStoreInterface = (*UserStore)(nil)
