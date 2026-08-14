package consumer

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/nats-io/nats.go/jetstream"
)

// The three fakes below embed their interface and leave it nil, so only the
// methods declared here are reachable. Anything else the subscribe path starts
// calling panics instead of silently returning a zero value, which is the
// point: the test says what the production code is allowed to touch.

type fakeJS struct {
	streams map[string]jetstream.Stream
	errs    map[string]error

	asked []string
}

func (f *fakeJS) Stream(_ context.Context, name string) (jetstream.Stream, error) {
	f.asked = append(f.asked, name)
	if err, ok := f.errs[name]; ok {
		return nil, err
	}
	return f.streams[name], nil
}

var _ streamOpener = (*fakeJS)(nil)

type fakeStream struct {
	jetstream.Stream

	cons jetstream.Consumer
	err  error

	gotCfg jetstream.ConsumerConfig
}

func (f *fakeStream) CreateOrUpdateConsumer(_ context.Context, cfg jetstream.ConsumerConfig) (jetstream.Consumer, error) {
	f.gotCfg = cfg
	if f.err != nil {
		return nil, f.err
	}
	return f.cons, nil
}

type fakeJSConsumer struct {
	jetstream.Consumer

	cc  jetstream.ConsumeContext
	err error

	handler jetstream.MessageHandler
}

func (f *fakeJSConsumer) Consume(h jetstream.MessageHandler, _ ...jetstream.PullConsumeOpt) (jetstream.ConsumeContext, error) {
	f.handler = h
	if f.err != nil {
		return nil, f.err
	}
	return f.cc, nil
}

// newFakeJS wires one working stream under the given name.
func newFakeJS(name string) (*fakeJS, *fakeStream, *fakeJSConsumer) {
	cons := &fakeJSConsumer{cc: newFakeConsumeContext(true)}
	st := &fakeStream{cons: cons}
	return &fakeJS{streams: map[string]jetstream.Stream{name: st}}, st, cons
}

// The durable consumer's config is the contract with JetStream. AckExplicit
// plus MaxDeliver is what makes parkDeadLetter reachable at all: with an auto
// ack policy a failing handler would never be redelivered, and with an
// unbounded MaxDeliver isFinalDelivery would never be true, so a poison event
// would loop instead of landing in dead_letter_events.
func TestSubscribeStream_RegistersDurableConsumerWithAckPolicy(t *testing.T) {
	js, st, cons := newFakeJS("PROJECT_EVENTS")
	c := &Consumer{js: js}

	err := c.subscribeStream(context.Background(), streamConsumerDef{
		Stream:  "PROJECT_EVENTS",
		Durable: "notif-project",
	})
	if err != nil {
		t.Fatalf("subscribeStream error = %v", err)
	}

	if got := st.gotCfg.Durable; got != "notif-project" {
		t.Errorf("Durable = %q, want %q; an ephemeral consumer loses its position on restart", got, "notif-project")
	}
	if got := st.gotCfg.AckPolicy; got != jetstream.AckExplicitPolicy {
		t.Errorf("AckPolicy = %v, want AckExplicitPolicy; anything else acks before the handler runs", got)
	}
	if got := st.gotCfg.MaxDeliver; got != maxDeliver {
		t.Errorf("MaxDeliver = %d, want %d, which is what isFinalDelivery compares against", got, maxDeliver)
	}
	if got := st.gotCfg.AckWait; got != 30*time.Second {
		t.Errorf("AckWait = %v, want 30s", got)
	}

	if cons.handler == nil {
		t.Fatal("Consume was called without a handler")
	}
	if len(c.contexts) != 1 {
		t.Fatalf("contexts = %d, want 1; an unrecorded context is never drained on shutdown", len(c.contexts))
	}
}

// The recorded handler must be the one that processes messages. Registering
// Consume with a handler that never reaches handleMessage would leave the
// service connected and silent.
func TestSubscribeStream_HandlerReachesHandleMessage(t *testing.T) {
	js, _, cons := newFakeJS("CHAT_EVENTS")
	st := &countingStore{}
	c, _, channels := newTestConsumer(st, fakeQuerier{ownerID: "owner-1"}, nil)
	c.js = js

	if err := c.subscribeStream(context.Background(), streamConsumerDef{
		Stream:  "CHAT_EVENTS",
		Durable: "notif-chat",
	}); err != nil {
		t.Fatalf("subscribeStream error = %v", err)
	}

	msg := &fakeMsg{
		subject: "chat.message.sent",
		data:    mustEvent(t, "evt-1", "chat.message.sent", `{"conversationId":"conv-1","messageId":"m-1"}`),
	}
	cons.handler(msg)

	if got := channels.publishedChannels(); len(got) != 1 || got[0] != "chat:conv-1" {
		t.Errorf("channels = %v, want [chat:conv-1]; the registered handler did not process the message", got)
	}
	if acks, _ := msg.counts(); acks != 1 {
		t.Errorf("acks = %d, want 1", acks)
	}
}

