package store

import (
	"context"
	"errors"
	"testing"
)

// Each Fn hook must be called when set; a mock that silently ignores its stub
// makes every test using it vacuous.
func TestMockStore_DelegatesToEveryHook(t *testing.T) {
	ctx := context.Background()
	sentinel := errors.New("stubbed")
	want := &Notification{ID: "n-1", UserID: "u-1"}

	m := &MockStore{
		CreateFn: func(context.Context, CreateInput) (*Notification, error) {
			return want, nil
		},
		FindByUserIDFn: func(context.Context, string, int, int, []string) (*PaginatedResult, error) {
			return &PaginatedResult{Total: 9}, nil
		},
		FindByIDFn: func(context.Context, string, string) (*Notification, error) {
			return want, nil
		},
		MarkAsReadFn: func(context.Context, string) (*Notification, error) {
			return want, nil
		},
		MarkAllAsReadFn: func(context.Context, string) (int, error) {
			return 4, nil
		},
		CountUnreadFn: func(context.Context, string) (int, error) {
			return 12, nil
		},
		RecordDeadLetterFn: func(context.Context, DeadLetterInput) error {
			return sentinel
		},
	}

	if got, _ := m.Create(ctx, CreateInput{}); got != want {
		t.Errorf("Create returned %v, want the stubbed row", got)
	}
	if got, _ := m.FindByUserID(ctx, "u-1", 1, 20, nil); got == nil || got.Total != 9 {
		t.Errorf("FindByUserID returned %v, want the stubbed page", got)
	}
	if got, _ := m.FindByID(ctx, "n-1", "u-1"); got != want {
		t.Errorf("FindByID returned %v, want the stubbed row", got)
	}
	if got, _ := m.MarkAsRead(ctx, "n-1"); got != want {
		t.Errorf("MarkAsRead returned %v, want the stubbed row", got)
	}
	if got, _ := m.MarkAllAsRead(ctx, "u-1"); got != 4 {
		t.Errorf("MarkAllAsRead returned %d, want 4", got)
	}
	if got, _ := m.CountUnread(ctx, "u-1"); got != 12 {
		t.Errorf("CountUnread returned %d, want 12", got)
	}
	if err := m.RecordDeadLetter(ctx, DeadLetterInput{}); !errors.Is(err, sentinel) {
		t.Errorf("RecordDeadLetter returned %v, want the stubbed error", err)
	}
}

// With no hook set the mock must be inert rather than panic.
func TestMockStore_RecordDeadLetterDefault(t *testing.T) {
	if err := (&MockStore{}).RecordDeadLetter(context.Background(), DeadLetterInput{}); err != nil {
		t.Errorf("error = %v, want nil", err)
	}
}

// The constructor holds the pool it is given behind the narrowed interface.
func TestNew_HoldsThePool(t *testing.T) {
	s := New(nil)
	if s == nil {
		t.Fatal("New returned nil")
	}
	// A nil *pgxpool.Pool becomes a non-nil interface value, so the field is
	// set and a nil check on it would not catch a missing pool.
	if s.pool == nil {
		t.Error("pool field is nil after New")
	}
}
