package consumer

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/kerjacus/notification-service/internal/idempotency"
	"github.com/kerjacus/notification-service/internal/sender"
	"github.com/kerjacus/notification-service/internal/store"
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

	mu sync.Mutex
	// nakDelays records the delay asked for by each NakWithDelay, in order. A
	// delayed nak counts as a nak: it is the same "give it back", with a wait.
	nakDelays []time.Duration
	acked     int
	naked     int
	termed    int
	inProg    int
	dblAckd   int
}

func (m *fakeMsg) Metadata() (*jetstream.MsgMetadata, error) {
	if m.metaErr != nil {
		return nil, m.metaErr
	}
	return &jetstream.MsgMetadata{NumDelivered: m.numDelivered}, nil
}

func (m *fakeMsg) Data() []byte                { return m.data }
func (m *fakeMsg) Headers() nats.Header        { return m.headers }
func (m *fakeMsg) Subject() string             { return m.subject }
func (m *fakeMsg) Reply() string               { return "" }
func (m *fakeMsg) Term() error                 { m.bump(&m.termed); return nil }
func (m *fakeMsg) TermWithReason(string) error { m.bump(&m.termed); return nil }
func (m *fakeMsg) InProgress() error           { m.bump(&m.inProg); return nil }

func (m *fakeMsg) NakWithDelay(d time.Duration) error {
	m.mu.Lock()
	m.naked++
	m.nakDelays = append(m.nakDelays, d)
	m.mu.Unlock()
	return nil
}

func (m *fakeMsg) inProgressCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.inProg
}

func (m *fakeMsg) delays() []time.Duration {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]time.Duration(nil), m.nakDelays...)
}
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

// stubIdem drives the claim outcomes handleMessage branches on.
type stubIdem struct {
	status     idempotency.Status
	claimErr   error
	releaseErr error

	mu        sync.Mutex
	claims    []string
	releases  []string
	completes []string
}

func (s *stubIdem) Claim(_ context.Context, id string) (idempotency.Status, error) {
	s.mu.Lock()
	s.claims = append(s.claims, id)
	s.mu.Unlock()
	if s.claimErr != nil {
		return idempotency.StatusInFlight, s.claimErr
	}
	return s.status, nil
}

func (s *stubIdem) Refresh(context.Context, string) error { return nil }

func (s *stubIdem) Complete(_ context.Context, id string) error {
	s.mu.Lock()
	s.completes = append(s.completes, id)
	s.mu.Unlock()
	return nil
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

func (s *stubIdem) completeCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.completes)
}

var _ idempotency.Idempotency = (*stubIdem)(nil)

// leaseIdem is the Redis store's behaviour without Redis: a lease that one
// delivery holds, that Complete turns into a permanent record, and that a
// crash leaves behind for expire() to clear. It is what makes the crash and
// panic paths assertable end to end.
type leaseIdem struct {
	mu    sync.Mutex
	state map[string]idempotency.Status
}

func newLeaseIdem() *leaseIdem {
	return &leaseIdem{state: map[string]idempotency.Status{}}
}

func (l *leaseIdem) Claim(_ context.Context, id string) (idempotency.Status, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	switch l.state[id] {
	case idempotency.StatusDone:
		return idempotency.StatusDone, nil
	case idempotency.StatusClaimed:
		return idempotency.StatusInFlight, nil
	default:
		l.state[id] = idempotency.StatusClaimed
		return idempotency.StatusClaimed, nil
	}
}

func (l *leaseIdem) Refresh(context.Context, string) error { return nil }

func (l *leaseIdem) Complete(_ context.Context, id string) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.state[id] = idempotency.StatusDone
	return nil
}

func (l *leaseIdem) Release(_ context.Context, id string) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.state, id)
	return nil
}

// expire drops every unfinished lease, which is what the TTL does for a
// process that died holding one.
func (l *leaseIdem) expire() {
	l.mu.Lock()
	defer l.mu.Unlock()
	for id, status := range l.state {
		if status != idempotency.StatusDone {
			delete(l.state, id)
		}
	}
}

var _ idempotency.Idempotency = (*leaseIdem)(nil)

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

// lastInput is what the consumer actually asked the store to write, which is
// where the template key and params have to land.
func (s *countingStore) lastInput() store.CreateInput {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.created) == 0 {
		return store.CreateInput{}
	}
	return s.created[len(s.created)-1]
}

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

