package consumer

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"log/slog"
	"runtime/debug"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kerjacus/notification-service/internal/idempotency"
	"github.com/kerjacus/notification-service/internal/notify"
	"github.com/kerjacus/notification-service/internal/observability"
	"github.com/kerjacus/notification-service/internal/sender"
	"github.com/kerjacus/notification-service/internal/store"
	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
)

var tracer = otel.Tracer("notification-service-consumer")

// NATSEvent mirrors the shared event envelope.
// CorrelationID is the publisher's trace_id, used to correlate downstream
// processing with the original request across services.
type NATSEvent struct {
	ID            string          `json:"id"`
	Type          string          `json:"type"`
	Source        string          `json:"source"`
	Timestamp     string          `json:"timestamp"`
	CorrelationID string          `json:"correlationId,omitempty"`
	Data          json.RawMessage `json:"data"`
}

// NotificationSendPayload for notification.send events.
type NotificationSendPayload struct {
	UserID string `json:"userId"`
	Type   string `json:"type"`
	// A publisher that knows its wording belongs in the catalog sends a key and
	// its params; one that does not sends title and message and the reader falls
	// back to them. Both are carried because this subject is the generic trigger
	// and not every publisher is ours to translate.
	TemplateKey    string         `json:"templateKey,omitempty"`
	TemplateParams map[string]any `json:"templateParams,omitempty"`
	Title          string         `json:"title"`
	Message        string         `json:"message"`
	Link           string         `json:"link,omitempty"`
	Channels       []string       `json:"channels"`
}

// ChatMessageSentPayload for chat.message.sent events.
type ChatMessageSentPayload struct {
	MessageID      string `json:"messageId"`
	ConversationID string `json:"conversationId"`
	SenderID       string `json:"senderId"`
	SenderType     string `json:"senderType"`
}

// ProjectStatusChangedPayload for project.status.changed events.
type ProjectStatusChangedPayload struct {
	ProjectID  string  `json:"projectId"`
	FromStatus *string `json:"fromStatus"`
	ToStatus   string  `json:"toStatus"`
	ChangedBy  string  `json:"changedBy"`
	Reason     string  `json:"reason,omitempty"`
}

// PaymentReleasedPayload for payment.released events.
type PaymentReleasedPayload struct {
	ProjectID     string `json:"projectId"`
	MilestoneID   string `json:"milestoneId"`
	TalentID      string `json:"talentId"`
	Amount        int    `json:"amount"`
	TransactionID string `json:"transactionId"`
}

// MilestoneSubmittedPayload for milestone.submitted events.
type MilestoneSubmittedPayload struct {
	MilestoneID string `json:"milestoneId"`
	ProjectID   string `json:"projectId"`
	TalentID    string `json:"talentId"`
}

// MilestoneRevisionPayload carries the escalation flag alongside the milestone.
// The project service decides it, because FREE_MILESTONE_REVISIONS lives in
// packages/shared and a second copy here is the drift this repo keeps paying for.
type MilestoneRevisionPayload struct {
	MilestoneID string `json:"milestoneId"`
	ProjectID   string `json:"projectId"`
	TalentID    string `json:"talentId"`
	Escalated   bool   `json:"escalated"`
}

// MilestoneApprovedPayload for milestone.approved events.
type MilestoneApprovedPayload struct {
	MilestoneID string `json:"milestoneId"`
	ProjectID   string `json:"projectId"`
	TalentID    string `json:"talentId"`
	Amount      int    `json:"amount"`
	// "temporal_auto_release" when the 14-day timer approved the milestone
	// rather than the owner. Empty on the manual path.
	Source string `json:"source"`
}

// streamConsumerDef pairs a JetStream stream name with its durable consumer name.
type streamConsumerDef struct {
	Stream  string
	Durable string
}

// Consumer subscribes to NATS JetStream and processes notification events.
// JetStream drops the message after this many tries.
const maxDeliver = 3

// How long JetStream waits for an ack before redelivering. Refreshed while a
// handler runs, so it bounds the silence of a dead process rather than the
// runtime of a live one.
//
// It must stay longer than idempotency.LeaseTTL: both deadlines run from the
// same last heartbeat, and the claim has to be free before the redelivery it
// governs arrives. consumer_timing_test.go holds that relation.
const ackWait = 30 * time.Second

// How often a running handler tells JetStream it is alive and pushes its
// idempotency lease forward. Short enough that a lease is refreshed twice
// before it could lapse.
//
// A var rather than a const so the beat is reachable in a test without an
// eight second wait, the same reason drainTimeout is one.
var heartbeatInterval = 8 * time.Second

// Shutdown budget for in-flight handlers. Small on purpose: it is spent after
// the HTTP server is already down, and both halves have to fit in the 30s the
// container gets before SIGKILL.
//
// A var rather than a const so the timeout path is testable without a 5s test.
var drainTimeout = 5 * time.Second

// Querier is the pgxpool.Pool subset used for lookups.
type Querier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// EmailDeliverer is the *sender.EmailSender subset used here. Narrow so a test
// can make delivery fail; the constructor still takes the concrete sender.
type EmailDeliverer interface {
	Send(ctx context.Context, in sender.SendEmailInput) error
}

// ChannelPublisher is the *sender.CentrifugoSender subset used here.
type ChannelPublisher interface {
	Publish(ctx context.Context, channel string, data interface{}) error
	PublishUserNotification(ctx context.Context, userID string, notification interface{}) error
}

// streamOpener is the jetstream.JetStream subset used here. Narrow so the
// subscribe path is reachable without a broker; Start still assigns the real
// JetStream context.
type streamOpener interface {
	Stream(ctx context.Context, stream string) (jetstream.Stream, error)
}

type Consumer struct {
	store      store.StoreInterface
	db         Querier
	email      EmailDeliverer
	centrifugo ChannelPublisher
	idem       idempotency.Idempotency
	nc         *nats.Conn
	js         streamOpener
	contexts   []jetstream.ConsumeContext
	closeOnce  sync.Once
}

// Compile-time checks that the real senders satisfy the narrow seams.
var (
	_ EmailDeliverer   = (*sender.EmailSender)(nil)
	_ ChannelPublisher = (*sender.CentrifugoSender)(nil)
	_ streamOpener     = (jetstream.JetStream)(nil)
)

func New(notifStore *store.Store, db *pgxpool.Pool, emailSender *sender.EmailSender, centrifugoSender *sender.CentrifugoSender, idem idempotency.Idempotency) *Consumer {
	if idem == nil {
		idem = idempotency.NoOp{}
	}
	return &Consumer{
		store:      notifStore,
		db:         db,
		email:      emailSender,
		centrifugo: centrifugoSender,
		idem:       idem,
	}
}

func (c *Consumer) Start(ctx context.Context, natsURL string) error {
	nc, err := nats.Connect(natsURL,
		nats.RetryOnFailedConnect(true),
		nats.MaxReconnects(-1),
		nats.ReconnectWait(2*time.Second),
		nats.DisconnectErrHandler(func(_ *nats.Conn, err error) {
			slog.Warn("nats disconnected", "error", err)
		}),
		nats.ReconnectHandler(func(_ *nats.Conn) {
			slog.Info("nats reconnected")
		}),
	)
	if err != nil {
		return fmt.Errorf("connect to nats: %w", err)
	}
	c.nc = nc

	js, err := jetstream.New(nc)
	if err != nil {
		return fmt.Errorf("create jetstream context: %w", err)
	}
	c.js = js

	c.subscribeAll(ctx)

	return nil
}

// subscribeAll attaches a durable consumer to each domain stream.
//
// Split from Start so the continue-on-error policy is reachable without a
// broker. One stream that does not exist yet must not cost the other five:
// the alternative is a service that processes nothing because CHAT_EVENTS was
// created late.
func (c *Consumer) subscribeAll(ctx context.Context) {
	streams := []streamConsumerDef{
		{Stream: "PROJECT_EVENTS", Durable: "notif-project"},
		{Stream: "PAYMENT_EVENTS", Durable: "notif-payment"},
		{Stream: "TALENT_EVENTS", Durable: "notif-talent"},
		{Stream: "MILESTONE_EVENTS", Durable: "notif-milestone"},
		{Stream: "CHAT_EVENTS", Durable: "notif-chat"},
		{Stream: "SYSTEM_EVENTS", Durable: "notif-system"},
	}

	for _, def := range streams {
		if err := c.subscribeStream(ctx, def); err != nil {
			// Log and continue — stream might not exist yet.
			slog.Warn("failed to subscribe to stream", "stream", def.Stream, "error", err)
			continue
		}
		slog.Info("subscribed to stream", "stream", def.Stream, "durable", def.Durable)
	}
}

