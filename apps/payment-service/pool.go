package main

import (
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Connection budget, shared across the stack.
//
// DATABASE_URL points at pgbouncer, which runs POOL_MODE=transaction with
// MAX_CLIENT_CONN=200 and DEFAULT_POOL_SIZE=20 (docker-compose.prod.yml).
// Those two bound different things: MAX_CLIENT_CONN caps how many client
// connections pgbouncer will accept, DEFAULT_POOL_SIZE caps how many server
// backends the whole platform can hold a transaction on at once. A client
// connection only occupies a server slot for the duration of a transaction,
// which is why the client pools may - and should - sum to more than 20.
//
// Six services share that pgbouncer: auth-service, project-service and
// project-worker through postgres.js at max 10 each (packages/db/src/client.ts)
// = 30, plus the three Go services here. ai-service is not in the budget; it
// connects straight to postgres.
//
// pgxpool left unconfigured sets MaxConns to max(4, runtime.NumCPU())
// (pgxpool/pool.go:318-323), so the Go side's ceiling was a property of
// whatever host the container landed on - 12 across three services on a
// 4-vCPU VPS, 48 on a 16-vCPU one - and it moved without anyone changing a
// line. Pinning it makes the arithmetic fixed: 30 (TS) + 16 (Go: 6 here,
// 6 notification, 4 admin) = 46 client connections, 23% of MAX_CLIENT_CONN,
// with a worst-case simultaneous demand of 46 against 20 server slots.
// Over-subscribed by design - pgbouncer queues the excess, which is the point
// of transaction pooling - but bounded at 2.3x instead of host-dependent.
//
// maxConns 6 here: HTTP payment requests, Midtrans settlement callbacks and
// the disbursement reconciliation sweep, which each hold one connection.
const (
	maxConns = 6
	// Two warm, so the first request after an idle period does not pay a TCP
	// handshake plus pgbouncer auth. Not more: idle connections held against
	// pgbouncer are client slots nobody is using.
	minConns = 2
	// Recycled well inside pgbouncer's own server_lifetime so a connection is
	// retired by this side deliberately rather than dropped mid-query.
	maxConnLifetime = 30 * time.Minute
	// A burst's extra connections are handed back rather than parked for the
	// 30 minutes pgx defaults to.
	maxConnIdleTime = 5 * time.Minute
	// Half a stale connection is found on the next check rather than by a
	// request failing on it.
	healthCheckPeriod = 30 * time.Second
)

// newPoolConfig parses the DSN and applies the connection budget above.
//
// ParseConfig rather than pgxpool.New so the sizing is explicit and testable
// without a database. The production DSN carries default_query_exec_mode=exec
// as a query parameter, which ParseConfig has to accept - a failure there
// would be a boot regression, so a test pins it.
func newPoolConfig(dsn string) (*pgxpool.Config, error) {
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("parse database url: %w", err)
	}
	cfg.MaxConns = maxConns
	cfg.MinConns = minConns
	cfg.MaxConnLifetime = maxConnLifetime
	cfg.MaxConnIdleTime = maxConnIdleTime
	cfg.HealthCheckPeriod = healthCheckPeriod
	return cfg, nil
}