// A delivery of an event an earlier one finished must be acked and must not
// notify again. This is the property that stops a redelivery re-emailing
// everyone.
func TestHandleMessage_CompletedEventIsAckedAndNotReprocessed(t *testing.T) {
	st := &countingStore{}
	idem := &stubIdem{status: idempotency.StatusDone}
	c, email, _ := newTestConsumer(st, fakeQuerier{ownerID: "owner-1"}, idem)

	msg := &fakeMsg{
		subject: "project.completed",
		data:    mustEvent(t, "evt-dup", "project.completed", `{"projectId":"p-1","ownerId":"owner-1"}`),
	}

	c.handleMessage(context.Background(), msg)

	acks, naks := msg.counts()
	if acks != 1 {
		t.Errorf("acks = %d, want 1 (a finished event must be acked, not redelivered)", acks)
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

// An event another delivery is still holding must be handed back, never acked.
// Acking it is the drop this branch exists to prevent: the holder may be a
// process that has already died, and its lease expires before the redelivery
// this nak asks for arrives.
func TestHandleMessage_InFlightEventIsNakedNotAcked(t *testing.T) {
	st := &countingStore{}
	idem := &stubIdem{status: idempotency.StatusInFlight}
	c, email, _ := newTestConsumer(st, fakeQuerier{ownerID: "owner-1"}, idem)

	msg := &fakeMsg{
		subject:      "project.completed",
		numDelivered: 1,
		data:         mustEvent(t, "evt-inflight", "project.completed", `{"projectId":"p-1","ownerId":"owner-1"}`),
	}

	c.handleMessage(context.Background(), msg)

	acks, naks := msg.counts()
	if naks != 1 {
		t.Errorf("naks = %d, want 1 (a live claim must be waited out, not acked away)", naks)
	}
	if acks != 0 {
		t.Errorf("acks = %d, want 0 (acking here loses the notification if the holder died)", acks)
	}
	// Delayed, or all three deliveries are spent inside one lease and the event
	// is parked while its holder is still working on it.
	delays := msg.delays()
	if len(delays) != 1 || delays[0] < idempotency.LeaseTTL {
		t.Errorf("nak delays = %v, want one of at least %v", delays, idempotency.LeaseTTL)
	}
	if got := st.createCount(); got != 0 || email.count() != 0 {
		t.Errorf("created = %d, emails = %d, want 0 and 0 (the holder is doing the work)",
			got, email.count())
	}
	// The lease is not this delivery's to drop.
	if got := idem.releaseCount(); got != 0 {
		t.Errorf("releases = %d, want 0 (releasing another delivery's claim invites a double send)", got)
	}
}

// The last delivery has no redelivery left to wait with, so an event still
// claimed by someone else is parked rather than acked into silence.
func TestHandleMessage_InFlightOnFinalDeliveryParks(t *testing.T) {
	st := &countingStore{}
	idem := &stubIdem{status: idempotency.StatusInFlight}
	c, _, _ := newTestConsumer(st, fakeQuerier{ownerID: "owner-1"}, idem)

	msg := &fakeMsg{
		subject:      "project.completed",
		numDelivered: maxDeliver,
		data:         mustEvent(t, "evt-inflight-final", "project.completed", `{"projectId":"p-1","ownerId":"owner-1"}`),
	}

	c.handleMessage(context.Background(), msg)

	if got := st.deadLetterCount(); got != 1 {
		t.Fatalf("dead letters = %d, want 1 (the last delivery must leave a trace, not vanish)", got)
	}
	acks, naks := msg.counts()
	if acks != 1 || naks != 0 {
		t.Errorf("acks = %d, naks = %d, want 1 and 0 (parked, and not redelivered on top)", acks, naks)
	}
	if got := idem.releaseCount(); got != 0 {
		t.Errorf("releases = %d, want 0 (the claim belongs to the other delivery)", got)
	}
}

// A crash between the claim and the ack must not cost the notification. The
// dead run's lease expires, and the redelivery that follows has to process and
// send rather than read the leftover claim as a completed delivery.
func TestHandleMessage_CrashedClaimIsRedeliveredAndSent(t *testing.T) {
	idem := newLeaseIdem()

	// The run that died: it claimed the event and never got to ack it.
	if status, err := idem.Claim(context.Background(), "evt-crash"); err != nil || status != idempotency.StatusClaimed {
		t.Fatalf("Claim() = %v, %v, want StatusClaimed", status, err)
	}
	idem.expire()

	st := &countingStore{}
	c, email, _ := newTestConsumer(st, fakeQuerier{ownerID: "owner-1"}, idem)
	msg := &fakeMsg{
		subject:      "project.completed",
		numDelivered: 2,
		data:         mustEvent(t, "evt-crash", "project.completed", `{"projectId":"p-1","ownerId":"owner-1"}`),
	}

	c.handleMessage(context.Background(), msg)

	if got := st.createCount(); got != 1 {
		t.Errorf("notifications created = %d, want 1 (the crashed delivery must be redone)", got)
	}
	if got := email.count(); got != 1 {
		t.Errorf("emails sent = %d, want 1 (the email the crash cost has to go out)", got)
	}
	acks, naks := msg.counts()
	if acks != 1 || naks != 0 {
		t.Errorf("acks = %d, naks = %d, want 1 and 0", acks, naks)
	}

	// And only once: the redelivery that follows a completed run is skipped.
	replay := &fakeMsg{
		subject:      "project.completed",
		numDelivered: 3,
		data:         mustEvent(t, "evt-crash", "project.completed", `{"projectId":"p-1","ownerId":"owner-1"}`),
	}
	c.handleMessage(context.Background(), replay)
	if got := email.count(); got != 1 {
		t.Errorf("emails sent = %d after the replay, want 1 (the finished event must stay finished)", got)
	}
}

// A panic mid-handler must behave like any other failure: claim handed back,
// message naked, and the redelivery actually sends. Before this the panic took
// the process down holding the claim, and the redelivery acked it as a
// duplicate without sending anything.
func TestHandleMessage_PanicIsRecoveredAndRedeliverySends(t *testing.T) {
	logs := captureLogs(t)
	idem := newLeaseIdem()

	panicking := &panickingStore{}
	c, _, _ := newTestConsumer(panicking, fakeQuerier{ownerID: "owner-1"}, idem)
	msg := &fakeMsg{
		subject:      "project.completed",
		numDelivered: 1,
		data:         mustEvent(t, "evt-panic", "project.completed", `{"projectId":"p-1","ownerId":"owner-1"}`),
	}

	c.handleMessage(context.Background(), msg)

	acks, naks := msg.counts()
	if naks != 1 || acks != 0 {
		t.Errorf("acks = %d, naks = %d, want 0 and 1 (a panic must ask for redelivery)", acks, naks)
	}
	if out := logs.String(); !strings.Contains(out, "panic while processing event") {
		t.Errorf("the panic left no log, so the cause would be invisible.\ngot: %s", out)
	}

	// The redelivery, against a healthy store.
	healthy := &countingStore{}
	c2, email, _ := newTestConsumer(healthy, fakeQuerier{ownerID: "owner-1"}, idem)
	redelivery := &fakeMsg{
		subject:      "project.completed",
		numDelivered: 2,
		data:         mustEvent(t, "evt-panic", "project.completed", `{"projectId":"p-1","ownerId":"owner-1"}`),
	}

	c2.handleMessage(context.Background(), redelivery)

	if got := healthy.createCount(); got != 1 {
		t.Errorf("notifications created on redelivery = %d, want 1 (the panic must not eat the event)", got)
	}
	if got := email.count(); got != 1 {
		t.Errorf("emails sent on redelivery = %d, want 1", got)
	}
	acks, naks = redelivery.counts()
	if acks != 1 || naks != 0 {
		t.Errorf("acks = %d, naks = %d, want 1 and 0", acks, naks)
	}
}

// An email that cannot be sent - an unconfigured API key being the case that
// used to report success - must travel the same road as any other failure:
// redelivery while JetStream has one left, and the dead letter queue after
// that. Acking it is what made an undelivered verification mail invisible.
func TestHandleMessage_EmailFailureNaksThenParks(t *testing.T) {
	tests := []struct {
		name         string
		numDelivered uint64
		wantAcks     int
		wantNaks     int
		wantParked   int
	}{
		{"retries remain", 1, 0, 1, 0},
		{"last delivery", maxDeliver, 1, 0, 1},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			st := &countingStore{}
			idem := &stubIdem{status: idempotency.StatusClaimed}
			c, email, _ := newTestConsumer(st, fakeQuerier{ownerID: "owner-1"}, idem)
			email.err = sender.ErrNotConfigured

			msg := &fakeMsg{
				subject:      "project.completed",
				numDelivered: tt.numDelivered,
				data:         mustEvent(t, "evt-noemail", "project.completed", `{"projectId":"p-1","ownerId":"owner-1"}`),
			}

			c.handleMessage(context.Background(), msg)

			acks, naks := msg.counts()
			if acks != tt.wantAcks || naks != tt.wantNaks {
				t.Errorf("acks = %d, naks = %d, want %d and %d", acks, naks, tt.wantAcks, tt.wantNaks)
			}
			if got := st.deadLetterCount(); got != tt.wantParked {
				t.Errorf("dead letters = %d, want %d", got, tt.wantParked)
			}
			if got := idem.completeCount(); got != 0 {
				t.Errorf("completes = %d, want 0 (an undelivered email is not a finished event)", got)
			}
			if got := idem.releaseCount(); got != 1 {
				t.Errorf("releases = %d, want 1 (the claim has to go back for the retry)", got)
			}
		})
	}
}