func (c *Consumer) subscribeStream(ctx context.Context, def streamConsumerDef) error {
	stream, err := c.js.Stream(ctx, def.Stream)
	if err != nil {
		return fmt.Errorf("get stream %s: %w", def.Stream, err)
	}

	cons, err := stream.CreateOrUpdateConsumer(ctx, jetstream.ConsumerConfig{
		Durable:    def.Durable,
		AckPolicy:  jetstream.AckExplicitPolicy,
		AckWait:    ackWait,
		MaxDeliver: maxDeliver,
	})
	if err != nil {
		return fmt.Errorf("create consumer %s: %w", def.Durable, err)
	}

	cc, err := cons.Consume(func(msg jetstream.Msg) {
		c.handleMessage(ctx, msg)
	})
	if err != nil {
		return fmt.Errorf("start consuming %s: %w", def.Durable, err)
	}

	c.contexts = append(c.contexts, cc)
	return nil
}

func (c *Consumer) handleMessage(ctx context.Context, msg jetstream.Msg) {
	hdrs := nats.Header(msg.Headers())
	ctx = observability.ExtractNATSHeaders(ctx, hdrs)

	ctx, span := tracer.Start(ctx, fmt.Sprintf("nats.consume %s", msg.Subject()),
		trace.WithSpanKind(trace.SpanKindConsumer),
		trace.WithAttributes(
			attribute.String("messaging.system", "nats"),
			attribute.String("messaging.destination.name", msg.Subject()),
			attribute.String("messaging.operation", "process"),
		),
	)
	defer span.End()

	var event NATSEvent
	if err := json.Unmarshal(msg.Data(), &event); err != nil {
		span.SetStatus(codes.Error, err.Error())
		slog.Error("unmarshal event", "error", err, "subject", msg.Subject())
		// Bad data — ack to avoid redelivery loop.
		_ = msg.Ack()
		return
	}

	span.SetAttributes(
		attribute.String("messaging.message.id", event.ID),
		attribute.String("event.type", event.Type),
	)
	if event.CorrelationID != "" {
		span.SetAttributes(attribute.String("correlation.id", event.CorrelationID))
	}

	// Claim before processing, not after. The handlers are slow enough to
	// outlive AckWait - team formation sends two channels per talent - so
	// JetStream redelivers while the first run is still going. Recording the
	// event afterwards left that whole window unguarded, and the second run
	// re-notified everyone the first had already reached.
	//
	// The claim is a lease, not a tombstone. A claim that outlived the process
	// holding it used to read as "already delivered" on redelivery, so a crash
	// between the claim and the send acked the notification away for good.
	claimed := false
	if event.ID != "" {
		status, err := c.idem.Claim(ctx, event.ID)
		switch {
		case err != nil:
			// Fail open: log + continue. JetStream MaxDeliver still bounds dup risk.
			slog.Warn("idempotency claim failed; processing anyway", "error", err, "id", event.ID, "correlationId", event.CorrelationID)
		case status == idempotency.StatusDone:
			span.SetAttributes(attribute.Bool("messaging.duplicate", true))
			slog.Debug("skipping duplicate event", "type", event.Type, "id", event.ID, "correlationId", event.CorrelationID)
			if err := msg.Ack(); err != nil {
				slog.Error("ack duplicate", "error", err, "subject", msg.Subject())
			}
			return
		case status == idempotency.StatusInFlight:
			span.SetAttributes(attribute.Bool("messaging.in_flight", true))
			c.deferToClaimHolder(ctx, msg, event)
			return
		default:
			claimed = true
		}
	}

	slog.Info("processing event", "type", event.Type, "id", event.ID, "subject", msg.Subject(), "correlationId", event.CorrelationID)

	// Both deadlines are held open for as long as this handler is alive, and
	// for no longer: stopping the heartbeat is what makes a dead handler's work
	// redeliverable.
	stopHeartbeat := c.startHeartbeat(ctx, msg, event.ID, claimed)
	defer stopHeartbeat()

	err := c.processEventSafely(ctx, event)

	// The handler is done, so the deadlines it was holding open are released
	// before the message is settled. The defer is the net for the paths that
	// return early; stopping is idempotent.
	stopHeartbeat()

	if err != nil {
		span.SetStatus(codes.Error, err.Error())
		slog.Error("process event failed", "error", err, "type", event.Type, "id", event.ID, "correlationId", event.CorrelationID)

		// Hand the claim back so the redelivery this Nak asks for can run.
		// Holding it would turn any transient failure into a silently dropped
		// notification.
		if claimed {
			if relErr := c.idem.Release(ctx, event.ID); relErr != nil {
				slog.Warn("idempotency release failed", "error", relErr, "id", event.ID, "correlationId", event.CorrelationID)
			}
		}

		// Last delivery, park it instead of letting JetStream drop it.
		if c.isFinalDelivery(msg) {
			c.parkDeadLetter(ctx, msg, event, err)
			if ackErr := msg.Ack(); ackErr != nil {
				slog.Error("ack dead letter", "error", ackErr, "id", event.ID)
			}
			return
		}

		_ = msg.Nak()
		return
	}

	// Ack first, record second. The finished record is what makes the next
	// delivery a no-op, so writing it any earlier would let a crash in between
	// silence an event whose email had not gone out. An ack that fails is
	// different from a crash: the work did happen, so the record is still
	// written and the redelivery it invites is skipped rather than re-sent.
	if err := msg.Ack(); err != nil {
		slog.Error("ack message", "error", err, "subject", msg.Subject())
	}

	if claimed {
		if err := c.idem.Complete(ctx, event.ID); err != nil {
			slog.Warn("idempotency complete failed", "error", err, "id", event.ID, "correlationId", event.CorrelationID)
		}
	}
}

// errClaimHeld is why a delivery gave a message back untouched.
var errClaimHeld = errors.New("another delivery still holds the idempotency claim")

// deferToClaimHolder hands a message back because someone else is working on
// it. The lease outlives its holder by less than one AckWait, so the
// redelivery this asks for finds the claim either finished or free.
//
// The last delivery has no redelivery to hand it to, so it is parked where an
// admin can replay it instead of being acked into silence. Replaying an event
// whose holder did finish costs nothing: that holder recorded it done, and the
// replay is skipped.
func (c *Consumer) deferToClaimHolder(ctx context.Context, msg jetstream.Msg, event NATSEvent) {
	if c.isFinalDelivery(msg) {
		c.parkDeadLetter(ctx, msg, event, errClaimHeld)
		if err := msg.Ack(); err != nil {
			slog.Error("ack in-flight dead letter", "error", err, "id", event.ID)
		}
		return
	}
	slog.Info("event is claimed by another delivery; asking for redelivery",
		"type", event.Type, "id", event.ID, "correlationId", event.CorrelationID)

	// Delayed, not immediate. A plain Nak comes back in milliseconds, which
	// would spend all three deliveries inside one lease and park an event whose
	// holder was about to finish it. A full lease later the holder has either
	// recorded it done or died and let the claim lapse, and both answers are
	// ones the next delivery can act on.
	if err := msg.NakWithDelay(idempotency.LeaseTTL); err != nil {
		slog.Error("nak in-flight event", "error", err, "id", event.ID)
	}
}

// processEventSafely runs a handler and turns a panic into an error.
//
// An unrecovered panic took the process down with the claim still held, and
// the redelivery then read that claim as a completed delivery and acked the
// notification away. Recovering keeps the failure on the normal path, where
// the claim is released and the message is naked.
func (c *Consumer) processEventSafely(ctx context.Context, event NATSEvent) (err error) {
	defer func() {
		if r := recover(); r != nil {
			slog.Error("panic while processing event", "panic", fmt.Sprint(r),
				"type", event.Type, "id", event.ID, "stack", string(debug.Stack()))
			err = fmt.Errorf("panic processing %s: %v", event.Type, r)
		}
	}()
	return c.processEvent(ctx, event)
}

// startHeartbeat keeps a running handler's two deadlines alive: JetStream's
// AckWait and the idempotency lease. Both are anchored to the last beat and
// the lease is the shorter, so a process that dies stops beating and its claim
// lapses before the redelivery arrives.
//
// The returned stop must run before the message is acked or naked, which the
// caller's defer guarantees on every path including a panic. It waits for the
// beat in progress to finish: a Refresh still running while the caller records
// the event done would put the lease's 20 seconds back on a key that is
// supposed to hold for a week, and the next delivery would send it again.
func (c *Consumer) startHeartbeat(ctx context.Context, msg jetstream.Msg, eventID string, claimed bool) func() {
	done := make(chan struct{})
	finished := make(chan struct{})
	var once sync.Once

	go func() {
		defer close(finished)
		ticker := time.NewTicker(heartbeatInterval)
		defer ticker.Stop()
		for {
			select {
			case <-done:
				return
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := msg.InProgress(); err != nil {
					slog.Warn("extend ack deadline", "error", err, "id", eventID)
				}
				if !claimed {
					continue
				}
				if err := c.idem.Refresh(ctx, eventID); err != nil {
					slog.Warn("extend idempotency lease", "error", err, "id", eventID)
				}
			}
		}
	}()

	return func() {
		once.Do(func() { close(done) })
		<-finished
	}
}

