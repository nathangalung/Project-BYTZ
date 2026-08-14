package publisher

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

// --- fakes ---

type fakePool struct {
	queryFn func(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	beginFn func(ctx context.Context) (pgx.Tx, error)
	queries int
	mu      sync.Mutex
}

func (p *fakePool) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	p.mu.Lock()
	p.queries++
	p.mu.Unlock()
	if p.queryFn != nil {
		return p.queryFn(ctx, sql, args...)
	}
	return newFakeRows(), nil
}

func (p *fakePool) Begin(ctx context.Context) (pgx.Tx, error) {
	if p.beginFn != nil {
		return p.beginFn(ctx)
	}
	return &fakeTx{}, nil
}

func (p *fakePool) queryCount() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.queries
}

type fakeTx struct {
	queryRowFn func(ctx context.Context, sql string, args ...any) pgx.Row
	execFn     func(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	commitErr  error
	execs      []struct {
		sql  string
		args []any
	}
	committed  bool
	rolledBack bool
}

func (t *fakeTx) Begin(context.Context) (pgx.Tx, error) { return nil, nil }
func (t *fakeTx) CopyFrom(context.Context, pgx.Identifier, []string, pgx.CopyFromSource) (int64, error) {
	return 0, nil
}
func (t *fakeTx) SendBatch(context.Context, *pgx.Batch) pgx.BatchResults { return nil }
func (t *fakeTx) LargeObjects() pgx.LargeObjects                         { return pgx.LargeObjects{} }
func (t *fakeTx) Prepare(context.Context, string, string) (*pgconn.StatementDescription, error) {
	return nil, nil
}
func (t *fakeTx) Query(context.Context, string, ...any) (pgx.Rows, error) { return nil, nil }
func (t *fakeTx) Conn() *pgx.Conn                                         { return nil }

func (t *fakeTx) Commit(context.Context) error   { t.committed = true; return t.commitErr }
func (t *fakeTx) Rollback(context.Context) error { t.rolledBack = true; return nil }

func (t *fakeTx) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	if t.queryRowFn != nil {
		return t.queryRowFn(ctx, sql, args...)
	}
	return &fakeRow{}
}

func (t *fakeTx) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	t.execs = append(t.execs, struct {
		sql  string
		args []any
	}{sql, args})
	if t.execFn != nil {
		return t.execFn(ctx, sql, args...)
	}
	return pgconn.NewCommandTag("UPDATE 1"), nil
}

func (t *fakeTx) execSQL() string {
	var b strings.Builder
	for _, e := range t.execs {
		b.WriteString(e.sql)
	}
	return b.String()
}

type fakeRow struct{ scanFn func(dest ...any) error }

func (r *fakeRow) Scan(dest ...any) error {
	if r.scanFn != nil {
		return r.scanFn(dest...)
	}
	return nil
}

type fakeRows struct {
	scans []func(dest ...any) error
	idx   int
	err   error
}

func newFakeRows(fns ...func(dest ...any) error) *fakeRows {
	return &fakeRows{scans: fns, idx: -1}
}

func (r *fakeRows) Next() bool                                   { r.idx++; return r.idx < len(r.scans) }
func (r *fakeRows) Scan(dest ...any) error                       { return r.scans[r.idx](dest...) }
func (r *fakeRows) Err() error                                   { return r.err }
func (r *fakeRows) Close()                                       {}
func (r *fakeRows) CommandTag() pgconn.CommandTag                { return pgconn.CommandTag{} }
func (r *fakeRows) FieldDescriptions() []pgconn.FieldDescription { return nil }
func (r *fakeRows) Values() ([]any, error)                       { return nil, nil }
func (r *fakeRows) RawValues() [][]byte                          { return nil }
func (r *fakeRows) Conn() *pgx.Conn                              { return nil }

type fakeJetStream struct {
	mu       sync.Mutex
	err      error
	messages []*nats.Msg
	opts     []jetstream.PublishOpt
}