// panickingStore is a handler collaborator that dies mid-event.
type panickingStore struct{ countingStore }

func (s *panickingStore) Create(context.Context, store.CreateInput) (*store.Notification, error) {
	panic("boom")
}

// The finished record is written after the ack, never before: a crash between
// the two has to leave the event redeliverable.
func TestHandleMessage_CompletesOnlyAfterAck(t *testing.T) {
	st := &countingStore{}
	idem := &stubIdem{status: idempotency.StatusClaimed}
	c, _, _ := newTestConsumer(st, fakeQuerier{ownerID: "owner-1"}, idem)

	msg := &fakeMsg{
		subject: "project.completed",
		data:    mustEvent(t, "evt-complete", "project.completed", `{"projectId":"p-1","ownerId":"owner-1"}`),
	}

	c.handleMessage(context.Background(), msg)

	if got := idem.completeCount(); got != 1 {
		t.Errorf("completes = %d, want 1 (an event nobody records done is sent twice)", got)
	}
	if got := idem.releaseCount(); got != 0 {
		t.Errorf("releases = %d, want 0", got)
	}
}

// A failure must never be recorded as done, or the redelivery it asks for is
// skipped and the notification is lost.
func TestHandleMessage_FailureDoesNotComplete(t *testing.T) {
	st := &countingStore{createErr: errors.New("db down")}
	idem := &stubIdem{status: idempotency.StatusClaimed}
	c, _, _ := newTestConsumer(st, fakeQuerier{ownerID: "owner-1"}, idem)

	msg := &fakeMsg{
		subject:      "project.completed",
		numDelivered: 1,
		data:         mustEvent(t, "evt-nocomplete", "project.completed", `{"projectId":"p-1","ownerId":"owner-1"}`),
	}

	c.handleMessage(context.Background(), msg)

	if got := idem.completeCount(); got != 0 {
		t.Errorf("completes = %d, want 0 (a failed event marked done can never be retried)", got)
	}
}

