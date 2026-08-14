package consumer

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"testing"

	"github.com/bytz/notification-service/internal/store"
	"github.com/jackc/pgx/v5"
)

// scriptedQuerier dispatches on the SQL rather than on call order, because a
// single handler interleaves profile lookups with email lookups; a positional
// script silently hands the email address to the next talent.
//
// profiles is a queue so a loop over several talents can be given a different
// outcome per iteration.
type scriptedQuerier struct {
	mu       sync.Mutex
	profiles []fakeRow
	fallbck  fakeRow
	queries  []string
}

func (q *scriptedQuerier) QueryRow(_ context.Context, sql string, _ ...any) pgx.Row {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.queries = append(q.queries, sql)
	if strings.Contains(sql, "talent_profiles") && len(q.profiles) > 0 {
		row := q.profiles[0]
		q.profiles = q.profiles[1:]
		return row
	}
	return q.fallbck
}

func (q *scriptedQuerier) queryCount() int {
	q.mu.Lock()
	defer q.mu.Unlock()
	return len(q.queries)
}

// captureLogs swaps the default slog handler for the duration of a test.
// Not parallel-safe: slog.SetDefault is process global.
func captureLogs(t *testing.T) *bytes.Buffer {
	t.Helper()
	buf := &bytes.Buffer{}
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(buf, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(prev) })
	return buf
}

// Every routed subject must reach a handler. An unrouted one has to be audible
// rather than acked into silence.
func TestProcessEvent_RoutesEverySupportedSubject(t *testing.T) {
	// Two payload conventions share the field name talentId. milestone.* carries
	// a user id (project-service resolves it before publishing), payment.released
	// and application.* carry a talent_profiles id the consumer must resolve.
	// The querier below answers talent_profiles lookups with a distinct id, so a
	// handler that forwarded the raw payload value would fail here.
	resolving := func() Querier {
		return &scriptedQuerier{
			profiles: []fakeRow{{value: "resolved-user"}},
			fallbck:  fakeRow{value: "owner-1"},
		}
	}

	tests := []struct {
		subject string
		data    string
		// wantRecipient is the user id the notification must be addressed to.
		wantRecipient string
		querier       func() Querier
	}{
		{
			subject:       "notification.send",
			data:          `{"userId":"u-direct","type":"system","title":"t","message":"m","channels":["in_app"]}`,
			wantRecipient: "u-direct",
		},
		{
			subject:       "project.status.changed",
			data:          `{"projectId":"p-1","toStatus":"in_progress","changedBy":"someone-else"}`,
			wantRecipient: "owner-1",
		},
		{
			subject:       "project.completed",
			data:          `{"projectId":"p-1","ownerId":"owner-1"}`,
			wantRecipient: "owner-1",
		},
		{
			subject:       "project.team.complete",
			data:          `{"projectId":"p-1"}`,
			wantRecipient: "owner-1",
		},
		{
			subject:       "talent.assignment.declined",
			data:          `{"projectId":"p-1"}`,
			wantRecipient: "owner-1",
		},
		{
			subject:       "payment.released",
			data:          `{"projectId":"p-1","milestoneId":"m-1","talentId":"tp-1","amount":500000}`,
			wantRecipient: "resolved-user",
			querier:       resolving,
		},
		{
			subject:       "milestone.submitted",
			data:          `{"milestoneId":"m-1","projectId":"p-1","talentId":"u-talent"}`,
			wantRecipient: "owner-1",
		},
		{
			subject:       "milestone.approved",
			data:          `{"milestoneId":"m-1","projectId":"p-1","talentId":"u-talent","amount":1000}`,
			wantRecipient: "u-talent",
		},
		{
			subject:       "milestone.auto_released",
			data:          `{"milestoneId":"m-1","projectId":"p-1","talentId":"u-talent","amount":1000}`,
			wantRecipient: "u-talent",
		},
		{
			subject:       "milestone.rejected",
			data:          `{"milestoneId":"m-1","projectId":"p-1","talentId":"u-talent"}`,
			wantRecipient: "u-talent",
		},
		{
			subject:       "milestone.revision_requested",
			data:          `{"milestoneId":"m-1","projectId":"p-1","talentId":"u-talent"}`,
			wantRecipient: "u-talent",
		},
		{
			subject:       "milestone.overdue",
			data:          `{"milestoneId":"m-1","projectId":"p-1","talentId":"u-talent"}`,
			wantRecipient: "u-talent",
		},
		{
			subject:       "milestone.due_soon",
			data:          `{"milestoneId":"m-1","projectId":"p-1","talentId":"u-talent"}`,
			wantRecipient: "u-talent",
		},
		{
			subject:       "application.status.accepted",
			data:          `{"projectId":"p-1","talentId":"tp-1"}`,
			wantRecipient: "resolved-user",
			querier:       resolving,
		},
		{
			subject:       "application.status.rejected",
			data:          `{"projectId":"p-1","talentId":"tp-1"}`,
			wantRecipient: "resolved-user",
			querier:       resolving,
		},
	}

	for _, tt := range tests {
		t.Run(tt.subject, func(t *testing.T) {
			st := &countingStore{}
			var q Querier = fakeQuerier{ownerID: "owner-1"}
			if tt.querier != nil {
				q = tt.querier()
			}
			c, _, _ := newTestConsumer(st, q, nil)

			err := c.processEvent(context.Background(), NATSEvent{
				Type: tt.subject,
				Data: json.RawMessage(tt.data),
			})
			if err != nil {
				t.Fatalf("processEvent(%s) error = %v", tt.subject, err)
			}

			st.mu.Lock()
			defer st.mu.Unlock()
			if len(st.created) != 1 {
				t.Fatalf("notifications created = %d, want 1 (%s produced none)", len(st.created), tt.subject)
			}
			if st.created[0].UserID != tt.wantRecipient {
				t.Errorf("recipient = %q, want %q", st.created[0].UserID, tt.wantRecipient)
			}
		})
	}
}