func (j *fakeJetStream) PublishMsg(_ context.Context, m *nats.Msg, opts ...jetstream.PublishOpt) (*jetstream.PubAck, error) {
	j.mu.Lock()
	defer j.mu.Unlock()
	j.messages = append(j.messages, m)
	j.opts = opts
	if j.err != nil {
		return nil, j.err
	}
	return &jetstream.PubAck{Stream: "PAYMENT_EVENTS", Sequence: uint64(len(j.messages))}, nil
}

func (j *fakeJetStream) published() []*nats.Msg {
	j.mu.Lock()
	defer j.mu.Unlock()
	return append([]*nats.Msg(nil), j.messages...)
}

// outboxRowScan fills the six columns pendingEvents selects.
func outboxRowScan(id, eventType string, payload []byte, retry int, traceContext []byte) func(dest ...any) error {
	return func(dest ...any) error {
		*(dest[0].(*string)) = id
		*(dest[1].(*string)) = eventType
		*(dest[2].(*[]byte)) = payload
		*(dest[3].(*time.Time)) = time.Date(2026, 7, 24, 3, 30, 0, 0, time.UTC)
		*(dest[4].(*int)) = retry
		*(dest[5].(*[]byte)) = traceContext
		return nil
	}
}

func claimScan(retry int, err error) func(dest ...any) error {
	return func(dest ...any) error {
		if err != nil {
			return err
		}
		*(dest[0].(*int)) = retry
		return nil
	}
}

// --- tests ---

func TestNew_ConfiguresThePublisher(t *testing.T) {
	p := New(nil, "nats://localhost:4222")
	if p.natsURL != "nats://localhost:4222" {
		t.Errorf("natsURL = %q", p.natsURL)
	}
	if p.stop == nil || p.done == nil {
		t.Error("New left the lifecycle channels nil; Stop would panic")
	}
	select {
	case <-p.stop:
		t.Error("the stop channel is already closed")
	default:
	}
}

func TestStart_ReportsAnUnusableNATSURL(t *testing.T) {
	p := New(nil, "://not-a-url")
	err := p.Start(context.Background())
	if err == nil {
		t.Fatal("Start accepted an unusable NATS URL; the service would boot with no publisher")
	}
	if !strings.Contains(err.Error(), "connect nats") {
		t.Errorf("error = %q, want it to mention connect nats", err.Error())
	}
}

