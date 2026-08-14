package consumer

import (
	"testing"
	"time"

	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
)

// deadConn returns a *nats.Conn for a server that is not there. RetryOnFailedConnect
// makes nats.Connect hand back a usable, permanently reconnecting connection
// rather than an error, which is the only way to get a real one in a unit test.
func deadConn(t *testing.T) *nats.Conn {
	t.Helper()
	nc, err := nats.Connect("nats://127.0.0.1:1",
		nats.RetryOnFailedConnect(true),
		nats.MaxReconnects(-1),
		nats.ReconnectWait(time.Hour),
	)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	return nc
}

// Close must release the NATS connection. Leaving it open keeps the reconnect
// loop alive after shutdown, so the process does not exit.
func TestClose_ClosesTheNATSConnection(t *testing.T) {
	nc := deadConn(t)
	c := &Consumer{nc: nc, contexts: []jetstream.ConsumeContext{newFakeConsumeContext(true)}}

	if nc.IsClosed() {
		t.Fatal("connection was already closed before Close")
	}

	c.Close()

	if !nc.IsClosed() {
		t.Error("Close left the NATS connection open; the reconnect loop keeps the process alive")
	}
	if c.IsConnected() {
		t.Error("IsConnected() = true after Close; readiness would still report the consumer up")
	}
}

// IsConnected gates the readiness probe. It must distinguish never-started from
// connected, or orchestrators route traffic to a service consuming nothing.
func TestIsConnected_ReportsTheConnectionState(t *testing.T) {
	tests := []struct {
		name string
		conn func(*testing.T) *nats.Conn
		want bool
	}{
		{"never started", func(*testing.T) *nats.Conn { return nil }, false},
		{"connecting but not up", deadConn, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			nc := tt.conn(t)
			if nc != nil {
				t.Cleanup(nc.Close)
			}
			c := &Consumer{nc: nc}

			if got := c.IsConnected(); got != tt.want {
				t.Errorf("IsConnected() = %v, want %v", got, tt.want)
			}
		})
	}
}
