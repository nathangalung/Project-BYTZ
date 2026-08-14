package consumer

import (
	"context"
	"errors"
	"strings"
	"testing"
)

// A failing Release must be audible. The claim is handed back so the Nak'd
// redelivery can run; if the release silently fails the claim outlives the
// failure and the retry is skipped as a duplicate, dropping the notification.
func TestHandleMessage_ReleaseFailureIsLogged(t *testing.T) {
	logs := captureLogs(t)

	st := &countingStore{createErr: errors.New("db down")}
	idem := &stubIdem{acquired: true, releaseErr: errors.New("redis down")}
	c, _, _ := newTestConsumer(st, fakeQuerier{ownerID: "owner-1"}, idem)

	msg := &fakeMsg{
		subject:      "project.completed",
		numDelivered: 1,
		data:         mustEvent(t, "evt-rel", "project.completed", `{"projectId":"p-1","ownerId":"owner-1"}`),
	}

	c.handleMessage(context.Background(), msg)

	if got := idem.releaseCount(); got != 1 {
		t.Errorf("releases = %d, want 1; the claim was not handed back for the retry", got)
	}
	if out := logs.String(); !strings.Contains(out, "idempotency release failed") {
		t.Errorf("a failed release left no warning, so a silently dropped notification would be invisible.\ngot: %s", out)
	}

	acks, naks := msg.counts()
	if naks != 1 || acks != 0 {
		t.Errorf("acks = %d, naks = %d, want 0 and 1; a non-final failure must ask for redelivery", acks, naks)
	}
}

// The last delivery is parked in dead_letter_events and then acked. If that ack
// fails the row is already written, so the retry JetStream schedules would park
// a second copy of the same event. The failure has to be logged rather than
// swallowed, because a duplicated DLQ row is what an operator sees.
func TestHandleMessage_DeadLetterAckFailureIsLogged(t *testing.T) {
	logs := captureLogs(t)

	st := &countingStore{createErr: errors.New("db down")}
	c, _, _ := newTestConsumer(st, fakeQuerier{ownerID: "owner-1"}, nil)

	msg := &fakeMsg{
		subject:      "project.completed",
		numDelivered: maxDeliver,
		ackErr:       errAckFailed,
		data:         mustEvent(t, "evt-dlq", "project.completed", `{"projectId":"p-1","ownerId":"owner-1"}`),
	}

	c.handleMessage(context.Background(), msg)

	// The parked row's contents are asserted in message_test.go; what is under
	// test here is that a failing ack afterwards is still reported.
	if got := st.deadLetterCount(); got != 1 {
		t.Fatalf("dead letters = %d, want 1; the final delivery was dropped instead of parked", got)
	}

	acks, naks := msg.counts()
	if acks != 1 || naks != 0 {
		t.Errorf("acks = %d, naks = %d, want 1 and 0; a parked event must not also be redelivered", acks, naks)
	}
	if out := logs.String(); !strings.Contains(out, "ack dead letter") {
		t.Errorf("the failed ack left no log, so a duplicated DLQ row would have no explanation.\ngot: %s", out)
	}
}