// chat.message.sent publishes to a channel and creates no notification row.
func TestProcessEvent_ChatMessageSentPublishesOnly(t *testing.T) {
	st := &countingStore{}
	c, _, channels := newTestConsumer(st, fakeQuerier{ownerID: "owner-1"}, nil)

	err := c.processEvent(context.Background(), NATSEvent{
		Type: "chat.message.sent",
		Data: json.RawMessage(`{"messageId":"msg-1","conversationId":"conv-1","senderId":"u-1","senderType":"user"}`),
	})
	if err != nil {
		t.Fatalf("processEvent error = %v", err)
	}

	if got := st.createCount(); got != 0 {
		t.Errorf("notifications created = %d, want 0 (chat delivery is the UI subscription's job)", got)
	}
	got := channels.publishedChannels()
	if len(got) != 1 || got[0] != "chat:conv-1" {
		t.Errorf("channels = %v, want [chat:conv-1]", got)
	}
}

// An empty conversation id has no channel to publish to.
func TestHandleChatMessageSent_EmptyConversationPublishesNothing(t *testing.T) {
	c, _, channels := newTestConsumer(&countingStore{}, fakeQuerier{}, nil)

	err := c.handleChatMessageSent(context.Background(), NATSEvent{
		Data: json.RawMessage(`{"messageId":"msg-1","conversationId":""}`),
	})
	if err != nil {
		t.Fatalf("error = %v", err)
	}
	if got := channels.publishedChannels(); len(got) != 0 {
		t.Errorf("channels = %v, want none", got)
	}
}

// An unrouted subject must warn. The default branch acks and drops, so a silent
// Debug line would make a missing handler undiscoverable in production.
func TestProcessEvent_UnhandledSubjectIsLoggedAtWarn(t *testing.T) {
	logs := captureLogs(t)
	st := &countingStore{}
	c, _, _ := newTestConsumer(st, fakeQuerier{ownerID: "owner-1"}, nil)

	err := c.processEvent(context.Background(), NATSEvent{
		ID:   "evt-x",
		Type: "dispute.created",
		Data: json.RawMessage(`{}`),
	})
	if err != nil {
		t.Fatalf("processEvent error = %v, want nil (an unknown subject must not nak)", err)
	}
	if got := st.createCount(); got != 0 {
		t.Errorf("notifications created = %d, want 0", got)
	}

	out := logs.String()
	if !strings.Contains(out, "level=WARN") {
		t.Errorf("log level is not WARN; an unhandled subject would be invisible at the service's Info level.\ngot: %s", out)
	}
	if !strings.Contains(out, "unhandled event type") || !strings.Contains(out, "dispute.created") {
		t.Errorf("log does not name the dropped subject.\ngot: %s", out)
	}
}

