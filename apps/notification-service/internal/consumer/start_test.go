package consumer

import (
	"context"
	"testing"
	"time"
)

/*
Start against a broker that answers. The connection, the JetStream context and
the subscription pass are the whole of what Start does, and none of it is
reachable from an unreachable URL: nats.Connect is configured with
RetryOnFailedConnect, so a dead port returns a connection that is not connected
and every stream lookup then waits out its 5s API timeout.

The streams do not exist on the fake broker, which is the realistic case on a
first deploy. Start must still return nil - the continue-on-error policy in
subscribeAll is what stops one missing stream from costing the other five.
*/
func TestStart_ConnectsAndSubscribesAgainstALiveBroker(t *testing.T) {
	f := newFakeNATS(t)
	c := &Consumer{}

	if err := c.Start(context.Background(), f.URL()); err != nil {
		t.Fatalf("Start error = %v; a broker with no streams yet must not be fatal", err)
	}
	t.Cleanup(c.Close)

	if !c.IsConnected() {
		t.Error("IsConnected() = false after a successful Start; readiness would report the service down forever")
	}
	if c.js == nil {
		t.Error("no JetStream context; every subscription would nil-panic")
	}
	if c.nc == nil {
		t.Error("no connection retained; Close could not drain it")
	}
}

/*
A broker restart must not end event processing. The consumer is configured with
MaxReconnects(-1), so the client is supposed to reattach on its own; if it did
not, the service would keep answering /health while silently processing nothing,
and every notification published during the gap would be missed.

Dropping the connection while leaving the listener up is exactly a broker
restart, and it is the only way the disconnect and reconnect handlers run.
*/
func TestStart_ReattachesAfterTheBrokerDropsTheConnection(t *testing.T) {
	f := newFakeNATS(t)
	c := &Consumer{}

	if err := c.Start(context.Background(), f.URL()); err != nil {
		t.Fatalf("Start error = %v", err)
	}
	t.Cleanup(c.Close)

	if !c.IsConnected() {
		t.Fatal("not connected before the drop; the test would prove nothing")
	}

	f.DropConnections()

	if !waitFor(t, 2*time.Second, func() bool { return !c.IsConnected() }) {
		t.Fatal("the client never noticed the broker went away")
	}

	// ReconnectWait is 2s, so allow a couple of cycles before calling it stuck.
	if !waitFor(t, 15*time.Second, c.IsConnected) {
		t.Error("the client never reattached; the service would process no events until restarted")
	}
}

// waitFor polls cond until it holds or the budget runs out.
func waitFor(t *testing.T, budget time.Duration, cond func() bool) bool {
	t.Helper()
	deadline := time.Now().Add(budget)
	for time.Now().Before(deadline) {
		if cond() {
			return true
		}
		time.Sleep(10 * time.Millisecond)
	}
	return cond()
}