// True when JetStream will not redeliver again.
func (c *Consumer) isFinalDelivery(msg jetstream.Msg) bool {
	meta, err := msg.Metadata()
	if err != nil {
		// Unknown delivery count, park rather than lose it.
		slog.Warn("read message metadata", "error", err)
		return true
	}
	return meta.NumDelivered >= maxDeliver
}

// Writes the event where an admin can find it.
func (c *Consumer) parkDeadLetter(ctx context.Context, msg jetstream.Msg, event NATSEvent, cause error) {
	retryCount := maxDeliver
	if meta, err := msg.Metadata(); err == nil {
		retryCount = int(meta.NumDelivered)
	}

	if err := c.store.RecordDeadLetter(ctx, store.DeadLetterInput{
		OriginalEventID: event.ID,
		EventType:       event.Type,
		Payload:         dlqPayload(event),
		ConsumerService: "notification-service",
		ErrorMessage:    cause.Error(),
		RetryCount:      retryCount,
	}); err != nil {
		slog.Error("record dead letter", "error", err, "type", event.Type, "id", event.ID)
		return
	}
	slog.Warn("event moved to dead letter queue", "type", event.Type, "id", event.ID)
}

// dlqPayload is the business payload a parked event carries.
//
// The whole envelope used to be stored, and admin-service wraps whatever it
// finds in a fresh envelope before republishing, so a reprocessed event
// arrived as {id,type,data:{id,type,data:{...}}}: the handler unwrapped one
// layer, found an envelope where the payload belongs, unmarshalled it into a
// struct of zero values and delivered nothing while reporting success. The
// inner data is the shape a fresh delivery has, and the shape payment-service
// parks already.
func dlqPayload(event NATSEvent) []byte {
	if len(event.Data) == 0 {
		// The column is jsonb and an empty value is not valid there. An object
		// with no fields republishes into the same zero-valued payload the
		// event carried, which is recoverable; a null does not.
		return []byte("{}")
	}
	return event.Data
}

func (c *Consumer) processEvent(ctx context.Context, event NATSEvent) error {
	switch event.Type {
	case "notification.send":
		return c.handleNotificationSend(ctx, event)
	case "project.status.changed":
		return c.handleProjectStatusChanged(ctx, event)
	case "project.completed":
		return c.handleProjectCompleted(ctx, event)
	case "project.team.forming":
		return c.handleTeamForming(ctx, event)
	case "project.team.complete":
		return c.handleTeamComplete(ctx, event)
	case "project.team.escalated":
		return c.handleTeamEscalated(ctx, event)
	case "project.start_overdue":
		return c.handleProjectStartOverdue(ctx, event)
	case "project.decision_overdue":
		return c.handleProjectDecisionOverdue(ctx, event)
	case "talent.assignment.accepted":
		return c.handleAssignmentAccepted(ctx, event)
	case "talent.assignment.declined":
		return c.handleAssignmentDeclined(ctx, event)
	case "talent.assignment.terminated":
		return c.handleAssignmentTerminated(ctx, event)
	case "payment.released":
		return c.handlePaymentReleased(ctx, event)
	case "milestone.submitted":
		return c.handleMilestoneSubmitted(ctx, event)
	case "milestone.approved":
		return c.handleMilestoneApproved(ctx, event)
	case "milestone.auto_released":
		return c.handleMilestoneAutoReleased(ctx, event)
	case "milestone.rejected":
		return c.handleMilestoneRejected(ctx, event)
	case "milestone.revision_requested":
		return c.handleMilestoneRevisionRequested(ctx, event)
	case "milestone.overdue":
		return c.handleMilestoneOverdue(ctx, event)
	case "milestone.due_soon":
		return c.handleMilestoneDueSoon(ctx, event)
	case "chat.message.sent":
		return c.handleChatMessageSent(ctx, event)
	case "dispute.created":
		return c.handleDisputeCreated(ctx, event)
	case "dispute.resolved":
		return c.handleDisputeResolved(ctx, event)
	case "application.created":
		return c.handleApplicationCreated(ctx, event)
	case "contract.created":
		return c.handleContractCreated(ctx, event)
	case "contract.fully_executed":
		return c.handleContractFullyExecuted(ctx, event)
	case "application.status.accepted":
		return c.handleApplicationDecision(ctx, event, true)
	case "application.status.rejected":
		return c.handleApplicationDecision(ctx, event, false)
	default:
		// Warn, not Debug: the log level is Info, so an
		// unhandled event left no trace at all.
		slog.Warn("unhandled event type", "type", event.Type, "id", event.ID)
		return nil
	}
}

// publishChannelUpdate fans out an event to a Centrifugo channel for live UI updates.
// Failures are logged but do not abort event processing — channels are best-effort.
func (c *Consumer) publishChannelUpdate(ctx context.Context, channel string, data map[string]any) {
	if err := c.centrifugo.Publish(ctx, channel, data); err != nil {
		slog.Warn("centrifugo channel publish failed", "channel", channel, "error", err)
	}
}

// handleChatMessageSent publishes new chat messages to the chat:{conversationId} channel.
// No in-app notification is created here — that's the receiver's UI subscription job.
func (c *Consumer) handleChatMessageSent(ctx context.Context, event NATSEvent) error {
	var payload ChatMessageSentPayload
	if err := json.Unmarshal(event.Data, &payload); err != nil {
		return fmt.Errorf("unmarshal chat.message.sent payload: %w", err)
	}

	if payload.ConversationID == "" {
		return nil
	}

	c.publishChannelUpdate(ctx, fmt.Sprintf("chat:%s", payload.ConversationID), map[string]any{
		"type":           "chat.message.sent",
		"conversationId": payload.ConversationID,
		"messageId":      payload.MessageID,
		"senderId":       payload.SenderID,
		"senderType":     payload.SenderType,
		"timestamp":      time.Now().UTC().Format(time.RFC3339),
	})

	return nil
}

func (c *Consumer) handleNotificationSend(ctx context.Context, event NATSEvent) error {
	var payload NotificationSendPayload
	if err := json.Unmarshal(event.Data, &payload); err != nil {
		return fmt.Errorf("unmarshal notification.send payload: %w", err)
	}

	if payload.TemplateKey != "" {
		return c.createAndDeliver(ctx, payload.UserID, store.NotificationType(payload.Type),
			payload.TemplateKey, payload.TemplateParams, strPtr(payload.Link), payload.Channels)
	}
	return c.createAndDeliverRaw(ctx, payload.UserID, store.NotificationType(payload.Type),
		payload.Title, payload.Message, strPtr(payload.Link), payload.Channels)
}

func (c *Consumer) handleProjectStatusChanged(ctx context.Context, event NATSEvent) error {
	var payload ProjectStatusChangedPayload
	if err := json.Unmarshal(event.Data, &payload); err != nil {
		return fmt.Errorf("unmarshal payload: %w", err)
	}

	// Real-time channel push for any subscriber watching this project
	if payload.ProjectID != "" {
		fromStatus := ""
		if payload.FromStatus != nil {
			fromStatus = *payload.FromStatus
		}
		c.publishChannelUpdate(ctx, fmt.Sprintf("project:%s", payload.ProjectID), map[string]any{
			"type":       "project.status.changed",
			"projectId":  payload.ProjectID,
			"fromStatus": fromStatus,
			"toStatus":   payload.ToStatus,
			"timestamp":  time.Now().UTC().Format(time.RFC3339),
		})
	}

	// Notify the project owner, not the person who triggered the change
	ownerID, err := c.getProjectOwnerID(ctx, payload.ProjectID)
	if err != nil {
		return fmt.Errorf("get project owner: %w", err)
	}

	link := fmt.Sprintf("/projects/%s", payload.ProjectID)

	return c.createAndDeliver(ctx, ownerID, store.TypeSystem,
		"notification.project_status_changed",
		map[string]any{"status": payload.ToStatus}, &link, []string{"in_app"})
}

// getProjectOwnerID queries the project's owner_id from the database.
func (c *Consumer) getProjectOwnerID(ctx context.Context, projectID string) (string, error) {
	var ownerID string
	err := c.db.QueryRow(ctx, `SELECT owner_id FROM projects WHERE id = $1 AND deleted_at IS NULL`, projectID).Scan(&ownerID)
	if err != nil {
		return "", fmt.Errorf("query project owner for %s: %w", projectID, err)
	}
	return ownerID, nil
}