// Malformed payloads must fail loudly per handler so the message is retried.
func TestHandlers_MalformedPayloadReturnsError(t *testing.T) {
	subjects := []string{
		"notification.send",
		"project.status.changed",
		"project.completed",
		"project.team.forming",
		"project.team.complete",
		"talent.assignment.declined",
		"payment.released",
		"milestone.submitted",
		"milestone.approved",
		"milestone.auto_released",
		"milestone.rejected",
		"milestone.revision_requested",
		"milestone.overdue",
		"milestone.due_soon",
		"chat.message.sent",
		"application.status.accepted",
		"application.status.rejected",
	}

	for _, subject := range subjects {
		t.Run(subject, func(t *testing.T) {
			c, _, _ := newTestConsumer(&countingStore{}, fakeQuerier{ownerID: "owner-1"}, nil)
			err := c.processEvent(context.Background(), NATSEvent{
				Type: subject,
				Data: json.RawMessage(`"a string, not an object"`),
			})
			if err == nil {
				t.Errorf("processEvent(%s) with a malformed payload returned nil; the event would be acked and lost", subject)
			}
		})
	}
}

// Team forming notifies each offered talent, resolving profile id to user id.
func TestHandleTeamForming_NotifiesEachOfferedTalent(t *testing.T) {
	st := &countingStore{}
	q := &scriptedQuerier{profiles: []fakeRow{
		{value: "user-a"},
		{value: "user-b"},
	}}
	c, _, _ := newTestConsumer(st, q, nil)

	err := c.handleTeamForming(context.Background(), NATSEvent{
		Data: json.RawMessage(`{"projectId":"p-1","assignments":[
			{"workPackageId":"wp-1","talentId":"tp-a"},
			{"workPackageId":"wp-2","talentId":"tp-b"}]}`),
	})
	if err != nil {
		t.Fatalf("error = %v", err)
	}

	st.mu.Lock()
	defer st.mu.Unlock()
	if len(st.created) != 2 {
		t.Fatalf("notifications created = %d, want 2 (one per offered talent)", len(st.created))
	}
	got := []string{st.created[0].UserID, st.created[1].UserID}
	if got[0] != "user-a" || got[1] != "user-b" {
		t.Errorf("recipients = %v, want [user-a user-b] (profile ids must be resolved to user ids)", got)
	}
	if st.created[0].Type != store.TypeAssignmentOffer {
		t.Errorf("type = %q, want %q", st.created[0].Type, store.TypeAssignmentOffer)
	}
}

// One unresolvable talent must not silence the rest of the team.
func TestHandleTeamForming_SkipsUnresolvableTalent(t *testing.T) {
	st := &countingStore{}
	q := &scriptedQuerier{profiles: []fakeRow{
		{err: pgx.ErrNoRows},
		{value: "user-b"},
	}}
	c, _, _ := newTestConsumer(st, q, nil)

	if err := c.handleTeamForming(context.Background(), NATSEvent{
		Data: json.RawMessage(`{"projectId":"p-1","assignments":[
			{"workPackageId":"wp-1","talentId":"tp-missing"},
			{"workPackageId":"wp-2","talentId":"tp-b"}]}`),
	}); err != nil {
		t.Fatalf("error = %v", err)
	}

	st.mu.Lock()
	defer st.mu.Unlock()
	if len(st.created) != 1 {
		t.Fatalf("notifications created = %d, want 1", len(st.created))
	}
	if st.created[0].UserID != "user-b" {
		t.Errorf("recipient = %q, want user-b", st.created[0].UserID)
	}
}

