package consumer

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"

	"github.com/bytz/notification-service/internal/sender"
	"github.com/bytz/notification-service/internal/store"
	"github.com/jackc/pgx/v5"
)

// fakeRow returns a fixed value or error from Scan.
type fakeRow struct {
	value string
	err   error
}

func (r fakeRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	if len(dest) > 0 {
		if p, ok := dest[0].(*string); ok {
			*p = r.value
		}
	}
	return nil
}

// fakeQuerier stands in for the pgxpool.Pool owner lookup.
type fakeQuerier struct {
	ownerID string
	err     error
}

func (q fakeQuerier) QueryRow(_ context.Context, _ string, _ ...any) pgx.Row {
	return fakeRow{value: q.ownerID, err: q.err}
}

// captureRecipient returns a store whose Create records the target user.
func captureRecipient(target *string) *store.MockStore {
	return &store.MockStore{
		CreateFn: func(_ context.Context, in store.CreateInput) (*store.Notification, error) {
			*target = in.UserID
			return nil, fmt.Errorf("stop before delivery")
		},
	}
}

func TestHandleMilestoneSubmitted_NotifiesOwner(t *testing.T) {
	var got string
	c := &Consumer{
		store:      captureRecipient(&got),
		db:         fakeQuerier{ownerID: "owner-123"},
		centrifugo: sender.NewCentrifugoSender("", ""),
	}

	event := NATSEvent{
		Type: "milestone.submitted",
		Data: json.RawMessage(`{"milestoneId":"m-1","projectId":"p-1","talentId":"talent-9"}`),
	}
	_ = c.handleMilestoneSubmitted(context.Background(), event)

	if got != "owner-123" {
		t.Errorf("recipient = %q, want owner-123 (the owner reviews, not the talent)", got)
	}
}

func TestHandleMilestoneSubmitted_OwnerLookupError(t *testing.T) {
	c := &Consumer{
		store:      &store.MockStore{},
		db:         fakeQuerier{err: fmt.Errorf("db down")},
		centrifugo: sender.NewCentrifugoSender("", ""),
	}

	event := NATSEvent{
		Type: "milestone.submitted",
		Data: json.RawMessage(`{"projectId":"p-1","talentId":"talent-9"}`),
	}
	if err := c.handleMilestoneSubmitted(context.Background(), event); err == nil {
		t.Error("expected error when owner lookup fails")
	}
}

func TestHandleTeamComplete_NotifiesOwner(t *testing.T) {
	var got string
	c := &Consumer{
		store:      captureRecipient(&got),
		db:         fakeQuerier{ownerID: "owner-456"},
		centrifugo: sender.NewCentrifugoSender("", ""),
	}

	event := NATSEvent{
		Type: "project.team.complete",
		Data: json.RawMessage(`{"projectId":"p-2"}`),
	}
	_ = c.handleTeamComplete(context.Background(), event)

	if got != "owner-456" {
		t.Errorf("recipient = %q, want owner-456", got)
	}
}

func TestHandleTeamComplete_OwnerLookupError(t *testing.T) {
	c := &Consumer{
		store:      &store.MockStore{},
		db:         fakeQuerier{err: fmt.Errorf("db down")},
		centrifugo: sender.NewCentrifugoSender("", ""),
	}

	event := NATSEvent{
		Type: "project.team.complete",
		Data: json.RawMessage(`{"projectId":"p-2"}`),
	}
	if err := c.handleTeamComplete(context.Background(), event); err == nil {
		t.Error("expected error when owner lookup fails")
	}
}