func (c *Consumer) handleProjectCompleted(ctx context.Context, event NATSEvent) error {
	var payload struct {
		ProjectID string `json:"projectId"`
		OwnerID   string `json:"ownerId"`
	}
	if err := json.Unmarshal(event.Data, &payload); err != nil {
		return fmt.Errorf("unmarshal payload: %w", err)
	}

	if payload.ProjectID != "" {
		c.publishChannelUpdate(ctx, fmt.Sprintf("project:%s", payload.ProjectID), map[string]any{
			"type":      "project.completed",
			"projectId": payload.ProjectID,
			"timestamp": time.Now().UTC().Format(time.RFC3339),
		})
	}

	link := fmt.Sprintf("/projects/%s", payload.ProjectID)

	return c.createAndDeliver(ctx, payload.OwnerID, store.TypeSystem,
		"notification.project_completed", nil, &link, []string{"in_app", "email"})
}

func (c *Consumer) handleTeamComplete(ctx context.Context, event NATSEvent) error {
	var payload struct {
		ProjectID string `json:"projectId"`
	}
	if err := json.Unmarshal(event.Data, &payload); err != nil {
		return fmt.Errorf("unmarshal payload: %w", err)
	}

	if payload.ProjectID != "" {
		c.publishChannelUpdate(ctx, fmt.Sprintf("project:%s", payload.ProjectID), map[string]any{
			"type":      "project.team.complete",
			"projectId": payload.ProjectID,
			"timestamp": time.Now().UTC().Format(time.RFC3339),
		})
	}

	// No publisher sends ownerId; resolve it from the project row.
	ownerID, err := c.getProjectOwnerID(ctx, payload.ProjectID)
	if err != nil {
		return fmt.Errorf("get project owner: %w", err)
	}

	link := fmt.Sprintf("/projects/%s", payload.ProjectID)

	return c.createAndDeliver(ctx, ownerID, store.TypeTeamFormation,
		"notification.team_complete", nil, &link, []string{"in_app", "email"})
}

// getAdminIDs returns every admin, for events an operator has to act on.
//
// Aggregated into a single row because Querier deliberately exposes only
// QueryRow; widening it for this would change every fake that implements it.
func (c *Consumer) getAdminIDs(ctx context.Context) ([]string, error) {
	var ids []string
	err := c.db.QueryRow(ctx,
		`SELECT COALESCE(array_agg(id), '{}') FROM "user"
		 WHERE role = 'admin' AND deleted_at IS NULL`).Scan(&ids)
	if err != nil {
		return nil, fmt.Errorf("query admins: %w", err)
	}
	return ids, nil
}

// handleProjectStartOverdue tells the owner and every admin that a paid,
// matched project has not started within the promised window.
//
// Escrow is funded before matching, so the owner's money is already held by the
// time this fires. The platform's written remedy is automatic cancellation and
// a refund; nothing does that yet, so this is what makes the stall visible to a
// human who can act rather than leaving the money sitting silently.
//
// A missing owner does not abort the admin notifications, for the same reason
// as team escalation: reaching fewer people beats reaching none.
func (c *Consumer) handleProjectStartOverdue(ctx context.Context, event NATSEvent) error {
	var payload struct {
		ProjectID string `json:"projectId"`
		OwnerID   string `json:"ownerId"`
	}
	if err := json.Unmarshal(event.Data, &payload); err != nil {
		return fmt.Errorf("unmarshal payload: %w", err)
	}

	link := fmt.Sprintf("/projects/%s", payload.ProjectID)

	var firstErr error
	ownerID := payload.OwnerID
	if ownerID == "" {
		resolved, err := c.getProjectOwnerID(ctx, payload.ProjectID)
		if err != nil {
			firstErr = fmt.Errorf("get project owner: %w", err)
		} else {
			ownerID = resolved
		}
	}
	if ownerID != "" {
		if err := c.createAndDeliver(ctx, ownerID, store.TypeSystem,
			"notification.project_start_overdue", nil,
			&link, []string{"in_app", "email"}); err != nil && firstErr == nil {
			firstErr = err
		}
	}

	admins, err := c.getAdminIDs(ctx)
	if err != nil {
		if firstErr == nil {
			firstErr = err
		}
		return firstErr
	}

	adminParams := map[string]any{"projectId": payload.ProjectID}
	for _, adminID := range admins {
		if err := c.createAndDeliver(ctx, adminID, store.TypeSystem,
			"notification.admin_project_start_overdue", adminParams,
			&link, []string{"in_app"}); err != nil && firstErr == nil {
			firstErr = err
		}
	}

	return firstErr
}

// handleProjectDecisionOverdue tells an owner their approved PRD is still
// waiting on them.
//
// Owner only, unlike the start warning. Nothing is held at this point -- no
// escrow, no talent under contract -- so there is nothing for an admin to
// intervene in, and paging them on every project an owner is still thinking
// about would train them to ignore the queue that does need them.
func (c *Consumer) handleProjectDecisionOverdue(ctx context.Context, event NATSEvent) error {
	var payload struct {
		ProjectID string `json:"projectId"`
		OwnerID   string `json:"ownerId"`
	}
	if err := json.Unmarshal(event.Data, &payload); err != nil {
		return fmt.Errorf("unmarshal payload: %w", err)
	}

	ownerID := payload.OwnerID
	if ownerID == "" {
		resolved, err := c.getProjectOwnerID(ctx, payload.ProjectID)
		if err != nil {
			return fmt.Errorf("get project owner: %w", err)
		}
		ownerID = resolved
	}
	if ownerID == "" {
		return nil
	}

	link := fmt.Sprintf("/projects/%s", payload.ProjectID)
	return c.createAndDeliver(ctx, ownerID, store.TypeSystem,
		"notification.project_decision_overdue", nil,
		&link, []string{"in_app", "email"})
}

// handleTeamEscalated tells the owner and every admin that team formation ran
// past its 14-day deadline.
//
// The workflow has always emitted this and nothing consumed it, so the deadline
// the platform promises expired in silence: the project sat in matching and
// no one was told. Owner and admin both, because the documented remedy needs
// both -- the owner decides whether to adjust timeline or scope, and an admin
// is who reaches out to them.
//
// A missing owner does not abort the admin notifications. An escalation that
// reaches nobody is the failure being fixed here, so it degrades to reaching
// fewer people rather than to reaching none.
func (c *Consumer) handleTeamEscalated(ctx context.Context, event NATSEvent) error {
	var payload struct {
		ProjectID string `json:"projectId"`
		Reason    string `json:"reason"`
	}
	if err := json.Unmarshal(event.Data, &payload); err != nil {
		return fmt.Errorf("unmarshal payload: %w", err)
	}

	link := fmt.Sprintf("/projects/%s", payload.ProjectID)

	var firstErr error
	ownerID, err := c.getProjectOwnerID(ctx, payload.ProjectID)
	if err != nil {
		firstErr = fmt.Errorf("get project owner: %w", err)
	} else if err := c.createAndDeliver(ctx, ownerID, store.TypeTeamFormation,
		"notification.team_escalated", nil,
		&link, []string{"in_app", "email"}); err != nil {
		firstErr = err
	}

	admins, err := c.getAdminIDs(ctx)
	if err != nil {
		if firstErr == nil {
			firstErr = err
		}
		return firstErr
	}

	adminParams := map[string]any{"projectId": payload.ProjectID, "reason": payload.Reason}
	for _, adminID := range admins {
		if err := c.createAndDeliver(ctx, adminID, store.TypeTeamFormation,
			"notification.admin_team_escalated", adminParams,
			&link, []string{"in_app"}); err != nil && firstErr == nil {
			firstErr = err
		}
	}

	return firstErr
}

// handleTeamForming notifies each offered talent that an assignment offer is
// waiting for their accept/decline on the talent dashboard.
func (c *Consumer) handleTeamForming(ctx context.Context, event NATSEvent) error {
	var payload struct {
		ProjectID   string `json:"projectId"`
		Assignments []struct {
			WorkPackageID string `json:"workPackageId"`
			TalentID      string `json:"talentId"`
		} `json:"assignments"`
	}
	if err := json.Unmarshal(event.Data, &payload); err != nil {
		return fmt.Errorf("unmarshal payload: %w", err)
	}

	link := "/talent"
	for _, a := range payload.Assignments {
		// The payload carries talent_profiles.id; notifications key on user id.
		var userID string
		err := c.db.QueryRow(ctx,
			`SELECT user_id FROM talent_profiles WHERE id = $1`, a.TalentID).Scan(&userID)
		if err != nil {
			slog.Warn("resolve offered talent", "talentId", a.TalentID, "error", err)
			continue
		}
		if err := c.createAndDeliver(ctx, userID, store.TypeAssignmentOffer,
			"notification.assignment_offer", nil,
			&link, []string{"in_app", "email"}); err != nil {
			return err
		}
	}
	return nil
}

