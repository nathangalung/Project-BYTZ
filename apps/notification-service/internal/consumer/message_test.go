package consumer

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/bytz/notification-service/internal/idempotency"
	"github.com/bytz/notification-service/internal/sender"
	"github.com/bytz/notification-service/internal/store"
	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
)

// fakeMsg implements jetstream.Msg and records which ack verb was used.
type fakeMsg struct {
	data         []byte
	subject      string
	headers      nats.Header
	numDelivered uint64
	metaErr      error
	ackErr       error

	mu      sync.Mutex
	acked   int
	naked   int
	termed  int
	inProg  int
	dblAckd int
}

func (m *fakeMsg) Metadata() (*jetstream.MsgMetadata, error) {
	if m.metaErr != nil {
		return nil, m.metaErr
	}
	return &jetstream.MsgMetadata{NumDelivered: m.numDelivered}, nil
}

func (m *fakeMsg) Data() []byte                     { return m.data }
func (m *fakeMsg) Headers() nats.Header             { return m.headers }
func (m *fakeMsg) Subject() string                  { return m.subject }
func (m *fakeMsg) Reply() string                    { return "" }
func (m *fakeMsg) NakWithDelay(time.Duration) error { return nil }
func (m *fakeMsg) Term() error                      { m.bump(&m.termed); return nil }
func (m *fakeMsg) TermWithReason(string) error      { m.bump(&m.termed); return nil }
func (m *fakeMsg) InProgress() error                { m.bump(&m.inProg); return nil }
func (m *fakeMsg) DoubleAck(context.Context) error {
	m.bump(&m.dblAckd)
	return nil
}

func (m *fakeMsg) Ack() error {
	m.bump(&m.acked)
	return m.ackErr
}

func (m *fakeMsg) Nak() error {
	m.bump(&m.naked)
	return nil
}

func (m *fakeMsg) bump(counter *int) {
	m.mu.Lock()
	defer m.mu.Unlock()
	*counter++
}

func (m *fakeMsg) counts() (acks, naks int) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.acked, m.naked
}

// stubIdem drives the claim/release outcomes handleMessage branches on.
type stubIdem struct {
	acquired   bool
	claimErr   error
	releaseErr error

	mu       sync.Mutex
	claims   []string
	releases []string
}

func (s *stubIdem) Claim(_ context.Context, id string) (bool, error) {
	s.mu.Lock()
	s.claims = append(s.claims, id)
	s.mu.Unlock()
	if s.claimErr != nil {
		return false, s.claimErr
	}
	return s.acquired, nil
}

func (s *stubIdem) Release(_ context.Context, id string) error {
	s.mu.Lock()
	s.releases = append(s.releases, id)
	s.mu.Unlock()
	return s.releaseErr
}

func (s *stubIdem) releaseCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.releases)
}

var _ idempotency.Idempotency = (*stubIdem)(nil)

// recordingEmail counts sends and can fail on demand.
type recordingEmail struct {
	err  error
	mu   sync.Mutex
	sent []sender.SendEmailInput
}

func (e *recordingEmail) Send(_ context.Context, in sender.SendEmailInput) error {
	e.mu.Lock()
	e.sent = append(e.sent, in)
	e.mu.Unlock()
	return e.err
}

func (e *recordingEmail) count() int {
	e.mu.Lock()
	defer e.mu.Unlock()
	return len(e.sent)
}

// recordingChannels captures Centrifugo fan-out.
type recordingChannels struct {
	publishErr error
	userErr    error

	mu       sync.Mutex
	channels []string
	users    []string
}

func (p *recordingChannels) Publish(_ context.Context, channel string, _ interface{}) error {
	p.mu.Lock()
	p.channels = append(p.channels, channel)
	p.mu.Unlock()
	return p.publishErr
}

func (p *recordingChannels) PublishUserNotification(_ context.Context, userID string, _ interface{}) error {
	p.mu.Lock()
	p.users = append(p.users, userID)
	p.mu.Unlock()
	return p.userErr
}

func (p *recordingChannels) publishedChannels() []string {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]string(nil), p.channels...)
}

// countingStore records every notification row created, plus dead letters.
type countingStore struct {
	createErr error

	mu          sync.Mutex
	created     []store.CreateInput
	deadLetters []store.DeadLetterInput
}