// orderedIdem records the sequence of lease operations, and holds each refresh
// open long enough that one landing late would be visible.
type orderedIdem struct {
	mu  sync.Mutex
	ops []string
}

func (o *orderedIdem) record(op string) {
	o.mu.Lock()
	o.ops = append(o.ops, op)
	o.mu.Unlock()
}

func (o *orderedIdem) Claim(context.Context, string) (idempotency.Status, error) {
	o.record("claim")
	return idempotency.StatusClaimed, nil
}

func (o *orderedIdem) Refresh(context.Context, string) error {
	time.Sleep(2 * time.Millisecond)
	o.record("refresh")
	return nil
}

func (o *orderedIdem) Complete(context.Context, string) error {
	o.record("complete")
	return nil
}

func (o *orderedIdem) Release(context.Context, string) error {
	o.record("release")
	return nil
}

func (o *orderedIdem) sequence() []string {
	o.mu.Lock()
	defer o.mu.Unlock()
	return append([]string(nil), o.ops...)
}

var _ idempotency.Idempotency = (*orderedIdem)(nil)

// No heartbeat may outlive the handler it is beating for. A refresh still in
// flight when the event is recorded done puts the lease's twenty seconds back
// on a key that has to hold for a week, and the next delivery of that event
// sends it a second time. The race is on the key, not on memory, so the race
// detector cannot see it: the ordering is what has to be asserted.
func TestHandleMessage_NoHeartbeatOutlivesTheHandler(t *testing.T) {
	restore := heartbeatInterval
	heartbeatInterval = time.Millisecond
	t.Cleanup(func() { heartbeatInterval = restore })

	idem := &orderedIdem{}
	st := &slowStore{delay: 30 * time.Millisecond}
	c, _, _ := newTestConsumer(st, fakeQuerier{ownerID: "owner-1"}, idem)

	msg := &fakeMsg{
		subject: "project.completed",
		data:    mustEvent(t, "evt-beat", "project.completed", `{"projectId":"p-1","ownerId":"owner-1"}`),
	}

	c.handleMessage(context.Background(), msg)

	seq := idem.sequence()
	if len(seq) == 0 || seq[len(seq)-1] != "complete" {
		t.Fatalf("lease operations = %v, want complete last; a refresh after it shortens the finished record to one lease", seq)
	}
	// The beat has to have run at all, or the ordering above proves nothing.
	refreshes := 0
	for _, op := range seq {
		if op == "refresh" {
			refreshes++
		}
	}
	if refreshes == 0 {
		t.Error("no refresh ran; a handler outliving its lease would lose it")
	}
	if got := msg.inProgressCount(); got == 0 {
		t.Error("the ack deadline was never extended; a slow handler would be redelivered on top of itself")
	}
}

