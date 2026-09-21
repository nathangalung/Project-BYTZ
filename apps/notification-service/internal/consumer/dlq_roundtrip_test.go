package consumer

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"
)

// republish is what admin-service does with a parked row: it wraps the stored
// payload in a fresh envelope, keeping the original event id, and publishes it
// on the event type. Mirrored here because the two services are separate
// modules and this is the contract between them.
func republish(t *testing.T, originalEventID, eventType string, payload []byte) []byte {
	t.Helper()
	body, err := json.Marshal(NATSEvent{
		ID:        originalEventID,
		Type:      eventType,
		Source:    "admin-service-reprocess",
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		Data:      payload,
	})
	if err != nil {
		t.Fatalf("marshal replay envelope: %v", err)
	}
	return body
}

// A parked event must round-trip: what admin-service republishes has to be the
// envelope a fresh delivery has, byte for byte in its payload, and it has to
// actually deliver.
//
// The whole envelope used to be parked, so the replay arrived double-wrapped -
// {id,type,data:{id,type,data:{...}}} - and the handler read an envelope where
// the payload belongs, unmarshalled it into zero values and delivered nothing
// while reporting success.
func TestDeadLetterRoundTrip_ReplayDeliversTheOriginalPayload(t *testing.T) {
	const (
		eventID   = "evt-roundtrip"
		eventType = "project.completed"
		business  = `{"projectId":"p-1","ownerId":"owner-1"}`
	)
	fresh := mustEvent(t, eventID, eventType, business)

	// What a fresh delivery does, as the yardstick for the replay.
	baseline := &countingStore{}
	baseConsumer, baseEmail, _ := newTestConsumer(baseline, fakeQuerier{ownerID: "owner-1"}, newLeaseIdem())
	baseConsumer.handleMessage(context.Background(), &fakeMsg{subject: eventType, data: fresh})
	if baseline.createCount() != 1 || baseEmail.count() != 1 {
		t.Fatalf("baseline created = %d, emailed = %d, want 1 and 1",
			baseline.createCount(), baseEmail.count())
	}

	// The same event, failing until JetStream gives up on it.
	parking := &countingStore{createErr: errors.New("db down")}
	idem := newLeaseIdem()
	parkConsumer, _, _ := newTestConsumer(parking, fakeQuerier{ownerID: "owner-1"}, idem)
	parkConsumer.handleMessage(context.Background(), &fakeMsg{
		subject:      eventType,
		numDelivered: maxDeliver,
		data:         fresh,
	})

	parking.mu.Lock()
	if len(parking.deadLetters) != 1 {
		parking.mu.Unlock()
		t.Fatalf("dead letters = %d, want 1", len(parking.deadLetters))
	}
	parked := parking.deadLetters[0]
	parking.mu.Unlock()

	if string(parked.Payload) != business {
		t.Fatalf("parked payload = %s, want the business payload %s (an envelope here republishes double-wrapped)",
			parked.Payload, business)
	}

	// Admin reprocess: wrap once, publish, consume.
	replayed := republish(t, parked.OriginalEventID, parked.EventType, parked.Payload)

	var replayEnvelope NATSEvent
	if err := json.Unmarshal(replayed, &replayEnvelope); err != nil {
		t.Fatalf("unmarshal replay: %v", err)
	}
	var freshEnvelope NATSEvent
	if err := json.Unmarshal(fresh, &freshEnvelope); err != nil {
		t.Fatalf("unmarshal fresh: %v", err)
	}
	if string(replayEnvelope.Data) != string(freshEnvelope.Data) {
		t.Errorf("replayed data = %s, want the fresh delivery's %s",
			replayEnvelope.Data, freshEnvelope.Data)
	}

	replayStore := &countingStore{}
	replayConsumer, replayEmail, _ := newTestConsumer(replayStore, fakeQuerier{ownerID: "owner-1"}, idem)
	replayMsg := &fakeMsg{subject: eventType, data: replayed}
	replayConsumer.handleMessage(context.Background(), replayMsg)

	if got := replayStore.createCount(); got != 1 {
		t.Fatalf("notifications created on replay = %d, want 1 (a reprocess that delivers nothing is the bug)", got)
	}
	if got := replayEmail.count(); got != 1 {
		t.Errorf("emails sent on replay = %d, want 1", got)
	}
	if acks, naks := replayMsg.counts(); acks != 1 || naks != 0 {
		t.Errorf("acks = %d, naks = %d, want 1 and 0", acks, naks)
	}

	// Identical wording to the fresh delivery, which is what "round-trips"
	// means: the replay is not a degraded copy.
	if got, want := replayStore.lastInput(), baseline.lastInput(); got.Title != want.Title ||
		got.Message != want.Message || got.UserID != want.UserID {
		t.Errorf("replayed notification = %+v, want the fresh one %+v", got, want)
	}
}

// An event whose envelope carried no data at all must still park something the
// column accepts and the replay can unmarshal.
func TestDlqPayload(t *testing.T) {
	tests := []struct {
		name string
		data json.RawMessage
		want string
	}{
		{"business payload is stored as-is", json.RawMessage(`{"projectId":"p-1"}`), `{"projectId":"p-1"}`},
		{"empty data becomes an empty object", nil, `{}`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := string(dlqPayload(NATSEvent{ID: "e", Type: "t", Data: tt.data})); got != tt.want {
				t.Errorf("dlqPayload() = %s, want %s", got, tt.want)
			}
		})
	}
}
