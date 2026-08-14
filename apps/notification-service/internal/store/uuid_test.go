package store

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"
)

// exhaustedEntropy makes uuid.NewV7 fail. uuid.SetRand is process-global, so
// these tests must not run in parallel; nothing in this module calls
// t.Parallel().
type exhaustedEntropy struct{}

func (exhaustedEntropy) Read([]byte) (int, error) { return 0, errors.New("no entropy") }

func failingUUIDs(t *testing.T) {
	t.Helper()
	uuid.SetRand(exhaustedEntropy{})
	t.Cleanup(func() { uuid.SetRand(nil) })
}

// A failed id must abort the write. uuid.NewV7 returns the zero UUID alongside
// its error, so a caller that ignored it would insert
// 00000000-0000-0000-0000-000000000000 as a primary key: the first row would
// succeed and every row after it would collide.
func TestCreate_FailedUUIDDoesNotWrite(t *testing.T) {
	failingUUIDs(t)
	p := &stubPool{}
	s := &Store{pool: p}

	got, err := s.Create(context.Background(), CreateInput{
		UserID: "user-1",
		Type:   TypePayment,
		Title:  "t",
	})

	if err == nil {
		t.Fatal("Create returned nil error with no entropy; a zero-UUID row would be written")
	}
	if !strings.Contains(err.Error(), "generate uuid") {
		t.Errorf("error = %q, want it to name the uuid step", err.Error())
	}
	if got != nil {
		t.Errorf("notification = %v, want nil alongside the error", got)
	}
	if len(p.sqlSeen) != 0 {
		t.Errorf("statements executed = %v, want none before a usable id exists", p.sqlSeen)
	}
}

// Same contract on the dead-letter path. This one matters more: it runs while
// an event is already failing, and a collision here would lose the only record
// of the drop.
func TestRecordDeadLetter_FailedUUIDDoesNotWrite(t *testing.T) {
	failingUUIDs(t)
	p := &stubPool{}
	s := &Store{pool: p}

	err := s.RecordDeadLetter(context.Background(), DeadLetterInput{
		OriginalEventID: "evt-1",
		EventType:       "payment.released",
		ConsumerService: "notification-service",
	})

	if err == nil {
		t.Fatal("RecordDeadLetter returned nil error with no entropy")
	}
	if !strings.Contains(err.Error(), "generate uuid") {
		t.Errorf("error = %q, want it to name the uuid step", err.Error())
	}
	if len(p.sqlSeen) != 0 {
		t.Errorf("statements executed = %v, want none before a usable id exists", p.sqlSeen)
	}
}