func (s *countingStore) Create(_ context.Context, in store.CreateInput) (*store.Notification, error) {
	s.mu.Lock()
	s.created = append(s.created, in)
	s.mu.Unlock()
	if s.createErr != nil {
		return nil, s.createErr
	}
	return &store.Notification{ID: "n-1", UserID: in.UserID}, nil
}

func (s *countingStore) RecordDeadLetter(_ context.Context, in store.DeadLetterInput) error {
	s.mu.Lock()
	s.deadLetters = append(s.deadLetters, in)
	s.mu.Unlock()
	return nil
}

func (s *countingStore) FindByUserID(context.Context, string, int, int, []string) (*store.PaginatedResult, error) {
	return nil, nil
}
func (s *countingStore) FindByID(context.Context, string, string) (*store.Notification, error) {
	return nil, nil
}
func (s *countingStore) MarkAsRead(context.Context, string) (*store.Notification, error) {
	return nil, nil
}
func (s *countingStore) MarkAllAsRead(context.Context, string) (int, error) { return 0, nil }
func (s *countingStore) CountUnread(context.Context, string) (int, error)   { return 0, nil }

func (s *countingStore) createCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.created)
}

func (s *countingStore) deadLetterCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.deadLetters)
}

var _ store.StoreInterface = (*countingStore)(nil)

// newTestConsumer wires a consumer whose every collaborator is observable.
func newTestConsumer(st store.StoreInterface, q Querier, idem idempotency.Idempotency) (*Consumer, *recordingEmail, *recordingChannels) {
	email := &recordingEmail{}
	channels := &recordingChannels{}
	if idem == nil {
		idem = idempotency.NoOp{}
	}
	return &Consumer{
		store:      st,
		db:         q,
		email:      email,
		centrifugo: channels,
		idem:       idem,
	}, email, channels
}

// A duplicate delivery must be acked and must not produce a second notification.
// This is the property that stops a redelivery re-emailing everyone.
func TestHandleMessage_DuplicateIsAckedAndNotReprocessed(t *testing.T) {
	st := &countingStore{}
	idem := &stubIdem{acquired: false}
	c, email, _ := newTestConsumer(st, fakeQuerier{ownerID: "owner-1"}, idem)

	msg := &fakeMsg{
		subject: "project.completed",
		data:    mustEvent(t, "evt-dup", "project.completed", `{"projectId":"p-1","ownerId":"owner-1"}`),
	}

	c.handleMessage(context.Background(), msg)

	acks, naks := msg.counts()
	if acks != 1 {
		t.Errorf("acks = %d, want 1 (a duplicate must be acked, not redelivered)", acks)
	}
	if naks != 0 {
		t.Errorf("naks = %d, want 0", naks)
	}
	if got := st.createCount(); got != 0 {
		t.Errorf("notifications created = %d, want 0 (redelivery must not notify twice)", got)
	}
	if got := email.count(); got != 0 {
		t.Errorf("emails sent = %d, want 0 (redelivery must not email twice)", got)
	}
}

// A first delivery that fails is naked for retry, releases its claim, and is
// not dead-lettered while JetStream still has redeliveries left.
func TestHandleMessage_NonFinalFailureNaksAndReleases(t *testing.T) {
	st := &countingStore{createErr: errors.New("insert failed")}
	idem := &stubIdem{acquired: true}
	c, _, _ := newTestConsumer(st, fakeQuerier{ownerID: "owner-1"}, idem)

	msg := &fakeMsg{
		subject:      "project.completed",
		numDelivered: 1,
		data:         mustEvent(t, "evt-1", "project.completed", `{"projectId":"p-1","ownerId":"owner-1"}`),
	}

	c.handleMessage(context.Background(), msg)

	acks, naks := msg.counts()
	if naks != 1 {
		t.Errorf("naks = %d, want 1 (a retryable failure must ask for redelivery)", naks)
	}
	if acks != 0 {
		t.Errorf("acks = %d, want 0 (acking a failure drops the notification)", acks)
	}
	if got := idem.releaseCount(); got != 1 {
		t.Errorf("releases = %d, want 1 (holding the claim would mute the retry)", got)
	}
	if got := st.deadLetterCount(); got != 0 {
		t.Errorf("dead letters = %d, want 0 (retries remain)", got)
	}
}