// A store failure mid-loop aborts so the whole event is retried.
func TestHandleTeamForming_StoreFailureAborts(t *testing.T) {
	st := &countingStore{createErr: errors.New("insert failed")}
	q := &scriptedQuerier{profiles: []fakeRow{{value: "user-a"}, {value: "user-b"}}}
	c, _, _ := newTestConsumer(st, q, nil)

	err := c.handleTeamForming(context.Background(), NATSEvent{
		Data: json.RawMessage(`{"projectId":"p-1","assignments":[
			{"workPackageId":"wp-1","talentId":"tp-a"},
			{"workPackageId":"wp-2","talentId":"tp-b"}]}`),
	})
	if err == nil {
		t.Fatal("expected an error so the event is redelivered")
	}
	if got := st.createCount(); got != 1 {
		t.Errorf("create attempts = %d, want 1 (the loop must stop at the first failure)", got)
	}
}

// An unknown talent profile is skipped, not retried forever.
func TestHandlePaymentReleased_UnknownProfileSkips(t *testing.T) {
	tests := []struct {
		name string
		row  fakeRow
	}{
		{"no such profile", fakeRow{err: pgx.ErrNoRows}},
		{"profile with empty user id", fakeRow{value: ""}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			st := &countingStore{}
			c, _, _ := newTestConsumer(st, &scriptedQuerier{fallbck: tt.row}, nil)

			err := c.handlePaymentReleased(context.Background(), NATSEvent{
				Data: json.RawMessage(`{"projectId":"p-1","milestoneId":"m-1","talentId":"tp-gone","amount":1000}`),
			})
			if err != nil {
				t.Errorf("error = %v, want nil (an unresolvable talent must not nak forever)", err)
			}
			if got := st.createCount(); got != 0 {
				t.Errorf("notifications created = %d, want 0", got)
			}
		})
	}
}

// A real lookup failure must nak, unlike a missing row.
func TestHandlePaymentReleased_LookupErrorReturnsError(t *testing.T) {
	c, _, _ := newTestConsumer(&countingStore{}, &scriptedQuerier{
		fallbck: fakeRow{err: errors.New("connection reset")},
	}, nil)

	err := c.handlePaymentReleased(context.Background(), NATSEvent{
		Data: json.RawMessage(`{"projectId":"p-1","talentId":"tp-1","amount":1000}`),
	})
	if err == nil {
		t.Fatal("expected an error so a transient DB fault is retried")
	}
	if errors.Is(err, pgx.ErrNoRows) {
		t.Error("a transient fault must not be reported as a missing row")
	}
}

// The accepted and rejected branches must address the applicant, not the owner,
// and must say different things.
func TestHandleApplicationDecision_TellsTheApplicant(t *testing.T) {
	tests := []struct {
		name     string
		accepted bool
	}{
		{"accepted", true},
		{"rejected", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			st := &countingStore{}
			c, _, _ := newTestConsumer(st, &scriptedQuerier{fallbck: fakeRow{value: "applicant-1"}}, nil)

			if err := c.handleApplicationDecision(context.Background(), NATSEvent{
				Data: json.RawMessage(`{"projectId":"p-1","talentId":"tp-1"}`),
			}, tt.accepted); err != nil {
				t.Fatalf("error = %v", err)
			}

			st.mu.Lock()
			defer st.mu.Unlock()
			if len(st.created) != 1 {
				t.Fatalf("notifications created = %d, want 1", len(st.created))
			}
			if st.created[0].UserID != "applicant-1" {
				t.Errorf("recipient = %q, want applicant-1 (the applicant is told, not the owner)", st.created[0].UserID)
			}
			// The two branches must not be interchangeable.
			gotAccepted := strings.Contains(strings.ToLower(st.created[0].Title), "accepted")
			if gotAccepted != tt.accepted {
				t.Errorf("title %q does not match accepted=%v", st.created[0].Title, tt.accepted)
			}
		})
	}
}

