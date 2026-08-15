package consumer

import (
	"bufio"
	"fmt"
	"net"
	"strconv"
	"strings"
	"sync"
	"testing"
)

/*
fakeNATS speaks enough of the NATS wire protocol for a real nats.Conn to
connect to it: INFO, CONNECT, PING/PONG, SUB and PUB/HPUB.

It exists because the alternative is worse in both directions. Pointing the
consumer at a dead port does establish a connection - RetryOnFailedConnect
keeps it in a reconnect loop - but every JetStream stream lookup then waits out
its own 5s API timeout, so Start takes 30 seconds. And a dead port can never
produce an established-then-dropped connection, which is the only way the
disconnect and reconnect handlers run.

Answering requests with the no-responders status is what makes it fast: the
client turns a 503 into nats.ErrNoResponders immediately instead of waiting for
a timeout. The real nats.go and jetstream code paths execute throughout; only
the socket on the far end is ours.
*/
type fakeNATS struct {
	t  *testing.T
	ln net.Listener

	mu     sync.Mutex
	conns  []net.Conn
	closed bool
}

// noResponders is the header block the server sends when a request reaches a
// subject nobody is listening on.
const noResponders = "NATS/1.0 503\r\n\r\n"

func newFakeNATS(t *testing.T) *fakeNATS {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("fake nats listen: %v", err)
	}
	f := &fakeNATS{t: t, ln: ln}
	go f.acceptLoop()
	t.Cleanup(f.Close)
	return f
}

func (f *fakeNATS) URL() string { return "nats://" + f.ln.Addr().String() }

func (f *fakeNATS) acceptLoop() {
	for {
		conn, err := f.ln.Accept()
		if err != nil {
			return
		}
		f.mu.Lock()
		if f.closed {
			f.mu.Unlock()
			_ = conn.Close()
			return
		}
		f.conns = append(f.conns, conn)
		f.mu.Unlock()
		go f.serve(conn)
	}
}

// DropConnections closes every established connection without closing the
// listener, so the client sees a disconnect and then reconnects.
func (f *fakeNATS) DropConnections() {
	f.mu.Lock()
	conns := f.conns
	f.conns = nil
	f.mu.Unlock()
	for _, c := range conns {
		_ = c.Close()
	}
}

func (f *fakeNATS) Close() {
	f.mu.Lock()
	if f.closed {
		f.mu.Unlock()
		return
	}
	f.closed = true
	conns := f.conns
	f.conns = nil
	f.mu.Unlock()

	_ = f.ln.Close()
	for _, c := range conns {
		_ = c.Close()
	}
}

func (f *fakeNATS) serve(conn net.Conn) {
	defer conn.Close()

	// headers:true is required, or the client never asks for the no-responders
	// status and every request waits out its timeout instead.
	info := `INFO {"server_id":"fake","server_name":"fake","version":"2.10.0","proto":1,` +
		`"go":"go1.25","host":"127.0.0.1","port":4222,"headers":true,"max_payload":1048576,"jetstream":true}` + "\r\n"
	if _, err := conn.Write([]byte(info)); err != nil {
		return
	}

	// subs maps subscription subject to sid, so a request can be answered on
	// the inbox the client actually subscribed.
	subs := map[string]string{}
	reader := bufio.NewReader(conn)

	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			return
		}
		fields := strings.Fields(line)
		if len(fields) == 0 {
			continue
		}

		switch strings.ToUpper(fields[0]) {
		case "CONNECT":
			// Nothing to negotiate; the client's PING follows.
		case "PING":
			if _, err := conn.Write([]byte("PONG\r\n")); err != nil {
				return
			}
		case "PONG":
		case "SUB":
			// SUB <subject> [queue] <sid>
			if len(fields) >= 3 {
				subs[fields[1]] = fields[len(fields)-1]
			}
		case "UNSUB":
		case "PUB", "HPUB":
			if err := f.answer(conn, reader, fields, subs); err != nil {
				return
			}
		}
	}
}

// answer consumes a published message's body and, if it carried a reply
// subject, responds on it with the no-responders status.
func (f *fakeNATS) answer(conn net.Conn, reader *bufio.Reader, fields []string, subs map[string]string) error {
	// PUB  <subject> [reply] <#bytes>
	// HPUB <subject> [reply] <#hdr> <#total>
	var reply string
	var total int

	if strings.EqualFold(fields[0], "PUB") {
		if len(fields) == 4 {
			reply = fields[2]
		}
		total, _ = strconv.Atoi(fields[len(fields)-1])
	} else {
		if len(fields) == 5 {
			reply = fields[2]
		}
		total, _ = strconv.Atoi(fields[len(fields)-1])
	}

	// Body plus the trailing CRLF.
	if _, err := reader.Discard(total + 2); err != nil {
		return err
	}
	if reply == "" {
		return nil
	}

	sid := matchSID(reply, subs)
	if sid == "" {
		return nil
	}
	msg := fmt.Sprintf("HMSG %s %s %d %d\r\n%s\r\n", reply, sid, len(noResponders), len(noResponders), noResponders)
	_, err := conn.Write([]byte(msg))
	return err
}

// matchSID finds the subscription covering an inbox reply subject. JetStream
// subscribes one wildcard inbox and varies the last token per request.
func matchSID(reply string, subs map[string]string) string {
	if sid, ok := subs[reply]; ok {
		return sid
	}
	tokens := strings.Split(reply, ".")
	for i := len(tokens) - 1; i >= 0; i-- {
		candidate := strings.Join(append(append([]string{}, tokens[:i]...), "*"), ".")
		if sid, ok := subs[candidate]; ok {
			return sid
		}
		candidate = strings.Join(append(append([]string{}, tokens[:i]...), ">"), ".")
		if sid, ok := subs[candidate]; ok {
			return sid
		}
	}
	return ""
}
