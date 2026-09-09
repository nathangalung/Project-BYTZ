package consumer

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/bytz/notification-service/internal/store"
	"github.com/jackc/pgx/v5"
)

/*
The paths a handler takes when something under it fails.

Every one of these ends with a notification that does not arrive, which is the
failure this service exists to prevent, and none of them had been executed: the
handlers were verified on their happy path only.
*/

// failingStore refuses to write, so a handler's own error handling runs.
func failingStore(recipients *[]string, failFor string) *store.MockStore {
	return &store.MockStore{
		CreateFn: func(_ context.Context, in store.CreateInput) (*store.Notification, error) {
			*recipients = append(*recipients, in.UserID)
			if failFor == "" || in.UserID == failFor {
				return nil, fmt.Errorf("insert failed")
			}
			return &store.Notification{ID: "n-1", UserID: in.UserID}, nil
		},
	}
}

// partyQuerier answers the party lookups each handler makes, and can be made
// to fail one of them at a time.
type partyQuerier struct {
	owner     string
	parties   []string
	unsigned  int64
	adminIDs  []string
	adminErr  error
	partyErr  error
	ownerErr  error
	countErr  error
	partiesAs string
}

func (q partyQuerier) QueryRow(_ context.Context, sql string, _ ...any) pgx.Row {
	switch {
	case strings.Contains(sql, "array_agg(id)"):
		return fakeRow{list: q.adminIDs, err: q.adminErr}
	case strings.Contains(sql, "contracts") && strings.Contains(sql, "count"):
		return countRow{value: q.unsigned, err: q.countErr}
	case strings.Contains(sql, "array_agg"):
		return fakeRow{list: q.parties, err: q.partyErr}
	case q.partiesAs == "pair":
		return twoValueRow{a: q.parties[0], b: q.parties[1], err: q.partyErr}
	default:
		return fakeRow{value: q.owner, err: q.ownerErr}
	}
}

type countRow struct {
	value int64
	err   error
}

func (r countRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	switch p := dest[0].(type) {
	case *int:
		*p = int(r.value)
	case *int64:
		*p = r.value
	}
	return nil
}