/*
The claim is what lets more than one replica poll the same table. A row another
poller already holds, or already finished, must be skipped rather than
published a second time: JetStream's msgID dedup window is two minutes, and
anything republished outside it reaches the consumer twice - a talent getting a
second "payment released" email for one payout.
*/
func TestClaimAndPublish_SkipsRowsItDoesNotOwn(t *testing.T) {
	tests := []struct {
		name        string
		beginErr    error
		claimScan   func(dest ...any) error
		wantSent    bool
		wantErr     string
		wantPublish int
	}{
		{
			name:        "claimed and published",
			claimScan:   claimScan(0, nil),
			wantSent:    true,
			wantPublish: 1,
		},
		{
			name:      "another poller holds the row",
			claimScan: claimScan(0, pgx.ErrNoRows),
		},
		{
			name:      "the row already exhausted its retries",
			claimScan: claimScan(3, nil),
		},
		{
			name:      "the claim itself fails",
			claimScan: claimScan(0, errors.New("deadlock")),
			wantErr:   "claim outbox event: deadlock",
		},
		{
			name:     "no transaction can be opened",
			beginErr: errors.New("pool exhausted"),
			wantErr:  "begin claim: pool exhausted",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tx := &fakeTx{queryRowFn: func(context.Context, string, ...any) pgx.Row {
				return &fakeRow{scanFn: tt.claimScan}
			}}
			js := &fakeJetStream{}
			p := &OutboxPublisher{
				pool: &fakePool{beginFn: func(context.Context) (pgx.Tx, error) {
					if tt.beginErr != nil {
						return nil, tt.beginErr
					}
					return tx, nil
				}},
				js: js,
			}

			sent, err := p.claimAndPublish(context.Background(),
				outboxRow{id: "evt-1", eventType: "payment.settled", payload: []byte(`{"a":1}`)})

			if tt.wantErr != "" {
				if err == nil || err.Error() != tt.wantErr {
					t.Fatalf("error = %v, want %q", err, tt.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("claimAndPublish: %v", err)
			}
			if sent != tt.wantSent {
				t.Errorf("sent = %v, want %v", sent, tt.wantSent)
			}
			if got := len(js.published()); got != tt.wantPublish {
				t.Errorf("published %d messages, want %d", got, tt.wantPublish)
			}
			if tt.wantSent {
				// Marked published only after JetStream acknowledged, and
				// under the lock that kept other pollers off the row.
				if !strings.Contains(tx.execSQL(), "SET published = true") {
					t.Errorf("a published event was not marked: %s", tx.execSQL())
				}
				if !tx.committed {
					t.Error("the claim was never committed")
				}
			}
		})
	}
}

/*
A publish that fails commits its retry count with the claim. Rolling back would
leave the row at its old count, so it would retry forever and never reach the
dead letter table.
*/
func TestClaimAndPublish_RecordsFailuresAndDeadLetters(t *testing.T) {
	tests := []struct {
		name       string
		retryCount int
		trace      []byte
		wantRetry  int
		wantDLQ    bool
	}{
		{name: "first failure", retryCount: 0, wantRetry: 1},
		{name: "second failure", retryCount: 1, wantRetry: 2},
		{name: "third failure dead letters", retryCount: 2, wantRetry: 3, wantDLQ: true},
		{name: "dead letter keeps the trace context", retryCount: 2, trace: []byte(`{"traceparent":"00-a-b-01"}`), wantRetry: 3, wantDLQ: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tx := &fakeTx{queryRowFn: func(context.Context, string, ...any) pgx.Row {
				return &fakeRow{scanFn: claimScan(tt.retryCount, nil)}
			}}
			p := &OutboxPublisher{
				pool: &fakePool{beginFn: func(context.Context) (pgx.Tx, error) { return tx, nil }},
				js:   &fakeJetStream{err: errors.New("no responders")},
			}

			sent, err := p.claimAndPublish(context.Background(), outboxRow{
				id: "evt-1", eventType: "payment.settled",
				payload: []byte(`{"a":1}`), retryCount: tt.retryCount, traceContext: tt.trace,
			})
			if err != nil {
				t.Fatalf("claimAndPublish: %v", err)
			}
			if sent {
				t.Error("a failed publish was reported as sent")
			}

			sql := tx.execSQL()
			if !strings.Contains(sql, "SET retry_count = $1") {
				t.Errorf("the retry count was not recorded: %s", sql)
			}
			if tx.execs[0].args[0] != tt.wantRetry {
				t.Errorf("retry count = %v, want %d", tx.execs[0].args[0], tt.wantRetry)
			}
			// The failure text is stored so the DLQ viewer shows why.
			if msg, _ := tx.execs[0].args[1].(string); !strings.Contains(msg, "no responders") {
				t.Errorf("error message = %q, want the publish failure", msg)
			}

			dlqWritten := strings.Contains(sql, "INSERT INTO dead_letter_events")
			if dlqWritten != tt.wantDLQ {
				t.Errorf("dead lettered = %v, want %v", dlqWritten, tt.wantDLQ)
			}
			if !tx.committed {
				t.Error("the failure was rolled back, so the retry count never advanced")
			}
			if tt.wantDLQ {
				traceArg := tx.execs[1].args[4]
				if len(tt.trace) > 0 {
					if traceArg == nil {
						t.Error("the dead letter row dropped the trace context")
					}
				} else if traceArg != nil {
					t.Errorf("trace context = %v, want nil when there was none", traceArg)
				}
			}
		})
	}
}

