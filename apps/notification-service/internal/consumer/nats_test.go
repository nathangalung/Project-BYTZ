package consumer

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/kerjacus/notification-service/internal/sender"
	"github.com/kerjacus/notification-service/internal/store"
)

// fakeRow returns a fixed value or error from Scan.
type fakeRow struct {
	value string
	list  []string
	// bools answers the preference columns, in order. Left nil the caller's own
	// targets are untouched, which is what every test predating the toggles
	// wants: resolveRecipient seeds them on, so nothing is silently muted.
	bools []bool
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
	seen := 0
	for _, d := range dest {
		p, ok := d.(*bool)
		if !ok {
			continue
		}
		if seen < len(r.bools) {
			*p = r.bools[seen]
		}
		seen++
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

// captureTemplates records the template key every notification was written
// with, which is where the difference between an ordinary round and an
// exhausted allowance now lives.
func captureTemplates(target *[]string) *store.MockStore {
	return &store.MockStore{
		CreateFn: func(_ context.Context, in store.CreateInput) (*store.Notification, error) {
			key := ""
			if in.TemplateKey != nil {
				key = *in.TemplateKey
			}
			*target = append(*target, key)
			return nil, fmt.Errorf("stop before delivery")
		},
	}
}

/*
An owner refusing a submission reaches the talent and every admin.

Refusal used to be two subjects: a rejection that always escalated and a
revision request that escalated only once the free rounds were spent. One
milestone status is left, so nothing can tell them apart, and the admin copy is
kept rather than dropped - an owner's refusal going unseen by the people who
arbitrate it is the notification this merge must not lose.
*/
func TestHandleMilestoneChangesRequested_NotifiesTalentAndEveryAdmin(t *testing.T) {
	var got []string
	c := &Consumer{
		store:      captureRecipients(&got),
		db:         fakeQuerier{adminIDs: []string{"admin-1", "admin-2"}},
		centrifugo: sender.NewCentrifugoSender("", ""),
	}

	event := NATSEvent{
		Type: "milestone.changes_requested",
		Data: json.RawMessage(`{"projectId":"p-3","milestoneId":"m-3","talentId":"talent-7"}`),
	}
	_ = c.handleMilestoneChangesRequested(context.Background(), event)

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

// Within the free rounds the admin copy is the ordinary one: feedback to read
// against the agreed scope, not an allowance that has run out.
func TestHandleMilestoneChangesRequested_UsesTheOrdinaryAdminTemplate(t *testing.T) {
	var got []string
	c := &Consumer{
		store:      captureTemplates(&got),
		db:         fakeQuerier{adminIDs: []string{"admin-1"}},
		centrifugo: sender.NewCentrifugoSender("", ""),
	}

	event := NATSEvent{
		Type: "milestone.changes_requested",
		Data: json.RawMessage(`{"projectId":"p-3","milestoneId":"m-3","talentId":"talent-7"}`),
	}
	_ = c.handleMilestoneChangesRequested(context.Background(), event)

	want := []string{
		"notification.milestone_changes_requested",
		"notification.admin_milestone_changes_requested",
	}
	if len(got) != len(want) {
		t.Fatalf("templates %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("template %d = %q, want %q", i, got[i], want[i])
		}
	}
}

/*
The last free round is where the wording changes. That escalation used to
belong to the reject button; with one owner decision left, the exhausted
allowance is the signal, and the project service decides it because
FREE_MILESTONE_REVISIONS lives in packages/shared.
*/
func TestHandleMilestoneChangesRequested_EscalatesWhenFlagged(t *testing.T) {
	var got []string
	c := &Consumer{
		store:      captureTemplates(&got),
		db:         fakeQuerier{adminIDs: []string{"admin-1", "admin-2"}},
		centrifugo: sender.NewCentrifugoSender("", ""),
	}

	event := NATSEvent{
		Type: "milestone.changes_requested",
		Data: json.RawMessage(
			`{"projectId":"p-3","milestoneId":"m-3","talentId":"talent-7","escalated":true}`),
	}
	_ = c.handleMilestoneChangesRequested(context.Background(), event)

	want := []string{
		"notification.milestone_changes_requested",
		"notification.admin_revision_exhausted",
		"notification.admin_revision_exhausted",
	}
	if len(got) != len(want) {
		t.Fatalf("templates %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("template %d = %q, want %q", i, got[i], want[i])
		}
	}
}

// Outbox rows written before this release still carry the retired subjects, so
// the router keeps them pointed at the one handler left.
func TestRetiredMilestoneSubjectsStillNotify(t *testing.T) {
	for _, subject := range []string{"milestone.rejected", "milestone.revision_requested"} {
		var got []string
		c := &Consumer{
			store:      captureRecipients(&got),
			db:         fakeQuerier{adminIDs: []string{"admin-1"}},
			centrifugo: sender.NewCentrifugoSender("", ""),
		}

		event := NATSEvent{
			Type: subject,
			Data: json.RawMessage(`{"projectId":"p-3","milestoneId":"m-3","talentId":"talent-7"}`),
		}
		_ = c.processEvent(context.Background(), event)

		want := []string{"talent-7", "admin-1"}
		if len(got) != len(want) {
			t.Fatalf("%s notified %v, want %v", subject, got, want)
		}
	}
}

/*
A matched project whose escrow is funded and whose work never started. The
sweep has published this hourly since it was written and nothing consumed it,
so the owner's money sat held with no one told. Owner and admin both: the
platform's written remedy is cancellation and a refund, which no job performs,
so an operator is what stands in for it.
*/
func TestHandleProjectStartOverdue_NotifiesOwnerAndEveryAdmin(t *testing.T) {
	var got []string
	c := &Consumer{
		store:      captureRecipients(&got),
		db:         fakeQuerier{adminIDs: []string{"admin-1", "admin-2"}},
		centrifugo: sender.NewCentrifugoSender("", ""),
	}

	event := NATSEvent{
		Type: "project.start_overdue",
		Data: json.RawMessage(`{"projectId":"p-5","ownerId":"owner-1"}`),
	}
	_ = c.handleProjectStartOverdue(context.Background(), event)

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

// The sweep publishes the project id; the owner id is not always on the event.
func TestHandleProjectStartOverdue_ResolvesAnOwnerTheEventOmits(t *testing.T) {
	var got []string
	c := &Consumer{
		store:      captureRecipients(&got),
		db:         fakeQuerier{ownerID: "owner-9"},
		centrifugo: sender.NewCentrifugoSender("", ""),
	}

	event := NATSEvent{
		Type: "project.start_overdue",
		Data: json.RawMessage(`{"projectId":"p-5"}`),
	}
	_ = c.handleProjectStartOverdue(context.Background(), event)

	if len(got) != 1 || got[0] != "owner-9" {
		t.Errorf("notified %v, want [owner-9]", got)
	}
}

// Reaching fewer people beats reaching none, the same rule as team escalation.
func TestHandleProjectStartOverdue_StillNotifiesAdminsWhenTheOwnerIsMissing(t *testing.T) {
	var got []string
	c := &Consumer{
		store:      captureRecipients(&got),
		db:         fakeQuerier{err: fmt.Errorf("db down"), adminIDs: []string{"admin-1"}},
		centrifugo: sender.NewCentrifugoSender("", ""),
	}

	event := NATSEvent{
		Type: "project.start_overdue",
		Data: json.RawMessage(`{"projectId":"p-5"}`),
	}
	err := c.handleProjectStartOverdue(context.Background(), event)

	if err == nil {
		t.Error("expected the owner lookup failure to be reported")
	}
	if len(got) != 1 || got[0] != "admin-1" {
		t.Errorf("notified %v, want [admin-1]", got)
	}
}

func TestHandleProjectStartOverdue_ReportsAnAdminLookupFailure(t *testing.T) {
	var got []string
	c := &Consumer{
		store:      captureRecipients(&got),
		db:         fakeQuerier{ownerID: "owner-1", adminErr: fmt.Errorf("db down")},
		centrifugo: sender.NewCentrifugoSender("", ""),
	}

	event := NATSEvent{
		Type: "project.start_overdue",
		Data: json.RawMessage(`{"projectId":"p-5"}`),
	}
	if err := c.handleProjectStartOverdue(context.Background(), event); err == nil {
		t.Error("expected an error when the admin lookup fails")
	}
}

func TestHandleProjectStartOverdue_RejectsAMalformedPayload(t *testing.T) {
	c := &Consumer{
		store:      &store.MockStore{},
		db:         fakeQuerier{ownerID: "owner-1"},
		centrifugo: sender.NewCentrifugoSender("", ""),
	}

	event := NATSEvent{Type: "project.start_overdue", Data: json.RawMessage(`not json`)}
	if err := c.handleProjectStartOverdue(context.Background(), event); err == nil {
		t.Error("expected an unmarshal error")
	}
}

/*
An approved PRD the owner never acted on. Owner only: nothing is held at this
point, so there is nothing for an admin to intervene in, and paging them for
every owner still deciding trains them to ignore the queue.
*/
func TestHandleProjectDecisionOverdue_TellsTheOwnerAndNobodyElse(t *testing.T) {
	var got []string
	c := &Consumer{
		store:      captureRecipients(&got),
		db:         fakeQuerier{adminIDs: []string{"admin-1", "admin-2"}},
		centrifugo: sender.NewCentrifugoSender("", ""),
	}

	event := NATSEvent{
		Type: "project.decision_overdue",
		Data: json.RawMessage(`{"projectId":"p-6","ownerId":"owner-2"}`),
	}
	_ = c.handleProjectDecisionOverdue(context.Background(), event)

	if len(got) != 1 || got[0] != "owner-2" {
		t.Errorf("notified %v, want [owner-2]", got)
	}
}

func TestHandleProjectDecisionOverdue_ResolvesAnOwnerTheEventOmits(t *testing.T) {
	var got []string
	c := &Consumer{
		store:      captureRecipients(&got),
		db:         fakeQuerier{ownerID: "owner-9"},
		centrifugo: sender.NewCentrifugoSender("", ""),
	}

	event := NATSEvent{
		Type: "project.decision_overdue",
		Data: json.RawMessage(`{"projectId":"p-6"}`),
	}
	_ = c.handleProjectDecisionOverdue(context.Background(), event)

	if len(got) != 1 || got[0] != "owner-9" {
		t.Errorf("notified %v, want [owner-9]", got)
	}
}

func TestHandleProjectDecisionOverdue_ReportsAnOwnerLookupFailure(t *testing.T) {
	var got []string
	c := &Consumer{
		store:      captureRecipients(&got),
		db:         fakeQuerier{err: fmt.Errorf("db down")},
		centrifugo: sender.NewCentrifugoSender("", ""),
	}

	event := NATSEvent{
		Type: "project.decision_overdue",
		Data: json.RawMessage(`{"projectId":"p-6"}`),
	}
	if err := c.handleProjectDecisionOverdue(context.Background(), event); err == nil {
		t.Error("expected the owner lookup failure to be reported")
	}
	if len(got) != 0 {
		t.Errorf("notified %v, want nobody", got)
	}
}

// A project with no owner row left is nothing to report, not an error.
func TestHandleProjectDecisionOverdue_SaysNothingWhenThereIsNoOwner(t *testing.T) {
	var got []string
	c := &Consumer{
		store:      captureRecipients(&got),
		db:         fakeQuerier{ownerID: ""},
		centrifugo: sender.NewCentrifugoSender("", ""),
	}

	event := NATSEvent{
		Type: "project.decision_overdue",
		Data: json.RawMessage(`{"projectId":"p-6"}`),
	}
	if err := c.handleProjectDecisionOverdue(context.Background(), event); err != nil {
		t.Errorf("error = %v, want nil", err)
	}
	if len(got) != 0 {
		t.Errorf("notified %v, want nobody", got)
	}
}

func TestHandleProjectDecisionOverdue_RejectsAMalformedPayload(t *testing.T) {
	c := &Consumer{
		store:      &store.MockStore{},
		db:         fakeQuerier{ownerID: "owner-1"},
		centrifugo: sender.NewCentrifugoSender("", ""),
	}

	event := NATSEvent{Type: "project.decision_overdue", Data: json.RawMessage(`not json`)}
	if err := c.handleProjectDecisionOverdue(context.Background(), event); err == nil {
		t.Error("expected an unmarshal error")
	}
}

// The owner was reached, so the admin failure is the first error to report.
func TestHandleProjectStartOverdue_ReportsAnAdminLookupFailureAfterTellingTheOwner(t *testing.T) {
	var got []string
	c, _, _ := newTestConsumer(&store.MockStore{
		CreateFn: func(_ context.Context, in store.CreateInput) (*store.Notification, error) {
			got = append(got, in.UserID)
			return &store.Notification{ID: "n-1", UserID: in.UserID}, nil
		},
	}, fakeQuerier{ownerID: "owner-1", adminErr: fmt.Errorf("db down")}, nil)

	event := NATSEvent{
		Type: "project.start_overdue",
		Data: json.RawMessage(`{"projectId":"p-5"}`),
	}
	err := c.handleProjectStartOverdue(context.Background(), event)

	if err == nil {
		t.Error("expected the admin lookup failure to be reported")
	}
	if len(got) != 1 || got[0] != "owner-1" {
		t.Errorf("notified %v, want [owner-1]", got)
	}
}

// One admin failing must not swallow the failure or stop the next admin.
func TestHandleProjectStartOverdue_ReportsAnAdminThatCouldNotBeStored(t *testing.T) {
	var got []string
	c, _, _ := newTestConsumer(&store.MockStore{
		CreateFn: func(_ context.Context, in store.CreateInput) (*store.Notification, error) {
			got = append(got, in.UserID)
			if in.UserID == "admin-1" {
				return nil, fmt.Errorf("insert failed")
			}
			return &store.Notification{ID: "n-1", UserID: in.UserID}, nil
		},
	}, fakeQuerier{adminIDs: []string{"admin-1", "admin-2"}}, nil)

	event := NATSEvent{
		Type: "project.start_overdue",
		Data: json.RawMessage(`{"projectId":"p-5","ownerId":"owner-1"}`),
	}
	err := c.handleProjectStartOverdue(context.Background(), event)

	if err == nil {
		t.Error("expected the failed admin notification to be reported")
	}
	want := []string{"owner-1", "admin-1", "admin-2"}
	if len(got) != len(want) {
		t.Fatalf("notified %v, want %v", got, want)
	}
}