// handleAssignmentAccepted tells the owner a talent took the offer.
//
// The mirror of handleAssignmentDeclined, and it had no publisher and no
// handler: the owner heard every "no" by email and no "yes" at all, so the only
// way to learn a hire had landed was to reload the matching page and compare.
// The talent is not told - they are the one who clicked accept.
//
// The realtime push goes to project: rather than a notification channel, so an
// owner already sitting on the project page sees the team fill without waiting
// for the bell.
func (c *Consumer) handleAssignmentAccepted(ctx context.Context, event NATSEvent) error {
	var payload struct {
		ProjectID     string `json:"projectId"`
		AssignmentID  string `json:"assignmentId"`
		WorkPackageID string `json:"workPackageId"`
	}
	if err := json.Unmarshal(event.Data, &payload); err != nil {
		return fmt.Errorf("unmarshal payload: %w", err)
	}

	if payload.ProjectID != "" {
		c.publishChannelUpdate(ctx, fmt.Sprintf("project:%s", payload.ProjectID), map[string]any{
			"type":          "talent.assignment.accepted",
			"projectId":     payload.ProjectID,
			"assignmentId":  payload.AssignmentID,
			"workPackageId": payload.WorkPackageID,
			"timestamp":     time.Now().UTC().Format(time.RFC3339),
		})
	}

	// The payload names the assignment, not the people, exactly as the
	// termination does. project_assignments.talent_id is a talent_profiles id
	// and notifications key on user id, so neither side is taken from the wire.
	var ownerID string
	err := c.db.QueryRow(ctx,
		`SELECT p.owner_id
		 FROM project_assignments pa
		 JOIN projects p ON p.id = pa.project_id
		 WHERE pa.id = $1`,
		payload.AssignmentID).Scan(&ownerID)
	if errors.Is(err, pgx.ErrNoRows) {
		slog.Warn("acceptance for an assignment that is gone, skipping",
			"assignmentId", payload.AssignmentID)
		return nil
	}
	if err != nil {
		return fmt.Errorf("resolve assignment owner %s: %w", payload.AssignmentID, err)
	}

	link := fmt.Sprintf("/projects/%s/matching", payload.ProjectID)
	return c.createAndDeliver(ctx, ownerID, store.TypeTeamFormation,
		"notification.assignment_accepted", nil,
		&link, []string{"in_app", "email"})
}

// handleAssignmentDeclined tells the owner a position reopened so they can
// restaff it from the matching page instead of discovering it by accident.
func (c *Consumer) handleAssignmentDeclined(ctx context.Context, event NATSEvent) error {
	var payload struct {
		ProjectID string `json:"projectId"`
	}
	if err := json.Unmarshal(event.Data, &payload); err != nil {
		return fmt.Errorf("unmarshal payload: %w", err)
	}

	ownerID, err := c.getProjectOwnerID(ctx, payload.ProjectID)
	if err != nil {
		return fmt.Errorf("get project owner: %w", err)
	}

	link := fmt.Sprintf("/projects/%s/matching", payload.ProjectID)
	return c.createAndDeliver(ctx, ownerID, store.TypeTeamFormation,
		"notification.assignment_declined", nil,
		&link, []string{"in_app", "email"})
}

// handleAssignmentTerminated tells the other party an accepted assignment
// ended mid-project.
//
// Distinct from a decline: the offer had been taken and work was under way, so
// the project keeps running on the packages still staffed while this one
// position reopens. Whoever pulled the plug knows they did - the notification
// goes to the side that did not, the same rule handleDisputeCreated follows.
// Silence here is what the missing endpoint used to guarantee: a talent could
// walk and the owner would find out from a stalled milestone.
func (c *Consumer) handleAssignmentTerminated(ctx context.Context, event NATSEvent) error {
	var payload struct {
		ProjectID    string `json:"projectId"`
		AssignmentID string `json:"assignmentId"`
		Source       string `json:"source"`
	}
	if err := json.Unmarshal(event.Data, &payload); err != nil {
		return fmt.Errorf("unmarshal payload: %w", err)
	}

	// The payload names the assignment, not the people. Both sides hang off it.
	var ownerID, talentUserID string
	err := c.db.QueryRow(ctx,
		`SELECT p.owner_id, tp.user_id
		 FROM project_assignments pa
		 JOIN talent_profiles tp ON tp.id = pa.talent_id
		 JOIN projects p ON p.id = pa.project_id
		 WHERE pa.id = $1`,
		payload.AssignmentID).Scan(&ownerID, &talentUserID)
	if errors.Is(err, pgx.ErrNoRows) {
		slog.Warn("termination for an assignment that is gone, skipping",
			"assignmentId", payload.AssignmentID)
		return nil
	}
	if err != nil {
		return fmt.Errorf("resolve assignment parties %s: %w", payload.AssignmentID, err)
	}

	// The owner restaffs from the matching page; the talent has nothing to do
	// there, so they are pointed at the project they were removed from.
	if payload.Source == "owner_terminate" {
		link := fmt.Sprintf("/projects/%s", payload.ProjectID)
		return c.createAndDeliver(ctx, talentUserID, store.TypeTeamFormation,
			"notification.assignment_ended_by_owner", nil,
			&link, []string{"in_app", "email"})
	}

	link := fmt.Sprintf("/projects/%s/matching", payload.ProjectID)
	return c.createAndDeliver(ctx, ownerID, store.TypeTeamFormation,
		"notification.assignment_ended_by_talent", nil,
		&link, []string{"in_app", "email"})
}