// A row that was published but whose bookkeeping fails must not be reported as
// sent, so the failure is visible rather than silently swallowed.
func TestClaimAndPublish_SurfacesBookkeepingFailures(t *testing.T) {
	tests := []struct {
		name       string
		execErr    error
		commitErr  error
		publishErr error
		wantErr    string
	}{
		{name: "marking published fails", execErr: errors.New("disk full"), wantErr: "mark outbox published: disk full"},
		{name: "commit after publishing fails", commitErr: errors.New("connection lost"), wantErr: "commit publish: connection lost"},
		{
			name:       "commit after a publish failure fails",
			publishErr: errors.New("no responders"), commitErr: errors.New("connection lost"),
			wantErr: "commit publish failure: connection lost",
		},
		{
			// markRetryTx and moveToDLQTx log rather than return, so a failure
			// there must not mask the commit outcome.
			name:       "bookkeeping writes fail after a publish failure",
			publishErr: errors.New("no responders"), execErr: errors.New("disk full"),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tx := &fakeTx{
				queryRowFn: func(context.Context, string, ...any) pgx.Row {
					return &fakeRow{scanFn: claimScan(2, nil)}
				},
				execFn: func(context.Context, string, ...any) (pgconn.CommandTag, error) {
					return pgconn.CommandTag{}, tt.execErr
				},
				commitErr: tt.commitErr,
			}
			p := &OutboxPublisher{
				pool: &fakePool{beginFn: func(context.Context) (pgx.Tx, error) { return tx, nil }},
				js:   &fakeJetStream{err: tt.publishErr},
			}

			sent, err := p.claimAndPublish(context.Background(), outboxRow{
				id: "evt-1", eventType: "payment.settled", payload: []byte(`{"a":1}`), retryCount: 2,
			})
			if sent {
				t.Error("reported as sent despite the failure")
			}
			if tt.wantErr == "" {
				if err != nil {
					t.Fatalf("a logged bookkeeping failure was returned: %v", err)
				}
				return
			}
			if err == nil || err.Error() != tt.wantErr {
				t.Fatalf("error = %v, want %q", err, tt.wantErr)
			}
		})
	}
}

// A stored trace context puts the publish span in the same trace as the
// request that wrote the event; a corrupt one must degrade to an untraced
// publish rather than dropping the event.
func TestClaimAndPublish_RestoresTheStoredTraceContext(t *testing.T) {
	otel.SetTextMapPropagator(propagation.TraceContext{})
	tp := sdktrace.NewTracerProvider()
	defer func() { _ = tp.Shutdown(context.Background()) }()
	otel.SetTracerProvider(tp)

	ctx, span := tp.Tracer("test").Start(context.Background(), "webhook")
	carrier := map[string]string{}
	otel.GetTextMapPropagator().Inject(ctx, propagation.MapCarrier(carrier))
	span.End()
	stored, err := json.Marshal(carrier)
	if err != nil {
		t.Fatalf("marshal carrier: %v", err)
	}
	wantTraceID := span.SpanContext().TraceID().String()

	tests := []struct {
		name          string
		trace         []byte
		wantSameTrace bool
	}{
		{name: "valid trace context joins the original trace", trace: stored, wantSameTrace: true},
		{name: "corrupt trace context still publishes", trace: []byte(`{not json`)},
		{name: "no trace context still publishes", trace: nil},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tx := &fakeTx{queryRowFn: func(context.Context, string, ...any) pgx.Row {
				return &fakeRow{scanFn: claimScan(0, nil)}
			}}
			js := &fakeJetStream{}
			p := &OutboxPublisher{
				pool: &fakePool{beginFn: func(context.Context) (pgx.Tx, error) { return tx, nil }},
				js:   js,
			}

			sent, err := p.claimAndPublish(context.Background(), outboxRow{
				id: "evt-1", eventType: "payment.settled", payload: []byte(`{"a":1}`), traceContext: tt.trace,
			})
			if err != nil || !sent {
				t.Fatalf("claimAndPublish = (%v, %v), want (true, nil)", sent, err)
			}

			msgs := js.published()
			if len(msgs) != 1 {
				t.Fatalf("published %d messages, want 1", len(msgs))
			}
			var envelope Envelope
			if err := json.Unmarshal(msgs[0].Data, &envelope); err != nil {
				t.Fatalf("unmarshal envelope: %v", err)
			}
			if tt.wantSameTrace {
				if envelope.CorrelationID != wantTraceID {
					t.Errorf("correlationId = %q, want the originating trace %q", envelope.CorrelationID, wantTraceID)
				}
			} else if envelope.CorrelationID == wantTraceID {
				t.Error("an unusable trace context was still joined to the original trace")
			}
		})
	}
}