func TestHandleApplicationDecision_UnknownProfileSkips(t *testing.T) {
	st := &countingStore{}
	c, _, _ := newTestConsumer(st, &scriptedQuerier{fallbck: fakeRow{err: pgx.ErrNoRows}}, nil)

	if err := c.handleApplicationDecision(context.Background(), NATSEvent{
		Data: json.RawMessage(`{"projectId":"p-1","talentId":"tp-gone"}`),
	}, true); err != nil {
		t.Errorf("error = %v, want nil", err)
	}
	if got := st.createCount(); got != 0 {
		t.Errorf("notifications created = %d, want 0", got)
	}
}

func TestHandleApplicationDecision_LookupErrorReturnsError(t *testing.T) {
	c, _, _ := newTestConsumer(&countingStore{}, &scriptedQuerier{
		fallbck: fakeRow{err: errors.New("connection reset")},
	}, nil)

	if err := c.handleApplicationDecision(context.Background(), NATSEvent{
		Data: json.RawMessage(`{"projectId":"p-1","talentId":"tp-1"}`),
	}, false); err == nil {
		t.Fatal("expected an error so a transient DB fault is retried")
	}
}

// Auto-release with no assignee has nobody to pay or tell.
func TestHandleMilestoneAutoReleased_EmptyTalentCreatesNothing(t *testing.T) {
	st := &countingStore{}
	c, _, channels := newTestConsumer(st, fakeQuerier{}, nil)

	if err := c.handleMilestoneAutoReleased(context.Background(), NATSEvent{
		Data: json.RawMessage(`{"milestoneId":"m-1","projectId":"p-1","talentId":"","amount":1000}`),
	}); err != nil {
		t.Fatalf("error = %v", err)
	}
	if got := st.createCount(); got != 0 {
		t.Errorf("notifications created = %d, want 0", got)
	}
	// The live channel still updates, so the board reflects the release.
	if got := channels.publishedChannels(); len(got) != 1 || got[0] != "milestone:p-1" {
		t.Errorf("channels = %v, want [milestone:p-1]", got)
	}
}

// Owner lookup failures must nak rather than drop the notification.
func TestHandlers_OwnerLookupFailurePropagates(t *testing.T) {
	subjects := map[string]string{
		"project.status.changed":     `{"projectId":"p-1","toStatus":"review"}`,
		"project.team.complete":      `{"projectId":"p-1"}`,
		"talent.assignment.declined": `{"projectId":"p-1"}`,
		"milestone.submitted":        `{"milestoneId":"m-1","projectId":"p-1"}`,
	}

	for subject, data := range subjects {
		t.Run(subject, func(t *testing.T) {
			c, _, _ := newTestConsumer(&countingStore{}, fakeQuerier{err: errors.New("db down")}, nil)
			err := c.processEvent(context.Background(), NATSEvent{Type: subject, Data: json.RawMessage(data)})
			if err == nil {
				t.Errorf("processEvent(%s) returned nil on an owner lookup failure; the notification would be lost", subject)
			}
		})
	}
}

// project.status.changed with no project id skips the channel push but the
// owner lookup still runs, and its failure is what surfaces.
func TestHandleProjectStatusChanged_EmptyProjectSkipsChannel(t *testing.T) {
	c, _, channels := newTestConsumer(&countingStore{}, fakeQuerier{ownerID: "owner-1"}, nil)

	if err := c.handleProjectStatusChanged(context.Background(), NATSEvent{
		Data: json.RawMessage(`{"projectId":"","toStatus":"review"}`),
	}); err != nil {
		t.Fatalf("error = %v", err)
	}
	if got := channels.publishedChannels(); len(got) != 0 {
		t.Errorf("channels = %v, want none for an empty project id", got)
	}
}

// fromStatus is optional; a null must not crash the channel payload.
func TestHandleProjectStatusChanged_NullFromStatus(t *testing.T) {
	st := &countingStore{}
	c, _, channels := newTestConsumer(st, fakeQuerier{ownerID: "owner-1"}, nil)

	if err := c.handleProjectStatusChanged(context.Background(), NATSEvent{
		Data: json.RawMessage(`{"projectId":"p-1","fromStatus":null,"toStatus":"review"}`),
	}); err != nil {
		t.Fatalf("error = %v", err)
	}
	if got := channels.publishedChannels(); len(got) != 1 || got[0] != "project:p-1" {
		t.Errorf("channels = %v, want [project:p-1]", got)
	}
	if got := st.createCount(); got != 1 {
		t.Errorf("notifications created = %d, want 1", got)
	}
}