// handleApplicationDecision tells the applicant the owner's answer.
//
// These used to be published as talent.assignment.accepted and .declined.
// Nothing consumed the first, so an accepted talent was never told, and the
// second is the subject a hired talent uses to walk away - so rejecting an
// applicant emailed the owner that a position on their own project had
// reopened.
// handleDisputeCreated tells the party being disputed and every admin.
//
// The repository has always published this and nothing consumed it, so the
// three working days Step 1 grants the two sides to settle it themselves began
// without either the respondent or an admin being told it had started.
//
// The initiator is not notified: they filed it. The respondent is the one who
// has to answer, and an admin is who mediates.
func (c *Consumer) handleDisputeCreated(ctx context.Context, event NATSEvent) error {
	var payload struct {
		DisputeID     string `json:"disputeId"`
		ProjectID     string `json:"projectId"`
		InitiatedBy   string `json:"initiatedBy"`
		AgainstUserID string `json:"againstUserId"`
	}
	if err := json.Unmarshal(event.Data, &payload); err != nil {
		return fmt.Errorf("unmarshal payload: %w", err)
	}

	link := fmt.Sprintf("/projects/%s", payload.ProjectID)
	var firstErr error

	if payload.AgainstUserID != "" {
		if err := c.createAndDeliver(ctx, payload.AgainstUserID, store.TypeDispute,
			"notification.dispute_created", nil,
			&link, []string{"in_app", "email"}); err != nil {
			firstErr = err
		}
	}

	// A missing respondent does not cancel the admin queue, and vice versa: a
	// dispute nobody hears about is the failure being fixed.
	admins, err := c.getAdminIDs(ctx)
	if err != nil {
		if firstErr != nil {
			return firstErr
		}
		return fmt.Errorf("get admins: %w", err)
	}
	for _, adminID := range admins {
		if err := c.createAndDeliver(ctx, adminID, store.TypeDispute,
			"notification.admin_new_dispute", nil,
			&link, []string{"in_app"}); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}

// handleDisputeResolved tells both parties how it ended.
//
// The payload names who resolved it, not who it was between, so the parties are
// read back from the dispute row. A decision that moves money and unfreezes the
// project reached neither side before this.
func (c *Consumer) handleDisputeResolved(ctx context.Context, event NATSEvent) error {
	var payload struct {
		DisputeID      string `json:"disputeId"`
		ProjectID      string `json:"projectId"`
		ResolutionType string `json:"resolutionType"`
	}
	if err := json.Unmarshal(event.Data, &payload); err != nil {
		return fmt.Errorf("unmarshal payload: %w", err)
	}

	var initiatedBy, againstUserID string
	err := c.db.QueryRow(ctx,
		`SELECT initiated_by, against_user_id FROM disputes WHERE id = $1`,
		payload.DisputeID).Scan(&initiatedBy, &againstUserID)
	if errors.Is(err, pgx.ErrNoRows) {
		slog.Warn("resolution for a dispute that is gone, skipping",
			"disputeId", payload.DisputeID)
		return nil
	}
	if err != nil {
		return fmt.Errorf("resolve dispute parties %s: %w", payload.DisputeID, err)
	}

	// One key per outcome rather than one key with the outcome interpolated: the
	// sentence differs by more than a noun in either language, and a template
	// that says "resolved as {{type}}" would print an enum at the reader.
	key := "notification.dispute_resolved"
	switch payload.ResolutionType {
	case "funds_to_owner", "funds_to_talent", "split":
		key += "_" + payload.ResolutionType
	}

	link := fmt.Sprintf("/projects/%s", payload.ProjectID)
	var firstErr error
	for _, userID := range []string{initiatedBy, againstUserID} {
		if userID == "" {
			continue
		}
		if err := c.createAndDeliver(ctx, userID, store.TypeDispute,
			key, nil,
			&link, []string{"in_app", "email"}); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}

// handleContractCreated tells both parties that agreements are waiting.
//
// Signing gates the start of work: a project cannot start work until every
// agreement carries both signatures. Nothing told the two people who have to
// sign, so a fully staffed project sat still and neither side was told why.
//
// Only the NDA is acted on. Both agreements are written in the same transaction
// for the same assignment and are signed as a pair, so notifying on each would
// send two messages about one action.
func (c *Consumer) handleContractCreated(ctx context.Context, event NATSEvent) error {
	var payload struct {
		ContractID string `json:"contractId"`
		ProjectID  string `json:"projectId"`
		Type       string `json:"type"`
	}
	if err := json.Unmarshal(event.Data, &payload); err != nil {
		return fmt.Errorf("unmarshal payload: %w", err)
	}
	if payload.Type != "standard_nda" {
		return nil
	}

	var ownerID, talentUserID, roleLabel string
	err := c.db.QueryRow(ctx,
		`SELECT p.owner_id, tp.user_id, pa.role_label
		 FROM contracts c
		 JOIN project_assignments pa ON pa.id = c.assignment_id
		 JOIN talent_profiles tp ON tp.id = pa.talent_id
		 JOIN projects p ON p.id = c.project_id
		 WHERE c.id = $1`,
		payload.ContractID).Scan(&ownerID, &talentUserID, &roleLabel)
	if errors.Is(err, pgx.ErrNoRows) {
		slog.Warn("agreements for a contract that is gone, skipping",
			"contractId", payload.ContractID)
		return nil
	}
	if err != nil {
		return fmt.Errorf("resolve contract parties %s: %w", payload.ContractID, err)
	}

	link := fmt.Sprintf("/projects/%s/documents", payload.ProjectID)
	var firstErr error

	if err := c.createAndDeliver(ctx, ownerID, store.TypeSystem,
		"notification.contract_ready", map[string]any{"roleLabel": roleLabel},
		&link, []string{"in_app", "email"}); err != nil {
		firstErr = err
	}

	// One party missing does not cancel the other: the gate needs both, so
	// telling only whoever can be resolved still moves the project.
	if talentUserID != "" {
		if err := c.createAndDeliver(ctx, talentUserID, store.TypeSystem,
			"notification.contract_ready_talent", nil,
			&link, []string{"in_app", "email"}); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}

// handleContractFullyExecuted tells the project when the last signature lands.
//
// Fires per contract, and one signed agreement does not open the gate, so this
// asks the question the gate itself asks: is anything still unsigned. Only the
// answer "nothing" is worth a message, and it goes to everyone the project is
// now waiting on.
func (c *Consumer) handleContractFullyExecuted(ctx context.Context, event NATSEvent) error {
	var payload struct {
		ContractID string `json:"contractId"`
		ProjectID  string `json:"projectId"`
	}
	if err := json.Unmarshal(event.Data, &payload); err != nil {
		return fmt.Errorf("unmarshal payload: %w", err)
	}

	var outstanding int
	err := c.db.QueryRow(ctx,
		`SELECT count(*)
		 FROM contracts c
		 JOIN project_assignments pa ON pa.id = c.assignment_id
		 WHERE c.project_id = $1
		   AND pa.status IN ('active', 'completed')
		   AND NOT (c.signed_by_owner AND c.signed_by_talent)`,
		payload.ProjectID).Scan(&outstanding)
	if err != nil {
		return fmt.Errorf("count unsigned agreements %s: %w", payload.ProjectID, err)
	}
	if outstanding > 0 {
		return nil
	}

	// Aggregated into one row for the same reason as getAdminIDs: Querier
	// deliberately exposes only QueryRow.
	var userIDs []string
	if err := c.db.QueryRow(ctx,
		`SELECT COALESCE(array_agg(user_id), '{}') FROM (
		   SELECT p.owner_id AS user_id FROM projects p WHERE p.id = $1
		   UNION
		   SELECT tp.user_id
		   FROM project_assignments pa
		   JOIN talent_profiles tp ON tp.id = pa.talent_id
		   WHERE pa.project_id = $1 AND pa.status IN ('active', 'completed')
		 ) parties`,
		payload.ProjectID).Scan(&userIDs); err != nil {
		return fmt.Errorf("resolve project parties %s: %w", payload.ProjectID, err)
	}

	link := fmt.Sprintf("/projects/%s", payload.ProjectID)
	var firstErr error
	for _, userID := range userIDs {
		if userID == "" {
			continue
		}
		if err := c.createAndDeliver(ctx, userID, store.TypeSystem,
			"notification.contract_executed", nil,
			&link, []string{"in_app"}); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}

// handleApplicationCreated tells the owner that a talent applied.
//
// applications.ts has always published this and nothing consumed it, so an
// owner learned about applications only by opening the project and looking.
// The talent stays anonymous in the text: identities are withheld until a deal,
// and this notification is read before the owner has reviewed anyone.
func (c *Consumer) handleApplicationCreated(ctx context.Context, event NATSEvent) error {
	var payload struct {
		ApplicationID string `json:"applicationId"`
		ProjectID     string `json:"projectId"`
		TalentID      string `json:"talentId"`
	}
	if err := json.Unmarshal(event.Data, &payload); err != nil {
		return fmt.Errorf("unmarshal payload: %w", err)
	}

	ownerID, err := c.getProjectOwnerID(ctx, payload.ProjectID)
	if err != nil {
		return fmt.Errorf("get project owner: %w", err)
	}
	// A deleted project has nobody to tell, and retrying will not find one.
	if ownerID == "" {
		slog.Warn("application on a project with no owner, skipping",
			"projectId", payload.ProjectID)
		return nil
	}

	link := fmt.Sprintf("/projects/%s/matching", payload.ProjectID)
	return c.createAndDeliver(ctx, ownerID, store.TypeApplicationUpdate,
		"notification.application_created", nil,
		&link, []string{"in_app", "email"})
}

func (c *Consumer) handleApplicationDecision(ctx context.Context, event NATSEvent, accepted bool) error {
	var payload struct {
		ProjectID string `json:"projectId"`
		TalentID  string `json:"talentId"`
	}
	if err := json.Unmarshal(event.Data, &payload); err != nil {
		return fmt.Errorf("unmarshal payload: %w", err)
	}

	var userID string
	err := c.db.QueryRow(ctx,
		`SELECT user_id FROM talent_profiles WHERE id = $1`, payload.TalentID).Scan(&userID)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && userID == "") {
		slog.Warn("application decision for unknown talent profile, skipping",
			"talentId", payload.TalentID)
		return nil
	}
	if err != nil {
		return fmt.Errorf("resolve applicant %s: %w", payload.TalentID, err)
	}

	key := "notification.application_rejected"
	if accepted {
		key = "notification.application_accepted"
	}
	link := fmt.Sprintf("/projects/%s", payload.ProjectID)

	return c.createAndDeliver(ctx, userID, store.TypeTeamFormation,
		key, nil, &link, []string{"in_app", "email"})
}

func (c *Consumer) handlePaymentReleased(ctx context.Context, event NATSEvent) error {
	var payload PaymentReleasedPayload
	if err := json.Unmarshal(event.Data, &payload); err != nil {
		return fmt.Errorf("unmarshal payload: %w", err)
	}

	// The payment chain keys on talent_profiles.id, but notifications.user_id
	// is FK-constrained to user.id; inserting the profile id failed the FK and
	// dead-lettered every settlement. Resolve the user first.
	var userID string
	err := c.db.QueryRow(ctx,
		`SELECT user_id FROM talent_profiles WHERE id = $1`, payload.TalentID).Scan(&userID)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && userID == "") {
		slog.Warn("payment.released for unknown talent profile, skipping", "talentId", payload.TalentID)
		return nil
	}
	if err != nil {
		return fmt.Errorf("resolve paid talent %s: %w", payload.TalentID, err)
	}

	link := fmt.Sprintf("/projects/%s", payload.ProjectID)

	return c.createAndDeliver(ctx, userID, store.TypePayment,
		"notification.payment_released",
		map[string]any{"amount": payload.Amount}, &link, []string{"in_app", "email"})
}

func (c *Consumer) handleMilestoneSubmitted(ctx context.Context, event NATSEvent) error {
	var payload MilestoneSubmittedPayload
	if err := json.Unmarshal(event.Data, &payload); err != nil {
		return fmt.Errorf("unmarshal payload: %w", err)
	}

	c.publishMilestoneUpdate(ctx, payload.ProjectID, payload.MilestoneID, "milestone.submitted")

	// Submitted-for-review notifies the owner, who does the reviewing.
	ownerID, err := c.getProjectOwnerID(ctx, payload.ProjectID)
	if err != nil {
		return fmt.Errorf("get project owner: %w", err)
	}

	link := fmt.Sprintf("/projects/%s/milestones", payload.ProjectID)

	return c.createAndDeliver(ctx, ownerID, store.TypeMilestoneUpdate,
		"notification.milestone_submitted", nil, &link, []string{"in_app"})
}

// publishMilestoneUpdate emits a milestone change to the per-project channel.
func (c *Consumer) publishMilestoneUpdate(ctx context.Context, projectID, milestoneID, eventType string) {
	if projectID == "" {
		return
	}
	c.publishChannelUpdate(ctx, fmt.Sprintf("milestone:%s", projectID), map[string]any{
		"type":        eventType,
		"projectId":   projectID,
		"milestoneId": milestoneID,
		"timestamp":   time.Now().UTC().Format(time.RFC3339),
	})
}

func (c *Consumer) handleMilestoneApproved(ctx context.Context, event NATSEvent) error {
	var payload MilestoneApprovedPayload
	if err := json.Unmarshal(event.Data, &payload); err != nil {
		return fmt.Errorf("unmarshal payload: %w", err)
	}

	c.publishMilestoneUpdate(ctx, payload.ProjectID, payload.MilestoneID, "milestone.approved")

	// The auto-release path publishes this event and then milestone.auto_released,
	// whose wording is the one that fits: the owner never approved, the timer did
	// and the money has already moved. Both carry the talent now, so without this
	// branch one payout would be mailed twice. The board still refreshes above -
	// only the message is left to the event that says the right thing.
	if payload.Source == "temporal_auto_release" {
		return nil
	}

	link := fmt.Sprintf("/projects/%s/milestones", payload.ProjectID)

	return c.createAndDeliver(ctx, payload.TalentID, store.TypeMilestoneUpdate,
		"notification.milestone_approved",
		map[string]any{"amount": payload.Amount}, &link, []string{"in_app", "email"})
}

// The 14-day timer paid out without owner action.
func (c *Consumer) handleMilestoneAutoReleased(ctx context.Context, event NATSEvent) error {
	var payload MilestoneApprovedPayload
	if err := json.Unmarshal(event.Data, &payload); err != nil {
		return fmt.Errorf("unmarshal payload: %w", err)
	}

	c.publishMilestoneUpdate(ctx, payload.ProjectID, payload.MilestoneID, "milestone.auto_released")

	link := fmt.Sprintf("/projects/%s/milestones", payload.ProjectID)

	if payload.TalentID == "" {
		return nil
	}
	return c.createAndDeliver(ctx, payload.TalentID, store.TypeMilestoneUpdate,
		"notification.milestone_auto_released",
		map[string]any{"amount": payload.Amount}, &link, []string{"in_app", "email"})
}

func (c *Consumer) handleMilestoneRejected(ctx context.Context, event NATSEvent) error {
	var payload MilestoneSubmittedPayload
	if err := json.Unmarshal(event.Data, &payload); err != nil {
		return fmt.Errorf("unmarshal payload: %w", err)
	}

	c.publishMilestoneUpdate(ctx, payload.ProjectID, payload.MilestoneID, "milestone.rejected")

	link := fmt.Sprintf("/projects/%s/milestones", payload.ProjectID)

	var firstErr error
	if err := c.createAndDeliver(ctx, payload.TalentID, store.TypeMilestoneUpdate,
		"notification.milestone_rejected", nil,
		&link, []string{"in_app", "email"}); err != nil {
		firstErr = err
	}

	// Rejection is the owner declaring the work unusable, so an admin reviews it
	// against the BRD and PRD before the round is spent. Revision requests stay
	// between owner and talent; only rejection escalates.
	admins, err := c.getAdminIDs(ctx)
	if err != nil {
		if firstErr == nil {
			firstErr = err
		}
		return firstErr
	}

	adminParams := map[string]any{
		"milestoneId": payload.MilestoneID,
		"projectId":   payload.ProjectID,
	}
	for _, adminID := range admins {
		if err := c.createAndDeliver(ctx, adminID, store.TypeMilestoneUpdate,
			"notification.admin_milestone_rejected", adminParams,
			&link, []string{"in_app"}); err != nil && firstErr == nil {
			firstErr = err
		}
	}

	return firstErr
}

func (c *Consumer) handleMilestoneRevisionRequested(ctx context.Context, event NATSEvent) error {
	var payload MilestoneRevisionPayload
	if err := json.Unmarshal(event.Data, &payload); err != nil {
		return fmt.Errorf("unmarshal payload: %w", err)
	}

	c.publishMilestoneUpdate(ctx, payload.ProjectID, payload.MilestoneID, "milestone.revision_requested")

	link := fmt.Sprintf("/projects/%s/milestones", payload.ProjectID)

	var firstErr error
	if err := c.createAndDeliver(ctx, payload.TalentID, store.TypeMilestoneUpdate,
		"notification.revision_requested", nil,
		&link, []string{"in_app", "email"}); err != nil {
		firstErr = err
	}

	// Admins read in only once the free rounds are spent. Every round escalating
	// trains them to ignore the queue; none escalating is what the removed reject
	// button was covering for.
	if !payload.Escalated {
		return firstErr
	}

	admins, err := c.getAdminIDs(ctx)
	if err != nil {
		if firstErr == nil {
			firstErr = err
		}
		return firstErr
	}

	adminParams := map[string]any{
		"milestoneId": payload.MilestoneID,
		"projectId":   payload.ProjectID,
	}
	for _, adminID := range admins {
		if err := c.createAndDeliver(ctx, adminID, store.TypeMilestoneUpdate,
			"notification.admin_revision_exhausted", adminParams,
			&link, []string{"in_app"}); err != nil && firstErr == nil {
			firstErr = err
		}
	}

	return firstErr
}

// handleMilestoneOverdue tells the talent they are late and the owner that they
// are waiting. The owner half is the catalog's worker_overdue row: the grace
// period before an owner may dispute a late milestone starts here, so an owner
// who is never told cannot use it.
func (c *Consumer) handleMilestoneOverdue(ctx context.Context, event NATSEvent) error {
	var payload MilestoneSubmittedPayload
	if err := json.Unmarshal(event.Data, &payload); err != nil {
		return fmt.Errorf("unmarshal payload: %w", err)
	}

	c.publishMilestoneUpdate(ctx, payload.ProjectID, payload.MilestoneID, "milestone.overdue")

	link := fmt.Sprintf("/projects/%s/milestones", payload.ProjectID)

	var firstErr error
	if err := c.createAndDeliver(ctx, payload.TalentID, store.TypeMilestoneUpdate,
		"notification.milestone_overdue", nil,
		&link, []string{"in_app"}); err != nil {
		firstErr = err
	}

	ownerID, err := c.getProjectOwnerID(ctx, payload.ProjectID)
	if err != nil {
		if firstErr == nil {
			firstErr = fmt.Errorf("get project owner: %w", err)
		}
		return firstErr
	}

	if err := c.createAndDeliver(ctx, ownerID, store.TypeMilestoneUpdate,
		"notification.worker_overdue", nil,
		&link, []string{"in_app"}); err != nil && firstErr == nil {
		firstErr = err
	}

	return firstErr
}

func (c *Consumer) handleMilestoneDueSoon(ctx context.Context, event NATSEvent) error {
	var payload MilestoneSubmittedPayload
	if err := json.Unmarshal(event.Data, &payload); err != nil {
		return fmt.Errorf("unmarshal payload: %w", err)
	}

	c.publishMilestoneUpdate(ctx, payload.ProjectID, payload.MilestoneID, "milestone.due_soon")

	link := fmt.Sprintf("/projects/%s/milestones", payload.ProjectID)

	return c.createAndDeliver(ctx, payload.TalentID, store.TypeMilestoneUpdate,
		"notification.milestone_due_soon",
		map[string]any{"days": milestoneDueSoonDays}, &link, []string{"in_app"})
}

// recipient is who a notification is being written for: an address to mail,
// the language to write it in, and what they agreed to be told about.
type recipient struct {
	email  string
	locale string
	prefs  prefs
}

// prefs mirrors user_notification_preferences. The zero value is every channel
// off, which is the wrong answer for a lookup that failed, so it is only ever
// built through allPrefsOn or a completed scan.
type prefs struct {
	email          bool
	projectUpdates bool
	paymentAlerts  bool
}

func allPrefsOn() prefs {
	return prefs{email: true, projectUpdates: true, paymentAlerts: true}
}

// allows reports whether the recipient still wants this kind of notification.
//
// A type nobody has a toggle for is always delivered: disputes, team formation
// and system notices are the ones a user cannot afford to miss, and inventing a
// mapping for them would silence them behind a switch labelled something else.
func (p prefs) allows(t store.NotificationType) bool {
	switch t {
	case store.TypeProjectMatch, store.TypeApplicationUpdate, store.TypeMilestoneUpdate:
		return p.projectUpdates
	case store.TypePayment:
		return p.paymentAlerts
	default:
		return true
	}
}

// milestoneDueSoonDays mirrors MILESTONE_DUE_SOON_DAYS in
// packages/shared/src/constants.ts. It is the number the talent is told, and it
// used to be written into the English sentence itself, where a change to the
// constant would have left the message saying seven.
const milestoneDueSoonDays = 7

// resolveRecipient reads the address and language in one query.
//
// The language is not optional any more: the stored title and message are the
// fallback the reader shows when it does not know the key, and the email body
// is rendered here rather than in the browser, so both have to be in the
// reader's own language rather than in whatever the handler was written in.
//
// A row that cannot be read degrades to the default locale instead of failing.
// An in-app notification never needed the user row before this, and losing one
// because a lookup blipped would be a regression; the email branch still
// reports its own missing address.
// The preferences row is written the first time a toggle is flipped, so most
// accounts have none. A LEFT JOIN with COALESCE answers those as all-on in the
// same round trip, matching the column defaults and what auth-service reports
// over GET /api/v1/me.
func (c *Consumer) resolveRecipient(ctx context.Context, userID string) recipient {
	var email, locale string
	// Seeded on, not zero: a driver that leaves a target untouched must leave
	// the permissive answer standing rather than the silent one.
	pref := allPrefsOn()
	err := c.db.QueryRow(ctx,
		`SELECT u.email, COALESCE(u.locale, $2),
		        COALESCE(p.email_notifications, true),
		        COALESCE(p.project_updates, true),
		        COALESCE(p.payment_alerts, true)
		   FROM "user" u
		   LEFT JOIN user_notification_preferences p ON p.user_id = u.id
		  WHERE u.id = $1`,
		userID, notify.DefaultLocale,
	).Scan(&email, &locale, &pref.email, &pref.projectUpdates, &pref.paymentAlerts)
	if err != nil {
		// Fail open on both counts. Losing an in-app notification because a
		// lookup blipped was already a regression; muting every channel would
		// be a worse one, and an invisible one.
		slog.Warn("resolve recipient", "userId", userID, "error", err)
		return recipient{locale: notify.DefaultLocale, prefs: allPrefsOn()}
	}
	if locale == "" {
		locale = notify.DefaultLocale
	}
	return recipient{email: email, locale: locale, prefs: pref}
}

// createAndDeliver renders a catalog template into the recipient's language,
// stores it alongside the key and params the reader renders from, then delivers
// via the configured channels.
func (c *Consumer) createAndDeliver(
	ctx context.Context,
	userID string,
	notifType store.NotificationType,
	templateKey string,
	params map[string]any,
	link *string,
	channels []string,
) error {
	if userID == "" {
		slog.Warn("createAndDeliver: empty userID, skipping notification",
			"type", string(notifType), "key", templateKey)
		return nil
	}
	who := c.resolveRecipient(ctx, userID)
	title, message, ok := notify.Render(templateKey, who.locale, params)
	if !ok {
		// A key the catalog does not carry means this handler and the generated
		// table have parted company. Storing a blank notification would hide it.
		return fmt.Errorf("unknown notification template %q", templateKey)
	}
	return c.deliver(ctx, userID, who, notifType, store.CreateInput{
		UserID:         userID,
		Type:           notifType,
		Title:          title,
		Message:        message,
		TemplateKey:    &templateKey,
		TemplateParams: params,
		Link:           link,
	}, channels)
}

// createAndDeliverRaw stores wording the publisher supplied rather than a
// catalog key.
//
// Only notification.send reaches this. Its payload carries its own title and
// message, so there is no key for the reader to render and template_key stays
// null, which is what makes the reader's fallback the correct answer there
// rather than a missing feature.
func (c *Consumer) createAndDeliverRaw(
	ctx context.Context,
	userID string,
	notifType store.NotificationType,
	title, message string,
	link *string,
	channels []string,
) error {
	if userID == "" {
		slog.Warn("createAndDeliverRaw: empty userID, skipping notification",
			"type", string(notifType), "title", title)
		return nil
	}
	return c.deliver(ctx, userID, c.resolveRecipient(ctx, userID), notifType, store.CreateInput{
		UserID:  userID,
		Type:    notifType,
		Title:   title,
		Message: message,
		Link:    link,
	}, channels)
}

// deliver writes the row and fans it out to the requested channels.
func (c *Consumer) deliver(
	ctx context.Context,
	userID string,
	who recipient,
	notifType store.NotificationType,
	in store.CreateInput,
	channels []string,
) error {
	title, message := in.Title, in.Message

	// The row is written whatever the preferences say. The notification list
	// and the unread badge read this table, and a row never written is a hole
	// in a history the user cannot get back; the toggles govern what interrupts
	// them, not what is recorded.
	notif, err := c.store.Create(ctx, in)
	if err != nil {
		return fmt.Errorf("create notification: %w", err)
	}

	wanted := who.prefs.allows(notifType)

	// Push real-time via Centrifugo (best-effort — Centrifugo may not be running).
	if wanted {
		if err := c.centrifugo.PublishUserNotification(ctx, userID, notif); err != nil {
			slog.Warn("centrifugo publish failed", "error", err, "userId", userID)
		}
	} else {
		slog.Debug("push suppressed by preference", "userId", userID, "type", string(notifType))
	}

	// Deliver via each requested channel.
	//
	// A failed send is returned, not just logged. Logging it was the last step
	// of a chain that reported success: the handler returned nil, the message
	// was acked and the event was recorded delivered, so a verification mail
	// that never left was invisible to the retry, to the DLQ and to the
	// operator. Every channel is still attempted first, because one broken
	// channel must not cancel the others.
	var sendErr error
	for _, ch := range channels {
		switch ch {
		case "email":
			if !wanted || !who.prefs.email {
				slog.Debug("email suppressed by preference", "userId", userID,
					"type", string(notifType))
				continue
			}
			if who.email == "" {
				// Not retryable: the account has no address, and three more
				// deliveries will not give it one.
				slog.Error("no email address for recipient", "userId", userID,
					"type", string(notifType))
				continue
			}
			if err := c.email.Send(ctx, sender.SendEmailInput{
				To:      who.email,
				Subject: title,
				HTML:    fmt.Sprintf("<h2>%s</h2><p>%s</p>", html.EscapeString(title), html.EscapeString(message)),
			}); err != nil {
				slog.Error("email send failed", "error", err, "userId", userID)
				if sendErr == nil {
					sendErr = fmt.Errorf("send email to %s: %w", userID, err)
				}
			}
		case "in_app":
			// Already handled above via store.Create + centrifugo.
		default:
			slog.Warn("unknown delivery channel", "channel", ch)
		}
	}

	return sendErr
}

// Close stops consuming and lets in-flight handlers finish.
//
// Idempotent: main closes it explicitly during shutdown and again via defer on
// the error paths.
func (c *Consumer) Close() {
	c.closeOnce.Do(func() {
		// Drain, not Stop: Stop discards whatever is already buffered, so every
		// one of those messages comes back as a redelivery on the next boot.
		for _, cc := range c.contexts {
			cc.Drain()
		}
		c.waitDrained()

		if c.nc != nil {
			c.nc.Close()
		}
	})
}

// waitDrained blocks until every consume context reports done. The budget is
// shared across contexts rather than per-context so the total stays inside the
// container stop timeout; whatever has not finished by then falls back to
// JetStream redelivery, which is the pre-drain behaviour anyway.
func (c *Consumer) waitDrained() {
	deadline := time.After(drainTimeout)
	for _, cc := range c.contexts {
		select {
		case <-cc.Closed():
		case <-deadline:
			slog.Warn("consumer drain timed out; in-flight handlers left to redelivery")
			return
		}
	}
}

// IsConnected reports whether the underlying NATS connection is healthy.
// Returns false if the consumer never started or has since disconnected.
func (c *Consumer) IsConnected() bool {
	return c.nc != nil && c.nc.IsConnected()
}

func strPtr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
