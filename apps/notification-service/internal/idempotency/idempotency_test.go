package idempotency

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func newTestStore(t *testing.T, ttl time.Duration) (*RedisStore, *miniredis.Miniredis) {
	t.Helper()
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis start: %v", err)
	}
	t.Cleanup(mr.Close)
	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = client.Close() })
	return NewRedisStore(client, "test:", ttl), mr
}

func mustClaim(t *testing.T, store *RedisStore, id string) Status {
	t.Helper()
	status, err := store.Claim(context.Background(), id)
	if err != nil {
		t.Fatalf("Claim(%s): %v", id, err)
	}
	return status
}

func TestRedisStore_ClaimGrantsOnceThenReportsInFlight(t *testing.T) {
	store, _ := newTestStore(t, time.Hour)

	if got := mustClaim(t, store, "evt-1"); got != StatusClaimed {
		t.Fatalf("first claim = %v, want StatusClaimed", got)
	}
	// Still in flight, not done: the first delivery has not acked anything yet,
	// so a second one must wait rather than treat it as delivered.
	if got := mustClaim(t, store, "evt-1"); got != StatusInFlight {
		t.Fatalf("second claim = %v, want StatusInFlight", got)
	}
}

// The reason this replaced Seen + MarkSeen. Redelivery while the first handler
// is still running is normal traffic, not a fault: AckWait is 30s and team
// formation sends two channels per talent, so an eight-talent team overruns it
// several times over.
func TestRedisStore_ConcurrentClaimsYieldExactlyOneWinner(t *testing.T) {
	ctx := context.Background()
	store, _ := newTestStore(t, time.Hour)

	const racers = 16
	var wg sync.WaitGroup
	results := make([]Status, racers)
	start := make(chan struct{})

	for i := 0; i < racers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			status, err := store.Claim(ctx, "evt-hot")
			if err != nil {
				t.Errorf("Claim: %v", err)
				return
			}
			results[i] = status
		}(i)
	}

	close(start)
	wg.Wait()

	winners := 0
	for _, status := range results {
		if status == StatusClaimed {
			winners++
		}
		if status == StatusDone {
			t.Error("a racing claim was told the event was finished; nothing had finished")
		}
	}
	if winners != 1 {
		t.Fatalf("winners = %d, want exactly 1", winners)
	}
}

// A failed handler Naks for redelivery, so it has to hand the claim back or
// the retry it just asked for would be skipped as a duplicate.
func TestRedisStore_ReleaseAllowsAnotherAttempt(t *testing.T) {
	ctx := context.Background()
	store, _ := newTestStore(t, time.Hour)

	if got := mustClaim(t, store, "evt-2"); got != StatusClaimed {
		t.Fatalf("claim = %v, want StatusClaimed", got)
	}
	if err := store.Release(ctx, "evt-2"); err != nil {
		t.Fatalf("Release: %v", err)
	}
	if got := mustClaim(t, store, "evt-2"); got != StatusClaimed {
		t.Fatalf("claim after release = %v, want StatusClaimed", got)
	}
}

// The crash case, and the whole reason the claim is a lease. A process that
// dies between claiming and acking stops refreshing; the lease lapses, and the
// redelivery that follows must be able to take the event and send it, not read
// the leftover key as a completed delivery.
func TestRedisStore_LeaseExpiryFreesACrashedClaim(t *testing.T) {
	store, mr := newTestStore(t, 7*24*time.Hour)

	if got := mustClaim(t, store, "evt-crash"); got != StatusClaimed {
		t.Fatalf("claim = %v, want StatusClaimed", got)
	}

	// The dead process never called Complete or Release.
	mr.FastForward(LeaseTTL + time.Second)

	if got := mustClaim(t, store, "evt-crash"); got != StatusClaimed {
		t.Fatalf("claim after the lease lapsed = %v, want StatusClaimed; a crashed claim that reads as done drops the notification", got)
	}
}

// Only a completed delivery outlives the lease, and it outlives it by the full
// dedup window.
func TestRedisStore_CompleteSurvivesTheLease(t *testing.T) {
	ctx := context.Background()
	store, mr := newTestStore(t, 7*24*time.Hour)

	if got := mustClaim(t, store, "evt-done"); got != StatusClaimed {
		t.Fatalf("claim = %v, want StatusClaimed", got)
	}
	if err := store.Complete(ctx, "evt-done"); err != nil {
		t.Fatalf("Complete: %v", err)
	}

	mr.FastForward(LeaseTTL + time.Second)

	if got := mustClaim(t, store, "evt-done"); got != StatusDone {
		t.Fatalf("claim after completion = %v, want StatusDone; re-sending a finished event double-notifies", got)
	}
}

// Refresh is what a live handler uses to say it has not died. It must extend
// an existing lease and report one that has already gone.
func TestRedisStore_Refresh(t *testing.T) {
	ctx := context.Background()
	store, mr := newTestStore(t, time.Hour)

	if got := mustClaim(t, store, "evt-live"); got != StatusClaimed {
		t.Fatalf("claim = %v, want StatusClaimed", got)
	}

	mr.FastForward(LeaseTTL / 2)
	if err := store.Refresh(ctx, "evt-live"); err != nil {
		t.Fatalf("Refresh: %v", err)
	}
	mr.FastForward(LeaseTTL * 3 / 4)

	if got := mustClaim(t, store, "evt-live"); got != StatusInFlight {
		t.Errorf("claim = %v, want StatusInFlight; a refreshed lease must still be held", got)
	}

	if err := store.Refresh(ctx, "evt-never-claimed"); !errors.Is(err, ErrLeaseLost) {
		t.Errorf("Refresh of a missing lease = %v, want ErrLeaseLost", err)
	}
}

func TestRedisStore_RejectsEmptyID(t *testing.T) {
	ctx := context.Background()
	store, _ := newTestStore(t, time.Hour)

	if _, err := store.Claim(ctx, ""); err == nil {
		t.Error("expected error for empty Claim id")
	}
	if err := store.Refresh(ctx, ""); err == nil {
		t.Error("expected error for empty Refresh id")
	}
	if err := store.Complete(ctx, ""); err == nil {
		t.Error("expected error for empty Complete id")
	}
	if err := store.Release(ctx, ""); err == nil {
		t.Error("expected error for empty Release id")
	}
}

func TestRedisStore_DefaultTTL(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis: %v", err)
	}
	t.Cleanup(mr.Close)
	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = client.Close() })

	store := NewRedisStore(client, "", 0)
	if store.prefix != "notif:idem:" {
		t.Errorf("default prefix = %q, want notif:idem:", store.prefix)
	}
	if store.ttl != 7*24*time.Hour {
		t.Errorf("default ttl = %v, want 7d", store.ttl)
	}
}

// Redis unreachable must not stop notifications going out, so every delivery
// is granted the claim and JetStream MaxDeliver is the only bound left.
func TestNoOp(t *testing.T) {
	ctx := context.Background()
	var n NoOp

	status, err := n.Claim(ctx, "anything")
	if err != nil {
		t.Fatalf("NoOp.Claim: %v", err)
	}
	if status != StatusClaimed {
		t.Fatalf("NoOp.Claim = %v, want StatusClaimed", status)
	}

	for name, call := range map[string]func(context.Context, string) error{
		"Refresh":  n.Refresh,
		"Complete": n.Complete,
		"Release":  n.Release,
	} {
		if err := call(ctx, "anything"); err != nil {
			t.Errorf("NoOp.%s: %v", name, err)
		}
	}
}