// Each failure has to name the step that failed. "get stream" and "create
// consumer" call for different operator action, and a context that was never
// created must not be recorded as drainable.
func TestSubscribeStream_ErrorsNameTheFailingStep(t *testing.T) {
	errBoom := errors.New("boom")

	tests := []struct {
		name    string
		js      func() *fakeJS
		wantErr string
	}{
		{
			name: "stream missing",
			js: func() *fakeJS {
				return &fakeJS{errs: map[string]error{"PROJECT_EVENTS": errBoom}}
			},
			wantErr: "get stream PROJECT_EVENTS",
		},
		{
			name: "consumer rejected",
			js: func() *fakeJS {
				return &fakeJS{streams: map[string]jetstream.Stream{
					"PROJECT_EVENTS": &fakeStream{err: errBoom},
				}}
			},
			wantErr: "create consumer notif-project",
		},
		{
			name: "consume refused",
			js: func() *fakeJS {
				return &fakeJS{streams: map[string]jetstream.Stream{
					"PROJECT_EVENTS": &fakeStream{cons: &fakeJSConsumer{err: errBoom}},
				}}
			},
			wantErr: "start consuming notif-project",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := &Consumer{js: tt.js()}

			err := c.subscribeStream(context.Background(), streamConsumerDef{
				Stream:  "PROJECT_EVENTS",
				Durable: "notif-project",
			})
			if err == nil {
				t.Fatal("subscribeStream returned nil on a failing dependency")
			}
			if !strings.Contains(err.Error(), tt.wantErr) {
				t.Errorf("error = %q, want it to name %q", err.Error(), tt.wantErr)
			}
			if !errors.Is(err, errBoom) {
				t.Errorf("error = %v, want it to wrap the underlying cause", err)
			}
			if len(c.contexts) != 0 {
				t.Errorf("contexts = %d, want 0; Close would drain something that was never consuming", len(c.contexts))
			}
		})
	}
}

// One absent stream must cost only its own subjects. Aborting the loop would
// leave the service connected and processing nothing because a single stream
// had not been created yet.
func TestSubscribeAll_ContinuesAfterOneStreamFails(t *testing.T) {
	logs := captureLogs(t)

	all := []string{
		"PROJECT_EVENTS", "PAYMENT_EVENTS", "TALENT_EVENTS",
		"MILESTONE_EVENTS", "CHAT_EVENTS", "SYSTEM_EVENTS",
	}
	js := &fakeJS{
		streams: map[string]jetstream.Stream{},
		errs:    map[string]error{"PROJECT_EVENTS": errors.New("stream not found")},
	}
	for _, name := range all[1:] {
		js.streams[name] = &fakeStream{cons: &fakeJSConsumer{cc: newFakeConsumeContext(true)}}
	}

	c := &Consumer{js: js}
	c.subscribeAll(context.Background())

	if len(js.asked) != len(all) {
		t.Fatalf("streams attempted = %v, want all %d", js.asked, len(all))
	}
	if len(c.contexts) != len(all)-1 {
		t.Errorf("subscriptions = %d, want %d; one missing stream took the others down", len(c.contexts), len(all)-1)
	}
	if out := logs.String(); !strings.Contains(out, "failed to subscribe to stream") {
		t.Errorf("the skipped stream left no warning, so a silent consumer would be invisible.\ngot: %s", out)
	}
}

// Every stream subscribing must record every context, or shutdown drains only
// part of the in-flight work.
func TestSubscribeAll_RecordsEverySubscription(t *testing.T) {
	js := &fakeJS{streams: map[string]jetstream.Stream{}}
	for _, name := range []string{
		"PROJECT_EVENTS", "PAYMENT_EVENTS", "TALENT_EVENTS",
		"MILESTONE_EVENTS", "CHAT_EVENTS", "SYSTEM_EVENTS",
	} {
		js.streams[name] = &fakeStream{cons: &fakeJSConsumer{cc: newFakeConsumeContext(true)}}
	}

	c := &Consumer{js: js}
	c.subscribeAll(context.Background())

	if len(c.contexts) != 6 {
		t.Errorf("contexts = %d, want 6", len(c.contexts))
	}
}