// The published message carries the outbox id as the JetStream msgID, which is
// what the broker deduplicates on.
func TestPublishWithTrace_StampsTheMessage(t *testing.T) {
	js := &fakeJetStream{}
	p := &OutboxPublisher{js: js}

	created := time.Date(2026, 7, 24, 10, 30, 0, 0, time.FixedZone("WIB", 7*3600))
	err := p.publishWithTrace(context.Background(), "evt-1", "payment.released",
		[]byte(`{"amount":7150000}`), created)
	if err != nil {
		t.Fatalf("publishWithTrace: %v", err)
	}

	msgs := js.published()
	if len(msgs) != 1 {
		t.Fatalf("published %d messages, want 1", len(msgs))
	}
	if msgs[0].Subject != "payment.released" {
		t.Errorf("subject = %q, want the event type", msgs[0].Subject)
	}
	if len(js.opts) != 1 {
		t.Errorf("published with %d options, want the msgID option", len(js.opts))
	}
	// Consumers read trace context off the headers.
	if msgs[0].Header == nil {
		t.Error("the message carries no headers")
	}

	var envelope Envelope
	if err := json.Unmarshal(msgs[0].Data, &envelope); err != nil {
		t.Fatalf("unmarshal envelope: %v", err)
	}
	if envelope.ID != "evt-1" || envelope.Type != "payment.released" || envelope.Source != "payment-service" {
		t.Errorf("envelope = %+v", envelope)
	}
	if envelope.Timestamp != "2026-07-24T03:30:00Z" {
		t.Errorf("timestamp = %q, want it normalised to UTC", envelope.Timestamp)
	}
}

func TestPublishWithTrace_ReportsFailures(t *testing.T) {
	tests := []struct {
		name    string
		payload []byte
		jsErr   error
		wantErr string
	}{
		{name: "broker rejects the publish", payload: []byte(`{"a":1}`), jsErr: errors.New("no responders"), wantErr: "no responders"},
		// A payload that is not valid JSON cannot be embedded in the envelope.
		{name: "payload is not valid json", payload: []byte(`{not json`), wantErr: "marshal envelope"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			p := &OutboxPublisher{js: &fakeJetStream{err: tt.jsErr}}
			err := p.publishWithTrace(context.Background(), "evt-1", "payment.settled", tt.payload, time.Now())
			if err == nil {
				t.Fatal("a failed publish was reported as success")
			}
			if !strings.Contains(err.Error(), tt.wantErr) {
				t.Errorf("error = %q, want it to mention %q", err.Error(), tt.wantErr)
			}
		})
	}
}