// The last delivery parks the event with its true retry count, then acks so
// JetStream does not silently drop it.
func TestHandleMessage_FinalFailureParksAndAcks(t *testing.T) {
	st := &countingStore{createErr: errors.New("insert failed")}
	idem := &stubIdem{acquired: true}
	c, _, _ := newTestConsumer(st, fakeQuerier{ownerID: "owner-1"}, idem)

	msg := &fakeMsg{
		subject:      "project.completed",
		numDelivered: maxDeliver,
		data:         mustEvent(t, "evt-final", "project.completed", `{"projectId":"p-1","ownerId":"owner-1"}`),
	}

	c.handleMessage(context.Background(), msg)

	acks, naks := msg.counts()
	if acks != 1 {
		t.Errorf("acks = %d, want 1", acks)
	}
	if naks != 0 {
		t.Errorf("naks = %d, want 0 (the final delivery must not ask for another)", naks)
	}

	st.mu.Lock()
	defer st.mu.Unlock()
	if len(st.deadLetters) != 1 {
		t.Fatalf("dead letters = %d, want 1 (a dropped event must be recoverable)", len(st.deadLetters))
	}
	dl := st.deadLetters[0]
	if dl.OriginalEventID != "evt-final" {
		t.Errorf("OriginalEventID = %q, want evt-final", dl.OriginalEventID)
	}
	if dl.EventType != "project.completed" {
		t.Errorf("EventType = %q, want project.completed", dl.EventType)
	}
	if dl.RetryCount != maxDeliver {
		t.Errorf("RetryCount = %d, want %d", dl.RetryCount, maxDeliver)
	}
	if dl.ConsumerService != "notification-service" {
		t.Errorf("ConsumerService = %q, want notification-service", dl.ConsumerService)
	}
	if dl.ErrorMessage == "" {
		t.Error("ErrorMessage is empty; an admin cannot triage a dead letter without the cause")
	}
}

// Unknown delivery count parks rather than loses.
func TestHandleMessage_MetadataErrorParks(t *testing.T) {
	st := &countingStore{createErr: errors.New("insert failed")}
	c, _, _ := newTestConsumer(st, fakeQuerier{ownerID: "owner-1"}, &stubIdem{acquired: true})

	msg := &fakeMsg{
		subject: "project.completed",
		metaErr: errors.New("no metadata"),
		data:    mustEvent(t, "evt-nometa", "project.completed", `{"projectId":"p-1","ownerId":"owner-1"}`),
	}

	c.handleMessage(context.Background(), msg)

	if got := st.deadLetterCount(); got != 1 {
		t.Errorf("dead letters = %d, want 1 (unknown delivery count must park, not drop)", got)
	}
	st.mu.Lock()
	retry := st.deadLetters[0].RetryCount
	st.mu.Unlock()
	if retry != maxDeliver {
		t.Errorf("RetryCount = %d, want %d (fallback when metadata is unreadable)", retry, maxDeliver)
	}
}

// A failing idempotency backend must not stop notifications going out.
func TestHandleMessage_ClaimErrorFailsOpen(t *testing.T) {
	st := &countingStore{}
	idem := &stubIdem{claimErr: errors.New("redis down")}
	c, _, _ := newTestConsumer(st, fakeQuerier{ownerID: "owner-1"}, idem)

	msg := &fakeMsg{
		subject: "project.completed",
		data:    mustEvent(t, "evt-openclaim", "project.completed", `{"projectId":"p-1","ownerId":"owner-1"}`),
	}

	c.handleMessage(context.Background(), msg)

	if got := st.createCount(); got != 1 {
		t.Errorf("notifications created = %d, want 1 (a Redis outage must not mute notifications)", got)
	}
	acks, _ := msg.counts()
	if acks != 1 {
		t.Errorf("acks = %d, want 1", acks)
	}
	// Nothing was claimed, so nothing may be released.
	if got := idem.releaseCount(); got != 0 {
		t.Errorf("releases = %d, want 0 (never claimed)", got)
	}
}

// Malformed JSON is acked, not naked: redelivering it loops forever.
func TestHandleMessage_MalformedJSONIsAckedNotRetried(t *testing.T) {
	st := &countingStore{}
	c, _, _ := newTestConsumer(st, fakeQuerier{ownerID: "owner-1"}, &stubIdem{acquired: true})

	msg := &fakeMsg{subject: "project.completed", data: []byte("{not json")}

	c.handleMessage(context.Background(), msg)

	acks, naks := msg.counts()
	if acks != 1 {
		t.Errorf("acks = %d, want 1 (bad data must leave the stream)", acks)
	}
	if naks != 0 {
		t.Errorf("naks = %d, want 0 (naking unparseable data is an infinite loop)", naks)
	}
	if got := st.createCount(); got != 0 {
		t.Errorf("notifications created = %d, want 0", got)
	}
}

