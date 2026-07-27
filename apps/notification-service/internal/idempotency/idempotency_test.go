package idempotency

import (
	"context"
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

func TestRedisStore_ClaimGrantsOnceThenRefuses(t *testing.T) {
	ctx := context.Background()
	store, _ := newTestStore(t, time.Hour)

	first, err := store.Claim(ctx, "evt-1")
	if err != nil {
		t.Fatalf("Claim: %v", err)
	}
	if !first {
		t.Fatal("first claim should be granted")
	}

	second, err := store.Claim(ctx, "evt-1")
	if err != nil {
		t.Fatalf("Claim again: %v", err)
	}
	if second {
		t.Fatal("second claim should be refused")
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
	results := make([]bool, racers)
	start := make(chan struct{})

	for i := 0; i < racers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			granted, err := store.Claim(ctx, "evt-hot")
			if err != nil {
				t.Errorf("Claim: %v", err)
				return
			}
			results[i] = granted
		}(i)
	}

	close(start)
	wg.Wait()

	winners := 0
	for _, granted := range results {
		if granted {
			winners++
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

	if _, err := store.Claim(ctx, "evt-2"); err != nil {
		t.Fatalf("Claim: %v", err)
	}
	if err := store.Release(ctx, "evt-2"); err != nil {
		t.Fatalf("Release: %v", err)
	}

	again, err := store.Claim(ctx, "evt-2")
	if err != nil {
		t.Fatalf("Claim after release: %v", err)
	}
	if !again {
		t.Fatal("release should let the retry claim it")
	}
}

func TestRedisStore_TTLExpires(t *testing.T) {
	ctx := context.Background()
	store, mr := newTestStore(t, 100*time.Millisecond)

	if _, err := store.Claim(ctx, "evt-3"); err != nil {
		t.Fatalf("Claim: %v", err)
	}

	mr.FastForward(200 * time.Millisecond)

	again, err := store.Claim(ctx, "evt-3")
	if err != nil {
		t.Fatalf("Claim after expiry: %v", err)
	}
	if !again {
		t.Fatal("expected the claim to be re-grantable after TTL expiry")
	}
}

func TestRedisStore_RejectsEmptyID(t *testing.T) {
	ctx := context.Background()
	store, _ := newTestStore(t, time.Hour)

	if _, err := store.Claim(ctx, ""); err == nil {
		t.Fatal("expected error for empty Claim id")
	}
	if err := store.Release(ctx, ""); err == nil {
		t.Fatal("expected error for empty Release id")
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

	granted, err := n.Claim(ctx, "anything")
	if err != nil {
		t.Fatalf("NoOp.Claim: %v", err)
	}
	if !granted {
		t.Fatal("NoOp should always grant the claim")
	}

	if err := n.Release(ctx, "anything"); err != nil {
		t.Fatalf("NoOp.Release: %v", err)
	}
}
