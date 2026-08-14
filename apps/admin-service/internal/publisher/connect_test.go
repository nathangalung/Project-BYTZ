package publisher

import (
	"strings"
	"testing"
	"time"

	"github.com/nats-io/nats.go"
)

// Connect must reject a URL nats cannot parse rather than hand back a publisher
// that fails on every DLQ reprocess. main only logs the warning and carries on,
// so a nil error here is the difference between a startup warning and an
// endpoint that 502s forever.
func TestConnect_RejectsAnUnparseableURL(t *testing.T) {
	p, err := Connect("://not-a-url")

	if err == nil {
		t.Fatal("Connect returned nil error for an unparseable URL")
	}
	if p != nil {
		t.Error("Connect returned a publisher alongside its error")
	}
	if !strings.Contains(err.Error(), "connect nats") {
		t.Errorf("error = %q, want it to name the connect step", err.Error())
	}
}

// A server that is merely down is not a configuration error. RetryOnFailedConnect
// means Connect succeeds and the connection keeps retrying in the background, so
// the service starts and DLQ reprocess recovers once NATS is back. Treating this
// as fatal would make a NATS outage take the admin panel down with it.
func TestConnect_SucceedsWhileTheServerIsDown(t *testing.T) {
	p, err := Connect("nats://127.0.0.1:1")
	if err != nil {
		t.Fatalf("Connect error = %v; a NATS outage must not block admin startup", err)
	}
	if p == nil {
		t.Fatal("Connect returned no publisher and no error")
	}
	t.Cleanup(p.Close)

	if p.nc == nil {
		t.Error("publisher has no connection")
	}
	if p.js == nil {
		t.Error("publisher has no JetStream context; Republish would nil-panic")
	}
}

// Close drains the connection so queued publishes are flushed rather than cut
// off. It must also survive being called on a publisher that never connected,
// which is the shape main's deferred Close takes on the error path.
func TestClose_DrainsAndToleratesNoConnection(t *testing.T) {
	t.Run("no connection", func(t *testing.T) {
		p := &NATSPublisher{}
		p.Close() // must not panic
	})

	t.Run("closes the connection", func(t *testing.T) {
		nc, err := nats.Connect("nats://127.0.0.1:1",
			nats.RetryOnFailedConnect(true),
			nats.MaxReconnects(-1),
			nats.ReconnectWait(time.Hour),
		)
		if err != nil {
			t.Fatalf("connect: %v", err)
		}
		p := &NATSPublisher{nc: nc}

		p.Close()

		deadline := time.After(2 * time.Second)
		for !nc.IsClosed() {
			select {
			case <-deadline:
				t.Fatal("Close left the connection open; the reconnect loop keeps the process alive")
			default:
				time.Sleep(5 * time.Millisecond)
			}
		}
	})
}

// The mock stands in for the real publisher in handler tests, so its Close has
// to satisfy the same interface without doing anything.
func TestMockPublisher_CloseIsANoOp(t *testing.T) {
	var p Publisher = &MockPublisher{}
	p.Close()
}