// A Centrifugo outage must not abort event processing.
func TestPublishChannelUpdate_FailureIsBestEffort(t *testing.T) {
	st := &countingStore{}
	c, _, channels := newTestConsumer(st, fakeQuerier{ownerID: "owner-1"}, nil)
	channels.publishErr = errors.New("centrifugo down")

	if err := c.handleProjectCompleted(context.Background(), NATSEvent{
		Data: json.RawMessage(`{"projectId":"p-1","ownerId":"owner-1"}`),
	}); err != nil {
		t.Fatalf("error = %v, want nil (a real-time push failure must not block the notification)", err)
	}
	if got := st.createCount(); got != 1 {
		t.Errorf("notifications created = %d, want 1", got)
	}
}

func TestPublishMilestoneUpdate_EmptyProjectSkips(t *testing.T) {
	c, _, channels := newTestConsumer(&countingStore{}, fakeQuerier{}, nil)
	c.publishMilestoneUpdate(context.Background(), "", "m-1", "milestone.approved")
	if got := channels.publishedChannels(); len(got) != 0 {
		t.Errorf("channels = %v, want none", got)
	}
}

func TestCreateAndDeliver_EmptyUserIDCreatesNothing(t *testing.T) {
	st := &countingStore{}
	c, email, channels := newTestConsumer(st, fakeQuerier{}, nil)

	err := c.createAndDeliver(context.Background(), "", store.TypeSystem, "t", "m", nil, []string{"in_app", "email"})
	if err != nil {
		t.Fatalf("error = %v, want nil", err)
	}
	if got := st.createCount(); got != 0 {
		t.Errorf("notifications created = %d, want 0 (an empty user id would violate the FK)", got)
	}
	if got := email.count(); got != 0 {
		t.Errorf("emails sent = %d, want 0", got)
	}
	if got := len(channels.publishedChannels()); got != 0 {
		t.Errorf("channel publishes = %d, want 0", got)
	}
}

func TestCreateAndDeliver_StoreFailurePropagates(t *testing.T) {
	sentinel := errors.New("unique violation")
	st := &countingStore{createErr: sentinel}
	c, email, _ := newTestConsumer(st, fakeQuerier{}, nil)

	err := c.createAndDeliver(context.Background(), "u-1", store.TypeSystem, "t", "m", nil, []string{"email"})
	if err == nil {
		t.Fatal("expected an error so the event is redelivered")
	}
	if !errors.Is(err, sentinel) {
		t.Errorf("error = %v, want it to wrap the store error", err)
	}
	if got := email.count(); got != 0 {
		t.Errorf("emails sent = %d, want 0 (nothing may be delivered for a row that does not exist)", got)
	}
}

// The email channel resolves the address and sends to it.
func TestCreateAndDeliver_EmailChannelSendsToResolvedAddress(t *testing.T) {
	st := &countingStore{}
	q := &scriptedQuerier{fallbck: fakeRow{value: "talent@example.com"}}
	c, email, _ := newTestConsumer(st, q, nil)

	err := c.createAndDeliver(context.Background(), "u-1", store.TypePayment,
		"Payment released", "Rp 500.000 released", nil, []string{"in_app", "email"})
	if err != nil {
		t.Fatalf("error = %v", err)
	}

	email.mu.Lock()
	defer email.mu.Unlock()
	if len(email.sent) != 1 {
		t.Fatalf("emails sent = %d, want 1", len(email.sent))
	}
	if email.sent[0].To != "talent@example.com" {
		t.Errorf("To = %q, want talent@example.com", email.sent[0].To)
	}
	if email.sent[0].Subject != "Payment released" {
		t.Errorf("Subject = %q, want the notification title", email.sent[0].Subject)
	}
}

