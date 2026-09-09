package consumer

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/bytz/notification-service/internal/sender"
	"github.com/bytz/notification-service/internal/store"
	"github.com/jackc/pgx/v5"
)

// fakeRow returns a fixed value or error from Scan.
type fakeRow struct {
	value string
	list  []string
	err   error
}

func (r fakeRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	if len(dest) > 0 {
		switch p := dest[0].(type) {
		case *string:
			*p = r.value
		case *[]string:
			*p = r.list
		}
	}
	return nil
}

// fakeQuerier stands in for the pgxpool.Pool owner lookup.
type fakeQuerier struct {
	ownerID  string
	adminIDs []string
	adminErr error
	err      error
}

// Two different lookups reach this, told apart by the aggregate the admin
// query uses. Keying on the SQL keeps one fake serving both.
func (q fakeQuerier) QueryRow(_ context.Context, sql string, _ ...any) pgx.Row {
	if strings.Contains(sql, "array_agg") {
		return fakeRow{list: q.adminIDs, err: q.adminErr}
	}
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

// captureRecipients records every notified user rather than only the first.
func captureRecipients(target *[]string) *store.MockStore {
	return &store.MockStore{
		CreateFn: func(_ context.Context, in store.CreateInput) (*store.Notification, error) {
			*target = append(*target, in.UserID)
			return nil, fmt.Errorf("stop before delivery")
		},
	}
}

/*
The 14-day team formation deadline used to expire in silence: the workflow
emitted project.team.escalated and the subject sat in knowinglyUnhandled, so
nobody was told the project had stalled.
*/
func TestHandleTeamEscalated_NotifiesOwnerAndEveryAdmin(t *testing.T) {
	var got []string
	c := &Consumer{
		store:      captureRecipients(&got),
		db:         fakeQuerier{ownerID: "owner-1", adminIDs: []string{"admin-1", "admin-2"}},
		centrifugo: sender.NewCentrifugoSender("", ""),
	}

	event := NATSEvent{
		Type: "project.team.escalated",
		Data: json.RawMessage(`{"projectId":"p-9","reason":"deadline_exceeded"}`),
	}
	_ = c.handleTeamEscalated(context.Background(), event)

	want := []string{"owner-1", "admin-1", "admin-2"}
	if len(got) != len(want) {
		t.Fatalf("notified %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("recipient %d = %q, want %q", i, got[i], want[i])
		}
	}
}

// An escalation reaching nobody is the bug being fixed, so a missing owner
// must not stop the admins from hearing about it.
func TestHandleTeamEscalated_StillNotifiesAdminsWhenTheOwnerIsMissing(t *testing.T) {
	var got []string
	c := &Consumer{
		store:      captureRecipients(&got),
		db:         fakeQuerier{err: fmt.Errorf("db down"), adminIDs: []string{"admin-1"}},
		centrifugo: sender.NewCentrifugoSender("", ""),
	}

	event := NATSEvent{
		Type: "project.team.escalated",
		Data: json.RawMessage(`{"projectId":"p-9","reason":"deadline_exceeded"}`),
	}
	err := c.handleTeamEscalated(context.Background(), event)

	if err == nil {
		t.Error("expected the owner lookup failure to be reported")
	}
	if len(got) != 1 || got[0] != "admin-1" {
		t.Errorf("notified %v, want [admin-1]", got)
	}
}

func TestHandleTeamEscalated_ReportsAnAdminLookupFailure(t *testing.T) {
	var got []string
	c := &Consumer{
		store:      captureRecipients(&got),
		db:         fakeQuerier{ownerID: "owner-1", adminErr: fmt.Errorf("db down")},
		centrifugo: sender.NewCentrifugoSender("", ""),
	}

	event := NATSEvent{
		Type: "project.team.escalated",
		Data: json.RawMessage(`{"projectId":"p-9","reason":"deadline_exceeded"}`),
	}
	if err := c.handleTeamEscalated(context.Background(), event); err == nil {
		t.Error("expected an error when the admin lookup fails")
	}
}

func TestHandleTeamEscalated_RejectsAMalformedPayload(t *testing.T) {
	c := &Consumer{
		store:      &store.MockStore{},
		db:         fakeQuerier{ownerID: "owner-1"},
		centrifugo: sender.NewCentrifugoSender("", ""),
	}

	event := NATSEvent{Type: "project.team.escalated", Data: json.RawMessage(`not json`)}
	if err := c.handleTeamEscalated(context.Background(), event); err == nil {
		t.Error("expected an unmarshal error")
	}
}

/*
Rejection is the owner declaring the work unusable, and it now spends one of the
revision rounds, so an admin checks it against the agreed scope. A revision
request stays between owner and talent; only rejection escalates.
*/
func TestHandleMilestoneRejected_NotifiesTalentAndEveryAdmin(t *testing.T) {
	var got []string
	c := &Consumer{
		store:      captureRecipients(&got),
		db:         fakeQuerier{adminIDs: []string{"admin-1", "admin-2"}},
		centrifugo: sender.NewCentrifugoSender("", ""),
	}

	event := NATSEvent{
		Type: "milestone.rejected",
		Data: json.RawMessage(`{"projectId":"p-3","milestoneId":"m-3","talentId":"talent-7"}`),
	}
	_ = c.handleMilestoneRejected(context.Background(), event)

	want := []string{"talent-7", "admin-1", "admin-2"}
	if len(got) != len(want) {
		t.Fatalf("notified %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("recipient %d = %q, want %q", i, got[i], want[i])
		}
	}
}

// Within the free rounds a revision stays between owner and talent. Escalating
// every round trains admins to ignore the queue.
func TestHandleMilestoneRevisionRequested_LeavesAdminsOut(t *testing.T) {
	var got []string
	c := &Consumer{
		store:      captureRecipients(&got),
		db:         fakeQuerier{adminIDs: []string{"admin-1"}},
		centrifugo: sender.NewCentrifugoSender("", ""),
	}

	event := NATSEvent{
		Type: "milestone.revision_requested",
		Data: json.RawMessage(`{"projectId":"p-3","milestoneId":"m-3","talentId":"talent-7"}`),
	}
	_ = c.handleMilestoneRevisionRequested(context.Background(), event)

	if len(got) != 1 || got[0] != "talent-7" {
		t.Errorf("notified %v, want [talent-7]", got)
	}
}

/*
The last free round is where an admin reads in. That escalation used to belong
to the reject button; with one owner decision left, the exhausted allowance is
the signal, and the project service decides it because FREE_MILESTONE_REVISIONS
lives in packages/shared.
*/
func TestHandleMilestoneRevisionRequested_EscalatesWhenFlagged(t *testing.T) {
	var got []string
	c := &Consumer{
		store:      captureRecipients(&got),
		db:         fakeQuerier{adminIDs: []string{"admin-1", "admin-2"}},
		centrifugo: sender.NewCentrifugoSender("", ""),
	}

	event := NATSEvent{
		Type: "milestone.revision_requested",
		Data: json.RawMessage(
			`{"projectId":"p-3","milestoneId":"m-3","talentId":"talent-7","escalated":true}`),
	}
	_ = c.handleMilestoneRevisionRequested(context.Background(), event)

	want := []string{"talent-7", "admin-1", "admin-2"}
	if len(got) != len(want) {
		t.Fatalf("notified %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("recipient %d = %q, want %q", i, got[i], want[i])
		}
	}
}