// An event with no ID skips the claim entirely and still processes.
func TestHandleMessage_EmptyEventIDSkipsClaim(t *testing.T) {
	st := &countingStore{}
	idem := &stubIdem{acquired: true}
	c, _, _ := newTestConsumer(st, fakeQuerier{ownerID: "owner-1"}, idem)

	msg := &fakeMsg{
		subject: "project.completed",
		data:    mustEvent(t, "", "project.completed", `{"projectId":"p-1","ownerId":"owner-1"}`),
	}

	c.handleMessage(context.Background(), msg)

	idem.mu.Lock()
	claims := len(idem.claims)
	idem.mu.Unlock()
	if claims != 0 {
		t.Errorf("claims = %d, want 0 (an empty id is not a dedup key)", claims)
	}
	if got := st.createCount(); got != 1 {
		t.Errorf("notifications created = %d, want 1", got)
	}
}

// A successful run keeps its claim, which is what makes redelivery a no-op.
func TestHandleMessage_SuccessKeepsClaim(t *testing.T) {
	st := &countingStore{}
	idem := &stubIdem{acquired: true}
	c, _, _ := newTestConsumer(st, fakeQuerier{ownerID: "owner-1"}, idem)

	msg := &fakeMsg{
		subject: "project.completed",
		data:    mustEvent(t, "evt-ok", "project.completed", `{"projectId":"p-1","ownerId":"owner-1"}`),
	}

	c.handleMessage(context.Background(), msg)

	if got := idem.releaseCount(); got != 0 {
		t.Errorf("releases = %d, want 0 (releasing after success reopens the duplicate window)", got)
	}
	acks, _ := msg.counts()
	if acks != 1 {
		t.Errorf("acks = %d, want 1", acks)
	}
}

// Trace headers on the wire must not break processing.
func TestHandleMessage_WithTraceHeaders(t *testing.T) {
	st := &countingStore{}
	c, _, _ := newTestConsumer(st, fakeQuerier{ownerID: "owner-1"}, &stubIdem{acquired: true})

	hdrs := nats.Header{}
	hdrs.Set("traceparent", "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01")

	msg := &fakeMsg{
		subject: "project.completed",
		headers: hdrs,
		data:    mustEventWithCorrelation(t, "evt-trace", "project.completed", "corr-1", `{"projectId":"p-1","ownerId":"owner-1"}`),
	}

	c.handleMessage(context.Background(), msg)

	if got := st.createCount(); got != 1 {
		t.Errorf("notifications created = %d, want 1", got)
	}
}

// An ack that fails is logged, not retried; the handler still returns.
func TestHandleMessage_AckErrorDoesNotPanic(t *testing.T) {
	st := &countingStore{}
	c, _, _ := newTestConsumer(st, fakeQuerier{ownerID: "owner-1"}, &stubIdem{acquired: true})

	msg := &fakeMsg{
		subject: "project.completed",
		ackErr:  errors.New("ack timeout"),
		data:    mustEvent(t, "evt-ackfail", "project.completed", `{"projectId":"p-1","ownerId":"owner-1"}`),
	}

	c.handleMessage(context.Background(), msg)

	acks, _ := msg.counts()
	if acks != 1 {
		t.Errorf("acks = %d, want 1", acks)
	}
}

// Failing to record a dead letter must still ack, or the event is redelivered
// forever with no chance of ever succeeding.
func TestHandleMessage_DeadLetterWriteFailureStillAcks(t *testing.T) {
	st := &failingDeadLetterStore{}
	c, _, _ := newTestConsumer(st, fakeQuerier{ownerID: "owner-1"}, &stubIdem{acquired: true})

	msg := &fakeMsg{
		subject:      "project.completed",
		numDelivered: maxDeliver,
		data:         mustEvent(t, "evt-dlfail", "project.completed", `{"projectId":"p-1","ownerId":"owner-1"}`),
	}

	c.handleMessage(context.Background(), msg)

	acks, naks := msg.counts()
	if acks != 1 {
		t.Errorf("acks = %d, want 1", acks)
	}
	if naks != 0 {
		t.Errorf("naks = %d, want 0", naks)
	}
}

