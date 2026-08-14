package main

import (
	"context"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/bytz/notification-service/internal/idempotency"
)

// Redis is optional. Every way of not having it must degrade to NoOp rather
// than return nil, which the consumer would dereference on the first Claim.
func TestNewIdempotency_DegradesToNoOp(t *testing.T) {
	tests := []struct {
		name string
		url  string
	}{
		{"empty url", ""},
		{"unparseable url", "not-a-redis-url"},
		{"wrong scheme", "http://localhost:6379"},
		{"nothing listening", "redis://127.0.0.1:1"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := newIdempotency(context.Background(), tt.url)
			if got == nil {
				t.Fatal("returned nil; the first Claim would panic")
			}
			if _, ok := got.(idempotency.NoOp); !ok {
				t.Errorf("backend = %T, want idempotency.NoOp", got)
			}
		})
	}
}

// A reachable Redis must produce the real store, not the silent fallback.
func TestNewIdempotency_UsesRedisWhenReachable(t *testing.T) {
	mr := miniredis.RunT(t)

	got := newIdempotency(context.Background(), "redis://"+mr.Addr())
	if got == nil {
		t.Fatal("returned nil")
	}
	if _, ok := got.(idempotency.NoOp); ok {
		t.Fatal("fell back to NoOp with Redis up; duplicate events would be reprocessed")
	}

	// Prove it is wired to that server: a claim must be visible in it.
	acquired, err := got.Claim(context.Background(), "evt-1")
	if err != nil {
		t.Fatalf("Claim error = %v", err)
	}
	if !acquired {
		t.Error("first claim was not acquired")
	}
	again, err := got.Claim(context.Background(), "evt-1")
	if err != nil {
		t.Fatalf("second Claim error = %v", err)
	}
	if again {
		t.Error("the same event id was claimed twice; redelivery would notify twice")
	}
}
