package store

import "context"

// MockStore implements StoreInterface for testing.
type MockStore struct {
	CreateFn        func(ctx context.Context, in CreateInput) (*Notification, error)
	FindByUserIDFn  func(ctx context.Context, userID string, page, pageSize int) (*PaginatedResult, error)
	FindByIDFn      func(ctx context.Context, id string, userID string) (*Notification, error)
	MarkAsReadFn    func(ctx context.Context, id string) (*Notification, error)
	MarkAllAsReadFn func(ctx context.Context, userID string) (int, error)
	CountUnreadFn   func(ctx context.Context, userID string) (int, error)
}

func (m *MockStore) Create(ctx context.Context, in CreateInput) (*Notification, error) {
	if m.CreateFn != nil {
		return m.CreateFn(ctx, in)
	}
	return nil, nil
}

func (m *MockStore) FindByUserID(ctx context.Context, userID string, page, pageSize int) (*PaginatedResult, error) {
	if m.FindByUserIDFn != nil {
		return m.FindByUserIDFn(ctx, userID, page, pageSize)
	}
	return nil, nil
}

func (m *MockStore) FindByID(ctx context.Context, id string, userID string) (*Notification, error) {
	if m.FindByIDFn != nil {
		return m.FindByIDFn(ctx, id, userID)
	}
	return nil, nil
}

func (m *MockStore) MarkAsRead(ctx context.Context, id string) (*Notification, error) {
	if m.MarkAsReadFn != nil {
		return m.MarkAsReadFn(ctx, id)
	}
	return nil, nil
}

func (m *MockStore) MarkAllAsRead(ctx context.Context, userID string) (int, error) {
	if m.MarkAllAsReadFn != nil {
		return m.MarkAllAsReadFn(ctx, userID)
	}
	return 0, nil
}

func (m *MockStore) CountUnread(ctx context.Context, userID string) (int, error) {
	if m.CountUnreadFn != nil {
		return m.CountUnreadFn(ctx, userID)
	}
	return 0, nil
}
