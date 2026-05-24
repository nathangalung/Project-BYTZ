package idempotency

import (
	"context"
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

func TestRedisStore_SeenAndMark(t *testing.T) {
	ctx := context.Background()
	store, _ := newTestStore(t, time.Hour)

	seen, err := store.Seen(ctx, "evt-1")
	if err != nil {
		t.Fatalf("Seen: %v", err)
	}
	if seen {
		t.Fatal("expected unseen on first check")
	}

	if err := store.MarkSeen(ctx, "evt-1"); err != nil {
		t.Fatalf("MarkSeen: %v", err)
	}

	seen, err = store.Seen(ctx, "evt-1")
	if err != nil {
		t.Fatalf("Seen after mark: %v", err)
	}
	if !seen {
		t.Fatal("expected seen after MarkSeen")
	}
}

func TestRedisStore_TTLExpires(t *testing.T) {
	ctx := context.Background()
	store, mr := newTestStore(t, 100*time.Millisecond)

	if err := store.MarkSeen(ctx, "evt-2"); err != nil {
		t.Fatalf("MarkSeen: %v", err)
	}

	mr.FastForward(200 * time.Millisecond)

	seen, err := store.Seen(ctx, "evt-2")
	if err != nil {
		t.Fatalf("Seen: %v", err)
	}
	if seen {
		t.Fatal("expected unseen after TTL expiry")
	}
}

func TestRedisStore_RejectsEmptyID(t *testing.T) {
	ctx := context.Background()
	store, _ := newTestStore(t, time.Hour)

	if _, err := store.Seen(ctx, ""); err == nil {
		t.Fatal("expected error for empty Seen id")
	}
	if err := store.MarkSeen(ctx, ""); err == nil {
		t.Fatal("expected error for empty MarkSeen id")
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

func TestNoOp(t *testing.T) {
	ctx := context.Background()
	var n NoOp

	seen, err := n.Seen(ctx, "anything")
	if err != nil {
		t.Fatalf("NoOp.Seen: %v", err)
	}
	if seen {
		t.Fatal("NoOp should always report unseen")
	}

	if err := n.MarkSeen(ctx, "anything"); err != nil {
		t.Fatalf("NoOp.MarkSeen: %v", err)
	}
}