// An in_app-only notification must not email.
func TestCreateAndDeliver_InAppOnlyDoesNotEmail(t *testing.T) {
	st := &countingStore{}
	q := &scriptedQuerier{fallbck: fakeRow{value: "someone@example.com"}}
	c, email, channels := newTestConsumer(st, q, nil)

	if err := c.createAndDeliver(context.Background(), "u-1", store.TypeSystem,
		"t", "m", nil, []string{"in_app"}); err != nil {
		t.Fatalf("error = %v", err)
	}
	if got := email.count(); got != 0 {
		t.Errorf("emails sent = %d, want 0 for an in_app-only notification", got)
	}
	channels.mu.Lock()
	users := len(channels.users)
	channels.mu.Unlock()
	if users != 1 {
		t.Errorf("user pushes = %d, want 1", users)
	}
}

// Email content is escaped, so a title carrying markup cannot inject HTML.
func TestCreateAndDeliver_EscapesEmailContent(t *testing.T) {
	st := &countingStore{}
	q := &scriptedQuerier{fallbck: fakeRow{value: "u@example.com"}}
	c, email, _ := newTestConsumer(st, q, nil)

	if err := c.createAndDeliver(context.Background(), "u-1", store.TypeSystem,
		`<script>alert(1)</script>`, `a & b`, nil, []string{"email"}); err != nil {
		t.Fatalf("error = %v", err)
	}

	email.mu.Lock()
	defer email.mu.Unlock()
	body := email.sent[0].HTML
	if strings.Contains(body, "<script>") {
		t.Errorf("email body contains an unescaped script tag: %s", body)
	}
	if !strings.Contains(body, "&lt;script&gt;") {
		t.Errorf("title was not escaped: %s", body)
	}
	if !strings.Contains(body, "a &amp; b") {
		t.Errorf("message was not escaped: %s", body)
	}
}

// A failed address lookup must skip the send rather than email nobody.
func TestCreateAndDeliver_EmailLookupFailureSkipsSend(t *testing.T) {
	st := &countingStore{}
	q := &scriptedQuerier{fallbck: fakeRow{err: errors.New("no such user")}}
	c, email, _ := newTestConsumer(st, q, nil)

	err := c.createAndDeliver(context.Background(), "u-1", store.TypeSystem, "t", "m", nil, []string{"email"})
	if err != nil {
		t.Fatalf("error = %v, want nil (the in-app row still landed)", err)
	}
	if got := email.count(); got != 0 {
		t.Errorf("emails sent = %d, want 0 (no address was resolved)", got)
	}
	if got := st.createCount(); got != 1 {
		t.Errorf("notifications created = %d, want 1", got)
	}
}

// An upstream email failure is logged, and the notification row survives.
// The event must not be redelivered, or the in-app row would be duplicated.
func TestCreateAndDeliver_EmailSendFailureIsLoggedNotFatal(t *testing.T) {
	logs := captureLogs(t)
	st := &countingStore{}
	q := &scriptedQuerier{fallbck: fakeRow{value: "u@example.com"}}
	c, email, _ := newTestConsumer(st, q, nil)
	email.err = errors.New("resend API error (status 429)")

	err := c.createAndDeliver(context.Background(), "u-1", store.TypeSystem, "t", "m", nil, []string{"email"})
	if err != nil {
		t.Fatalf("error = %v, want nil (redelivering would duplicate the in-app row)", err)
	}
	if got := st.createCount(); got != 1 {
		t.Errorf("notifications created = %d, want 1", got)
	}
	out := logs.String()
	if !strings.Contains(out, "email send failed") {
		t.Errorf("a failed email left no ERROR log; the failure would be invisible.\ngot: %s", out)
	}
	if !strings.Contains(out, "level=ERROR") {
		t.Errorf("email failure not logged at ERROR.\ngot: %s", out)
	}
}

// A Centrifugo push failure must not fail the event either.
func TestCreateAndDeliver_UserPushFailureIsBestEffort(t *testing.T) {
	st := &countingStore{}
	c, _, channels := newTestConsumer(st, fakeQuerier{}, nil)
	channels.userErr = errors.New("centrifugo down")

	if err := c.createAndDeliver(context.Background(), "u-1", store.TypeSystem,
		"t", "m", nil, []string{"in_app"}); err != nil {
		t.Fatalf("error = %v, want nil", err)
	}
	if got := st.createCount(); got != 1 {
		t.Errorf("notifications created = %d, want 1", got)
	}
}

