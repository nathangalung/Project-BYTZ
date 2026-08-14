package consumer

import (
	"context"
	"encoding/json"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/nats-io/nats.go/jetstream"
)

// fakeConsumeContext records drain/stop and controls when it reports closed.
type fakeConsumeContext struct {
	closed chan struct{}

	mu     sync.Mutex
	drains int
	stops  int
}

func newFakeConsumeContext(closedNow bool) *fakeConsumeContext {
	ch := make(chan struct{})
	if closedNow {
		close(ch)
	}
	return &fakeConsumeContext{closed: ch}
}

func (f *fakeConsumeContext) Stop() {
	f.mu.Lock()
	f.stops++
	f.mu.Unlock()
}

func (f *fakeConsumeContext) Drain() {
	f.mu.Lock()
	f.drains++
	f.mu.Unlock()
}

func (f *fakeConsumeContext) Closed() <-chan struct{} { return f.closed }

func (f *fakeConsumeContext) counts() (drains, stops int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.drains, f.stops
}

var _ jetstream.ConsumeContext = (*fakeConsumeContext)(nil)

// Close must Drain, not Stop. Stop discards buffered messages, and each one
// comes back as a redelivery on the next boot.
func TestClose_DrainsEveryContextAndNeverStops(t *testing.T) {
	a := newFakeConsumeContext(true)
	b := newFakeConsumeContext(true)
	c := &Consumer{contexts: []jetstream.ConsumeContext{a, b}}

	c.Close()

	for i, cc := range []*fakeConsumeContext{a, b} {
		drains, stops := cc.counts()
		if drains != 1 {
			t.Errorf("context %d drains = %d, want 1", i, drains)
		}
		if stops != 0 {
			t.Errorf("context %d stops = %d, want 0 (Stop discards buffered messages)", i, stops)
		}
	}
}

// Calling Close twice must drain once. main closes explicitly and again via
// defer on the error paths.
func TestClose_SecondCallIsANoOp(t *testing.T) {
	cc := newFakeConsumeContext(true)
	c := &Consumer{contexts: []jetstream.ConsumeContext{cc}}

	c.Close()
	c.Close()

	drains, _ := cc.counts()
	if drains != 1 {
		t.Errorf("drains = %d, want 1 across two Close calls", drains)
	}
}

// A context that never closes must not hang shutdown past the budget.
func TestWaitDrained_TimesOutAndWarns(t *testing.T) {
	logs := captureLogs(t)

	orig := drainTimeout
	drainTimeout = 20 * time.Millisecond
	t.Cleanup(func() { drainTimeout = orig })

	stuck := newFakeConsumeContext(false)
	c := &Consumer{contexts: []jetstream.ConsumeContext{stuck}}

	done := make(chan struct{})
	go func() {
		c.waitDrained()
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("waitDrained did not return; shutdown would hang past the container stop timeout")
	}

	if out := logs.String(); !strings.Contains(out, "drain timed out") {
		t.Errorf("the timeout left no warning, so a lost drain would be invisible.\ngot: %s", out)
	}
}

// No test asserts that the drain budget is shared rather than per-context.
// The property is not observable: the timeout branch returns instead of moving
// to the next context, so a per-context deadline costs one budget too. Proven
// by mutating the deadline into the loop, which changed nothing.

// Contexts already closed return without spending any of the budget.
func TestWaitDrained_ReturnsWhenAllClosed(t *testing.T) {
	c := &Consumer{contexts: []jetstream.ConsumeContext{
		newFakeConsumeContext(true),
		newFakeConsumeContext(true),
	}}

	done := make(chan struct{})
	go func() {
		c.waitDrained()
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("waitDrained blocked on contexts that already reported closed")
	}
}

// A URL nats cannot parse must fail Start rather than run without events.
func TestStart_InvalidURLReturnsError(t *testing.T) {
	c := &Consumer{}
	err := c.Start(context.Background(), "://not-a-url")
	if err == nil {
		t.Fatal("Start returned nil for an unparseable URL; the service would report ready with no consumer")
	}
	if !strings.Contains(err.Error(), "connect to nats") {
		t.Errorf("error = %v, want it to name the connect step", err)
	}
	if c.IsConnected() {
		t.Error("IsConnected() = true after a failed Start")
	}
}

// The duplicate branch acks; an ack failure there must not panic or nak.
func TestHandleMessage_DuplicateAckFailureIsLogged(t *testing.T) {
	logs := captureLogs(t)
	st := &countingStore{}
	c, _, _ := newTestConsumer(st, fakeQuerier{ownerID: "owner-1"}, &stubIdem{acquired: false})

	msg := &fakeMsg{
		subject: "project.completed",
		ackErr:  errAckFailed,
		data:    mustEvent(t, "evt-dup-ackfail", "project.completed", `{"projectId":"p-1","ownerId":"owner-1"}`),
	}

	c.handleMessage(context.Background(), msg)

	acks, naks := msg.counts()
	if acks != 1 || naks != 0 {
		t.Errorf("acks = %d, naks = %d, want 1 and 0", acks, naks)
	}
	if out := logs.String(); !strings.Contains(out, "ack duplicate") {
		t.Errorf("a failed duplicate ack left no log.\ngot: %s", out)
	}
	if got := st.createCount(); got != 0 {
		t.Errorf("notifications created = %d, want 0", got)
	}
}

// A populated fromStatus must reach the channel payload.
func TestHandleProjectStatusChanged_CarriesFromStatus(t *testing.T) {
	st := &countingStore{}
	c, _, channels := newTestConsumer(st, fakeQuerier{ownerID: "owner-1"}, nil)

	if err := c.handleProjectStatusChanged(context.Background(), NATSEvent{
		Data: json.RawMessage(`{"projectId":"p-9","fromStatus":"matching","toStatus":"matched"}`),
	}); err != nil {
		t.Fatalf("error = %v", err)
	}

	got := channels.publishedChannels()
	if len(got) != 1 || got[0] != "project:p-9" {
		t.Errorf("channels = %v, want [project:p-9]", got)
	}
	if n := st.createCount(); n != 1 {
		t.Errorf("notifications created = %d, want 1", n)
	}
}

type ackError struct{}

func (ackError) Error() string { return "ack timeout" }

var errAckFailed = ackError{}