// Release failure after a processing failure must not change the nak.
func TestHandleMessage_ReleaseErrorStillNaks(t *testing.T) {
	st := &countingStore{createErr: errors.New("insert failed")}
	idem := &stubIdem{acquired: true, releaseErr: errors.New("redis down")}
	c, _, _ := newTestConsumer(st, fakeQuerier{ownerID: "owner-1"}, idem)

	msg := &fakeMsg{
		subject:      "project.completed",
		numDelivered: 1,
		data:         mustEvent(t, "evt-relfail", "project.completed", `{"projectId":"p-1","ownerId":"owner-1"}`),
	}

	c.handleMessage(context.Background(), msg)

	_, naks := msg.counts()
	if naks != 1 {
		t.Errorf("naks = %d, want 1", naks)
	}
}

// failingDeadLetterStore fails both the create and the dead-letter write.
type failingDeadLetterStore struct{ countingStore }

func (s *failingDeadLetterStore) Create(context.Context, store.CreateInput) (*store.Notification, error) {
	return nil, errors.New("insert failed")
}

func (s *failingDeadLetterStore) RecordDeadLetter(context.Context, store.DeadLetterInput) error {
	return errors.New("dlq insert failed")
}

func TestIsFinalDelivery(t *testing.T) {
	tests := []struct {
		name         string
		numDelivered uint64
		metaErr      error
		want         bool
	}{
		{"first delivery", 1, nil, false},
		{"second delivery", 2, nil, false},
		{"max delivery", maxDeliver, nil, true},
		{"beyond max", maxDeliver + 1, nil, true},
		{"metadata unreadable parks", 1, errors.New("boom"), true},
	}

	c := &Consumer{}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := c.isFinalDelivery(&fakeMsg{numDelivered: tt.numDelivered, metaErr: tt.metaErr})
			if got != tt.want {
				t.Errorf("isFinalDelivery() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestStrPtr(t *testing.T) {
	if got := strPtr(""); got != nil {
		t.Errorf("strPtr(\"\") = %v, want nil (an empty link must not be stored)", got)
	}
	got := strPtr("/projects/p-1")
	if got == nil || *got != "/projects/p-1" {
		t.Errorf("strPtr = %v, want pointer to /projects/p-1", got)
	}
}

func TestIsConnected_NilConnection(t *testing.T) {
	c := &Consumer{}
	if c.IsConnected() {
		t.Error("IsConnected() = true on a consumer that never started; readiness would pass with no NATS")
	}
}

// Close is called from main's defer and again explicitly; twice must be safe.
func TestClose_IsIdempotent(t *testing.T) {
	c := &Consumer{}
	c.Close()
	c.Close()
}

func TestNew_NilIdempotencyFallsBackToNoOp(t *testing.T) {
	c := New(nil, nil, sender.NewEmailSender(""), sender.NewCentrifugoSender("", ""), nil)
	if c.idem == nil {
		t.Fatal("idem is nil; every Claim would panic")
	}
	if _, ok := c.idem.(idempotency.NoOp); !ok {
		t.Errorf("idem = %T, want idempotency.NoOp", c.idem)
	}
}

func TestNew_KeepsSuppliedIdempotency(t *testing.T) {
	supplied := &stubIdem{acquired: true}
	c := New(nil, nil, sender.NewEmailSender(""), sender.NewCentrifugoSender("", ""), supplied)
	if c.idem != supplied {
		t.Error("New replaced the supplied idempotency backend")
	}
}

// mustEvent builds a marshalled NATSEvent envelope.
func mustEvent(t *testing.T, id, eventType, data string) []byte {
	t.Helper()
	return mustEventWithCorrelation(t, id, eventType, "", data)
}

func mustEventWithCorrelation(t *testing.T, id, eventType, correlationID, data string) []byte {
	t.Helper()
	b, err := json.Marshal(NATSEvent{
		ID:            id,
		Type:          eventType,
		Source:        "test",
		Timestamp:     time.Now().UTC().Format(time.RFC3339),
		CorrelationID: correlationID,
		Data:          json.RawMessage(data),
	})
	if err != nil {
		t.Fatalf("marshal event: %v", err)
	}
	return b
}