// A store that cannot write must be reported so JetStream redelivers.
func TestHandlers_ReportAStoreThatWillNotWrite(t *testing.T) {
	tests := []struct {
		subject string
		data    string
		querier Querier
	}{
		{
			subject: "dispute.created",
			data:    `{"disputeId":"d-1","projectId":"p-1","againstUserId":"talent-1"}`,
			querier: partyQuerier{adminIDs: []string{"admin-1"}},
		},
		{
			subject: "milestone.rejected",
			data:    `{"milestoneId":"m-1","projectId":"p-1","talentId":"talent-1"}`,
			querier: partyQuerier{adminIDs: []string{"admin-1"}},
		},
		{
			subject: "milestone.revision_requested",
			data:    `{"milestoneId":"m-1","projectId":"p-1","talentId":"talent-1","escalated":true}`,
			querier: partyQuerier{adminIDs: []string{"admin-1"}},
		},
		{
			subject: "milestone.overdue",
			data:    `{"milestoneId":"m-1","projectId":"p-1","talentId":"talent-1"}`,
			querier: partyQuerier{owner: "owner-1"},
		},
		{
			subject: "contract.created",
			data:    `{"contractId":"c-1","projectId":"p-1","type":"standard_nda"}`,
			querier: partyQuerier{parties: []string{"owner-1", "talent-1"}, partiesAs: "pair"},
		},
		{
			subject: "application.created",
			data:    `{"applicationId":"a-1","projectId":"p-1","talentId":"tp-1"}`,
			querier: partyQuerier{owner: "owner-1"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.subject, func(t *testing.T) {
			var got []string
			c, _, _ := newTestConsumer(failingStore(&got, ""), tt.querier, nil)

			err := c.processEvent(context.Background(), NATSEvent{
				Type: tt.subject,
				Data: json.RawMessage(tt.data),
			})

			if err == nil {
				t.Fatalf("%s: expected the write failure to be reported", tt.subject)
			}
			if len(got) == 0 {
				t.Errorf("%s: no notification was attempted", tt.subject)
			}
		})
	}
}

/*
An admin queue that cannot be read must not be swallowed by a successful
notification to the other party. The handlers differ in which error wins, but
all of them have to return one.
*/
func TestHandlers_ReportAnAdminLookupFailure(t *testing.T) {
	tests := []struct {
		subject string
		data    string
	}{
		{"dispute.created", `{"disputeId":"d-1","projectId":"p-1","againstUserId":"talent-1"}`},
		{"milestone.rejected", `{"milestoneId":"m-1","projectId":"p-1","talentId":"talent-1"}`},
		// Admins only read in once the free rounds are spent.
		{"milestone.revision_requested", `{"milestoneId":"m-1","projectId":"p-1","talentId":"talent-1","escalated":true}`},
	}

	for _, tt := range tests {
		t.Run(tt.subject, func(t *testing.T) {
			var got []string
			q := partyQuerier{owner: "owner-1", adminErr: fmt.Errorf("db down")}
			c, _, _ := newTestConsumer(failingStore(&got, "nobody"), q, nil)

			err := c.processEvent(context.Background(), NATSEvent{
				Type: tt.subject,
				Data: json.RawMessage(tt.data),
			})

			if err == nil {
				t.Fatalf("%s: expected the admin lookup failure to be reported", tt.subject)
			}
		})
	}
}

// The dispute row carries who the parties were; the event does not.
func TestHandleDisputeResolved_SaysNothingForADisputeThatIsGone(t *testing.T) {
	var got []string
	q := partyQuerier{parties: []string{"", ""}, partiesAs: "pair", partyErr: pgx.ErrNoRows}
	c, _, _ := newTestConsumer(failingStore(&got, "nobody"), q, nil)

	err := c.processEvent(context.Background(), NATSEvent{
		Type: "dispute.resolved",
		Data: json.RawMessage(`{"disputeId":"d-1","projectId":"p-1","resolutionType":"split"}`),
	})

	if err != nil {
		t.Errorf("error = %v, want nil for a dispute that no longer exists", err)
	}
	if len(got) != 0 {
		t.Errorf("notified %v, want nobody", got)
	}
}

func TestHandleDisputeResolved_ReportsAPartyLookupFailure(t *testing.T) {
	var got []string
	q := partyQuerier{parties: []string{"", ""}, partiesAs: "pair", partyErr: errors.New("db down")}
	c, _, _ := newTestConsumer(failingStore(&got, "nobody"), q, nil)

	err := c.processEvent(context.Background(), NATSEvent{
		Type: "dispute.resolved",
		Data: json.RawMessage(`{"disputeId":"d-1","projectId":"p-1","resolutionType":"split"}`),
	})

	if err == nil {
		t.Error("expected the party lookup failure to be reported")
	}
}

// A party that resolved to nothing is skipped rather than notified blank.
func TestHandleDisputeResolved_SkipsAPartyItCannotName(t *testing.T) {
	var got []string
	q := partyQuerier{parties: []string{"owner-1", ""}, partiesAs: "pair"}
	c, _, _ := newTestConsumer(failingStore(&got, "nobody"), q, nil)

	if err := c.processEvent(context.Background(), NATSEvent{
		Type: "dispute.resolved",
		Data: json.RawMessage(`{"disputeId":"d-1","projectId":"p-1","resolutionType":"split"}`),
	}); err != nil {
		t.Fatalf("error = %v", err)
	}
	if len(got) != 1 || got[0] != "owner-1" {
		t.Errorf("notified %v, want [owner-1]", got)
	}
}

func TestHandleContractCreated_ReportsAPartyLookupFailure(t *testing.T) {
	var got []string
	q := partyQuerier{parties: []string{"", ""}, partiesAs: "pair", partyErr: errors.New("db down")}
	c, _, _ := newTestConsumer(failingStore(&got, "nobody"), q, nil)

	err := c.processEvent(context.Background(), NATSEvent{
		Type: "contract.created",
		Data: json.RawMessage(`{"contractId":"c-1","projectId":"p-1","type":"standard_nda"}`),
	})

	if err == nil {
		t.Error("expected the party lookup failure to be reported")
	}
}

/*
One agreement signed does not open the gate: the handler asks the same question
the transition does, and only an answer of none reaches anyone.
*/
func TestHandleContractFullyExecuted_SaysNothingWhileOneIsUnsigned(t *testing.T) {
	var got []string
	q := partyQuerier{unsigned: 1, parties: []string{"owner-1", "talent-1"}}
	c, _, _ := newTestConsumer(failingStore(&got, "nobody"), q, nil)

	if err := c.processEvent(context.Background(), NATSEvent{
		Type: "contract.fully_executed",
		Data: json.RawMessage(`{"contractId":"c-1","projectId":"p-1"}`),
	}); err != nil {
		t.Fatalf("error = %v", err)
	}
	if len(got) != 0 {
		t.Errorf("notified %v, want nobody", got)
	}
}

func TestHandleContractFullyExecuted_ReportsACountThatFailed(t *testing.T) {
	var got []string
	q := partyQuerier{countErr: errors.New("db down")}
	c, _, _ := newTestConsumer(failingStore(&got, "nobody"), q, nil)

	err := c.processEvent(context.Background(), NATSEvent{
		Type: "contract.fully_executed",
		Data: json.RawMessage(`{"contractId":"c-1","projectId":"p-1"}`),
	})

	if err == nil {
		t.Error("expected the count failure to be reported")
	}
}

func TestHandleContractFullyExecuted_ReportsAPartyLookupFailure(t *testing.T) {
	var got []string
	q := partyQuerier{unsigned: 0, partyErr: errors.New("db down")}
	c, _, _ := newTestConsumer(failingStore(&got, "nobody"), q, nil)

	err := c.processEvent(context.Background(), NATSEvent{
		Type: "contract.fully_executed",
		Data: json.RawMessage(`{"contractId":"c-1","projectId":"p-1"}`),
	})

	if err == nil {
		t.Error("expected the party lookup failure to be reported")
	}
}

func TestHandleApplicationCreated_ReportsAnOwnerLookupFailure(t *testing.T) {
	var got []string
	q := partyQuerier{ownerErr: errors.New("db down")}
	c, _, _ := newTestConsumer(failingStore(&got, "nobody"), q, nil)

	err := c.processEvent(context.Background(), NATSEvent{
		Type: "application.created",
		Data: json.RawMessage(`{"applicationId":"a-1","projectId":"p-1","talentId":"tp-1"}`),
	})

	if err == nil {
		t.Error("expected the owner lookup failure to be reported")
	}
}

// A project with no owner row is nothing to report, not a retry.
func TestHandleApplicationCreated_SaysNothingWithoutAnOwner(t *testing.T) {
	var got []string
	c, _, _ := newTestConsumer(failingStore(&got, "nobody"), partyQuerier{owner: ""}, nil)

	if err := c.processEvent(context.Background(), NATSEvent{
		Type: "application.created",
		Data: json.RawMessage(`{"applicationId":"a-1","projectId":"p-1","talentId":"tp-1"}`),
	}); err != nil {
		t.Errorf("error = %v, want nil", err)
	}
	if len(got) != 0 {
		t.Errorf("notified %v, want nobody", got)
	}
}

// notification.send carries either a catalog key or raw wording.
func TestHandleNotificationSend_RendersFromACatalogKey(t *testing.T) {
	var got []store.CreateInput
	st := &store.MockStore{
		CreateFn: func(_ context.Context, in store.CreateInput) (*store.Notification, error) {
			got = append(got, in)
			return &store.Notification{ID: "n-1", UserID: in.UserID}, nil
		},
	}
	c, _, _ := newTestConsumer(st, partyQuerier{}, nil)

	err := c.processEvent(context.Background(), NATSEvent{
		Type: "notification.send",
		Data: json.RawMessage(`{"userId":"admin-1","type":"system",
			"templateKey":"notification.admin_ai_degraded",
			"templateParams":{"errors":3,"total":10},"channels":["in_app"]}`),
	})
	if err != nil {
		t.Fatalf("error = %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("created %d notifications, want 1", len(got))
	}
	if got[0].TemplateKey == nil || *got[0].TemplateKey != "notification.admin_ai_degraded" {
		t.Errorf("template key = %v, want the catalog key", got[0].TemplateKey)
	}
	if !strings.Contains(got[0].Message, "3") {
		t.Errorf("message %q did not interpolate the params", got[0].Message)
	}
}

// An event naming nobody is dropped rather than stored against an empty id.
func TestCreateAndDeliver_SkipsAnEmptyRecipient(t *testing.T) {
	var got []string
	c, _, _ := newTestConsumer(failingStore(&got, ""), partyQuerier{}, nil)

	err := c.createAndDeliver(context.Background(), "", store.TypeSystem,
		"notification.admin_ai_degraded", nil, nil, []string{"in_app"})

	if err != nil {
		t.Errorf("error = %v, want nil", err)
	}
	if len(got) != 0 {
		t.Errorf("stored %v, want nothing", got)
	}
}

/*
The second recipient failing while the first was reached.

Each of these handlers keeps the first error and carries on down the list, so
this is the branch that decides whether one bad row hides the rest.
*/
func TestHandlers_ReportASecondRecipientThatCouldNotBeStored(t *testing.T) {
	tests := []struct {
		subject string
		data    string
		failFor string
		querier Querier
		want    []string
	}{
		{
			subject: "project.team.escalated",
			data:    `{"projectId":"p-1","reason":"deadline_exceeded"}`,
			failFor: "admin-1",
			querier: partyQuerier{owner: "owner-1", adminIDs: []string{"admin-1", "admin-2"}},
			want:    []string{"owner-1", "admin-1", "admin-2"},
		},
		{
			subject: "dispute.created",
			data:    `{"disputeId":"d-1","projectId":"p-1","againstUserId":"talent-1"}`,
			failFor: "admin-1",
			querier: partyQuerier{adminIDs: []string{"admin-1"}},
			want:    []string{"talent-1", "admin-1"},
		},
		{
			subject: "milestone.rejected",
			data:    `{"milestoneId":"m-1","projectId":"p-1","talentId":"talent-1"}`,
			failFor: "admin-1",
			querier: partyQuerier{adminIDs: []string{"admin-1"}},
			want:    []string{"talent-1", "admin-1"},
		},
		{
			subject: "milestone.revision_requested",
			data:    `{"milestoneId":"m-1","projectId":"p-1","talentId":"talent-1","escalated":true}`,
			failFor: "admin-1",
			querier: partyQuerier{adminIDs: []string{"admin-1"}},
			want:    []string{"talent-1", "admin-1"},
		},
		{
			// The owner is the one whose grace period before disputing starts.
			subject: "milestone.overdue",
			data:    `{"milestoneId":"m-1","projectId":"p-1","talentId":"talent-1"}`,
			failFor: "owner-1",
			querier: partyQuerier{owner: "owner-1"},
			want:    []string{"talent-1", "owner-1"},
		},
		{
			subject: "dispute.resolved",
			data:    `{"disputeId":"d-1","projectId":"p-1","resolutionType":"split"}`,
			failFor: "talent-1",
			querier: partyQuerier{parties: []string{"owner-1", "talent-1"}, partiesAs: "pair"},
			want:    []string{"owner-1", "talent-1"},
		},
		{
			subject: "contract.created",
			data:    `{"contractId":"c-1","projectId":"p-1","type":"standard_nda"}`,
			failFor: "talent-1",
			querier: partyQuerier{parties: []string{"owner-1", "talent-1"}, partiesAs: "pair"},
			want:    []string{"owner-1", "talent-1"},
		},
		{
			// An id the union returned empty is skipped, not stored blank.
			subject: "contract.fully_executed",
			data:    `{"contractId":"c-1","projectId":"p-1"}`,
			failFor: "talent-1",
			querier: partyQuerier{unsigned: 0, parties: []string{"owner-1", "", "talent-1"}},
			want:    []string{"owner-1", "talent-1"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.subject, func(t *testing.T) {
			var got []string
			c, _, _ := newTestConsumer(failingStore(&got, tt.failFor), tt.querier, nil)

			err := c.processEvent(context.Background(), NATSEvent{
				Type: tt.subject,
				Data: json.RawMessage(tt.data),
			})

			if err == nil {
				t.Fatalf("%s: expected the failed notification to be reported", tt.subject)
			}
			if len(got) != len(tt.want) {
				t.Fatalf("%s: notified %v, want %v", tt.subject, got, tt.want)
			}
			for i := range tt.want {
				if got[i] != tt.want[i] {
					t.Errorf("%s: recipient %d = %q, want %q", tt.subject, i, got[i], tt.want[i])
				}
			}
		})
	}
}

// The respondent could not be told and the admin queue could not be read: the
// first failure is the one reported, and neither cancels the other.
func TestHandleDisputeCreated_KeepsTheFirstFailureWhenAdminsAlsoFail(t *testing.T) {
	var got []string
	q := partyQuerier{adminErr: errors.New("db down")}
	c, _, _ := newTestConsumer(failingStore(&got, ""), q, nil)

	err := c.processEvent(context.Background(), NATSEvent{
		Type: "dispute.created",
		Data: json.RawMessage(`{"disputeId":"d-1","projectId":"p-1","againstUserId":"talent-1"}`),
	})

	if err == nil {
		t.Fatal("expected an error")
	}
	if !strings.Contains(err.Error(), "insert failed") {
		t.Errorf("error = %v, want the respondent failure to be the one reported", err)
	}
}

// The talent was told they are late; the owner lookup then failed.
func TestHandleMilestoneOverdue_ReportsAnOwnerLookupFailure(t *testing.T) {
	var got []string
	q := partyQuerier{ownerErr: errors.New("db down")}
	c, _, _ := newTestConsumer(failingStore(&got, "nobody"), q, nil)

	err := c.processEvent(context.Background(), NATSEvent{
		Type: "milestone.overdue",
		Data: json.RawMessage(`{"milestoneId":"m-1","projectId":"p-1","talentId":"talent-1"}`),
	})

	if err == nil {
		t.Error("expected the owner lookup failure to be reported")
	}
	if len(got) != 1 || got[0] != "talent-1" {
		t.Errorf("notified %v, want [talent-1]", got)
	}
}