// An unrecognised channel must be audible rather than silently ignored.
func TestCreateAndDeliver_UnknownChannelWarns(t *testing.T) {
	logs := captureLogs(t)
	c, email, _ := newTestConsumer(&countingStore{}, fakeQuerier{}, nil)

	if err := c.createAndDeliver(context.Background(), "u-1", store.TypeSystem,
		"t", "m", nil, []string{"sms"}); err != nil {
		t.Fatalf("error = %v", err)
	}
	if got := email.count(); got != 0 {
		t.Errorf("emails sent = %d, want 0", got)
	}
	out := logs.String()
	if !strings.Contains(out, "unknown delivery channel") || !strings.Contains(out, "sms") {
		t.Errorf("an unroutable channel left no warning.\ngot: %s", out)
	}
}

func TestResolveUserEmail(t *testing.T) {
	t.Run("resolves", func(t *testing.T) {
		c, _, _ := newTestConsumer(&countingStore{}, &scriptedQuerier{
			fallbck: fakeRow{value: "found@example.com"},
		}, nil)
		got, err := c.resolveUserEmail(context.Background(), "u-1")
		if err != nil {
			t.Fatalf("error = %v", err)
		}
		if got != "found@example.com" {
			t.Errorf("email = %q, want found@example.com", got)
		}
	})

	t.Run("wraps the lookup failure", func(t *testing.T) {
		sentinel := errors.New("connection reset")
		c, _, _ := newTestConsumer(&countingStore{}, &scriptedQuerier{
			fallbck: fakeRow{err: sentinel},
		}, nil)
		_, err := c.resolveUserEmail(context.Background(), "u-1")
		if !errors.Is(err, sentinel) {
			t.Errorf("error = %v, want it to wrap %v", err, sentinel)
		}
	})
}

func TestGetProjectOwnerID(t *testing.T) {
	t.Run("resolves", func(t *testing.T) {
		q := &scriptedQuerier{fallbck: fakeRow{value: "owner-7"}}
		c, _, _ := newTestConsumer(&countingStore{}, q, nil)
		got, err := c.getProjectOwnerID(context.Background(), "p-1")
		if err != nil {
			t.Fatalf("error = %v", err)
		}
		if got != "owner-7" {
			t.Errorf("ownerID = %q, want owner-7", got)
		}
		if q.queryCount() != 1 {
			t.Errorf("queries = %d, want 1", q.queryCount())
		}
	})

	t.Run("wraps the lookup failure", func(t *testing.T) {
		sentinel := errors.New("db down")
		c, _, _ := newTestConsumer(&countingStore{}, &scriptedQuerier{fallbck: fakeRow{err: sentinel}}, nil)
		_, err := c.getProjectOwnerID(context.Background(), "p-1")
		if !errors.Is(err, sentinel) {
			t.Errorf("error = %v, want it to wrap %v", err, sentinel)
		}
	})
}

// notification.send carries its own link; an empty one must stay null.
func TestHandleNotificationSend_LinkHandling(t *testing.T) {
	tests := []struct {
		name     string
		link     string
		wantNil  bool
		wantLink string
	}{
		{"with link", "/projects/p-1", false, "/projects/p-1"},
		{"empty link", "", true, ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			st := &countingStore{}
			c, _, _ := newTestConsumer(st, fakeQuerier{}, nil)

			payload := fmt.Sprintf(
				`{"userId":"u-1","type":"system","title":"t","message":"m","link":%q,"channels":["in_app"]}`, tt.link)
			if err := c.handleNotificationSend(context.Background(), NATSEvent{
				Data: json.RawMessage(payload),
			}); err != nil {
				t.Fatalf("error = %v", err)
			}

			st.mu.Lock()
			defer st.mu.Unlock()
			got := st.created[0].Link
			if tt.wantNil {
				if got != nil {
					t.Errorf("Link = %v, want nil", *got)
				}
				return
			}
			if got == nil || *got != tt.wantLink {
				t.Errorf("Link = %v, want %q", got, tt.wantLink)
			}
		})
	}
}