// slowStore makes the handler last long enough for the heartbeat to beat.
type slowStore struct {
	countingStore
	delay time.Duration
}

func (s *slowStore) Create(ctx context.Context, in store.CreateInput) (*store.Notification, error) {
	time.Sleep(s.delay)
	return s.countingStore.Create(ctx, in)
}

// The two deadlines that keep a live handler safe and free a dead one are
// related, and the relation is the whole fix: the lease must lapse before
// JetStream redelivers, and a beat must land well inside the lease.
func TestHeartbeatOutpacesBothDeadlines(t *testing.T) {
	if idempotency.LeaseTTL >= ackWait {
		t.Errorf("LeaseTTL = %v, ackWait = %v; a lease that outlives AckWait makes a crashed claim look like a completed one",
			idempotency.LeaseTTL, ackWait)
	}
	if heartbeatInterval*2 >= idempotency.LeaseTTL {
		t.Errorf("heartbeatInterval = %v, LeaseTTL = %v; a live handler would lose its lease between beats",
			heartbeatInterval, idempotency.LeaseTTL)
	}
}

// A first delivery that fails is naked for retry, releases its claim, and is
// not dead-lettered while JetStream still has redeliveries left.
func TestHandleMessage_NonFinalFailureNaksAndReleases(t *testing.T) {
	st := &countingStore{createErr: errors.New("insert failed")}
	idem := &stubIdem{status: idempotency.StatusClaimed}
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
	idem := &stubIdem{status: idempotency.StatusClaimed}
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
	c, _, _ := newTestConsumer(st, fakeQuerier{ownerID: "owner-1"}, &stubIdem{status: idempotency.StatusClaimed})

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
	c, _, _ := newTestConsumer(st, fakeQuerier{ownerID: "owner-1"}, &stubIdem{status: idempotency.StatusClaimed})

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
	idem := &stubIdem{status: idempotency.StatusClaimed}
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
	idem := &stubIdem{status: idempotency.StatusClaimed}
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
	c, _, _ := newTestConsumer(st, fakeQuerier{ownerID: "owner-1"}, &stubIdem{status: idempotency.StatusClaimed})

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
	c, _, _ := newTestConsumer(st, fakeQuerier{ownerID: "owner-1"}, &stubIdem{status: idempotency.StatusClaimed})

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
	c, _, _ := newTestConsumer(st, fakeQuerier{ownerID: "owner-1"}, &stubIdem{status: idempotency.StatusClaimed})

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
	idem := &stubIdem{status: idempotency.StatusClaimed, releaseErr: errors.New("redis down")}
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
	c := New(nil, nil, sender.NewEmailSender("", ""), sender.NewCentrifugoSender("", ""), nil)
	if c.idem == nil {
		t.Fatal("idem is nil; every Claim would panic")
	}
	if _, ok := c.idem.(idempotency.NoOp); !ok {
		t.Errorf("idem = %T, want idempotency.NoOp", c.idem)
	}
}

func TestNew_KeepsSuppliedIdempotency(t *testing.T) {
	supplied := &stubIdem{status: idempotency.StatusClaimed}
	c := New(nil, nil, sender.NewEmailSender("", ""), sender.NewCentrifugoSender("", ""), supplied)
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