func TestPendingEvents(t *testing.T) {
	tests := []struct {
		name    string
		queryFn func(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
		want    int
		wantErr string
	}{
		{
			name: "a batch of candidates",
			queryFn: func(context.Context, string, ...any) (pgx.Rows, error) {
				return newFakeRows(
					outboxRowScan("evt-1", "payment.settled", []byte(`{"a":1}`), 0, nil),
					outboxRowScan("evt-2", "payment.released", []byte(`{"b":2}`), 1, nil),
				), nil
			},
			want: 2,
		},
		{
			name:    "nothing pending",
			queryFn: func(context.Context, string, ...any) (pgx.Rows, error) { return newFakeRows(), nil },
		},
		{
			name:    "the query fails",
			queryFn: func(context.Context, string, ...any) (pgx.Rows, error) { return nil, errors.New("timeout") },
			wantErr: "query outbox: timeout",
		},
		{
			name: "a row cannot be scanned",
			queryFn: func(context.Context, string, ...any) (pgx.Rows, error) {
				return newFakeRows(func(...any) error { return errors.New("bad column") }), nil
			},
			wantErr: "scan outbox row: bad column",
		},
		{
			name: "the result set is cut short",
			queryFn: func(context.Context, string, ...any) (pgx.Rows, error) {
				return &fakeRows{idx: -1, err: errors.New("connection lost")}, nil
			},
			wantErr: "connection lost",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			p := &OutboxPublisher{pool: &fakePool{queryFn: tt.queryFn}}

			got, err := p.pendingEvents(context.Background())
			if tt.wantErr != "" {
				if err == nil || err.Error() != tt.wantErr {
					t.Fatalf("error = %v, want %q", err, tt.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("pendingEvents: %v", err)
			}
			if len(got) != tt.want {
				t.Errorf("got %d candidates, want %d", len(got), tt.want)
			}
		})
	}
}

// One row failing to claim must not abandon the rest of the batch.
func TestPollAndPublish_CountsOnlyWhatItPublished(t *testing.T) {
	tests := []struct {
		name     string
		rows     []func(dest ...any) error
		beginErr error
		claims   []func(dest ...any) error
		want     int
		wantErr  string
	}{
		{
			name: "all three published",
			rows: []func(dest ...any) error{
				outboxRowScan("evt-1", "payment.settled", []byte(`{}`), 0, nil),
				outboxRowScan("evt-2", "payment.released", []byte(`{}`), 0, nil),
				outboxRowScan("evt-3", "payment.refunded", []byte(`{}`), 0, nil),
			},
			claims: []func(dest ...any) error{claimScan(0, nil), claimScan(0, nil), claimScan(0, nil)},
			want:   3,
		},
		{
			name: "one held elsewhere, one failing, one published",
			rows: []func(dest ...any) error{
				outboxRowScan("evt-1", "payment.settled", []byte(`{}`), 0, nil),
				outboxRowScan("evt-2", "payment.released", []byte(`{}`), 0, nil),
				outboxRowScan("evt-3", "payment.refunded", []byte(`{}`), 0, nil),
			},
			claims: []func(dest ...any) error{
				claimScan(0, pgx.ErrNoRows),
				claimScan(0, errors.New("deadlock")),
				claimScan(0, nil),
			},
			want: 1,
		},
		{
			name:    "the candidate query fails",
			wantErr: "query outbox: timeout",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			claim := 0
			pool := &fakePool{
				queryFn: func(context.Context, string, ...any) (pgx.Rows, error) {
					if tt.rows == nil {
						return nil, errors.New("timeout")
					}
					return newFakeRows(tt.rows...), nil
				},
				beginFn: func(context.Context) (pgx.Tx, error) {
					scan := tt.claims[claim]
					claim++
					return &fakeTx{queryRowFn: func(context.Context, string, ...any) pgx.Row {
						return &fakeRow{scanFn: scan}
					}}, nil
				},
			}
			p := &OutboxPublisher{pool: pool, js: &fakeJetStream{}}

			got, err := p.pollAndPublish(context.Background())
			if tt.wantErr != "" {
				if err == nil || err.Error() != tt.wantErr {
					t.Fatalf("error = %v, want %q", err, tt.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("pollAndPublish: %v", err)
			}
			if got != tt.want {
				t.Errorf("published %d, want %d", got, tt.want)
			}
		})
	}
}

// The loop keeps polling until it is told to stop, by either route.
func TestLoop_PollsUntilStopped(t *testing.T) {
	tests := []struct {
		name string
		stop func(p *OutboxPublisher, cancel context.CancelFunc)
	}{
		{name: "stopped by the channel", stop: func(p *OutboxPublisher, _ context.CancelFunc) { close(p.stop) }},
		{name: "stopped by the context", stop: func(_ *OutboxPublisher, cancel context.CancelFunc) { cancel() }},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			polled := make(chan struct{}, 4)
			calls := 0
			var mu sync.Mutex
			pool := &fakePool{queryFn: func(context.Context, string, ...any) (pgx.Rows, error) {
				mu.Lock()
				calls++
				n := calls
				mu.Unlock()
				select {
				case polled <- struct{}{}:
				default:
				}
				// The first poll fails and the second returns work, so both
				// reporting branches in the loop run.
				if n == 1 {
					return nil, errors.New("timeout")
				}
				return newFakeRows(outboxRowScan("evt-1", "payment.settled", []byte(`{}`), 0, nil)), nil
			}}
			p := &OutboxPublisher{
				pool: pool,
				js:   &fakeJetStream{},
				stop: make(chan struct{}),
				done: make(chan struct{}),
			}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()

			go p.loop(ctx)

			// Two ticks, one second apart, to reach both branches.
			for i := range 2 {
				select {
				case <-polled:
				case <-time.After(5 * time.Second):
					t.Fatalf("the loop never polled (tick %d)", i+1)
				}
			}

			tt.stop(p, cancel)
			select {
			case <-p.done:
			case <-time.After(5 * time.Second):
				t.Fatal("the loop did not exit")
			}
			if pool.queryCount() < 2 {
				t.Errorf("polled %d times, want at least 2", pool.queryCount())
			}
		})
	}
}

/*
Stop waits for the in-flight batch before letting the connection go. It used to
close the stop channel and the connection back to back, and main closes the
database pool one line later: a SIGTERM landing inside a publish could either
republish the event on the next boot, delivering it twice, or burn a retry
count on a shutdown rather than a fault.
*/
func TestStop_WaitsForTheLoopToFinish(t *testing.T) {
	p := New(nil, "nats://localhost:4222")

	inLoop := make(chan struct{})
	go func() {
		defer close(p.done)
		close(inLoop)
		<-p.stop
		// Stand in for a publish still in flight when the signal arrives.
		time.Sleep(50 * time.Millisecond)
	}()
	<-inLoop

	start := time.Now()
	p.Stop()
	if elapsed := time.Since(start); elapsed < 50*time.Millisecond {
		t.Errorf("Stop returned after %v, before the loop had finished", elapsed)
	}
	select {
	case <-p.done:
	default:
		t.Error("Stop returned with the loop still running")
	}
}

// A loop that never finishes must not hold shutdown open forever; Docker kills
// the container thirty seconds after SIGTERM.
func TestStop_GivesUpOnALoopThatWillNotFinish(t *testing.T) {
	orig := stopDrainTimeout
	stopDrainTimeout = 20 * time.Millisecond
	defer func() { stopDrainTimeout = orig }()

	p := New(nil, "nats://localhost:4222")
	// done is never closed: the loop is wedged.

	done := make(chan struct{})
	go func() { p.Stop(); close(done) }()

	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("Stop blocked past its give-up timeout")
	}
}

/*
Start must not fail when NATS is down. The connection is opened with
RetryOnFailedConnect and unlimited reconnects, so the service boots and the
outbox drains once the broker returns; failing here instead would take
payment-service down with NATS and stop it accepting webhooks, which is the one
thing it must keep doing.
*/
func TestStart_BootsWithTheBrokerDownAndStopsCleanly(t *testing.T) {
	// A port with nothing behind it, so no server is needed either way.
	p := New(nil, "nats://127.0.0.1:14222")

	if err := p.Start(context.Background()); err != nil {
		t.Fatalf("Start failed with the broker down: %v", err)
	}
	if p.nc == nil {
		t.Error("Start left no connection to drain on shutdown")
	}
	if p.js == nil {
		t.Error("Start left no JetStream handle, so nothing would ever publish")
	}

	// Stop drains rather than closing, so buffered publishes flush, and it must
	// return rather than hanging on a connection that never came up.
	done := make(chan struct{})
	go func() { p.Stop(); close(done) }()
	select {
	case <-done:
	case <-time.After(15 * time.Second):
		t.Fatal("Stop hung on a connection that never established")
	}
}
