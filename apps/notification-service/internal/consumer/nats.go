package consumer

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"log/slog"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kerjacus/notification-service/internal/idempotency"
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
	UserID   string   `json:"userId"`
	Type     string   `json:"type"`
	Title    string   `json:"title"`
	Message  string   `json:"message"`
	Link     string   `json:"link,omitempty"`
	Channels []string `json:"channels"`
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

// MilestoneApprovedPayload for milestone.approved events.
type MilestoneApprovedPayload struct {
	MilestoneID string `json:"milestoneId"`
	ProjectID   string `json:"projectId"`
	TalentID    string `json:"talentId"`
	Amount      int    `json:"amount"`
}

// streamConsumerDef pairs a JetStream stream name with its durable consumer name.
type streamConsumerDef struct {
	Stream  string
	Durable string
}

// Consumer subscribes to NATS JetStream and processes notification events.
// JetStream drops the message after this many tries.
const maxDeliver = 3

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
		AckWait:    30 * time.Second,
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
	claimed := false
	if event.ID != "" {
		acquired, err := c.idem.Claim(ctx, event.ID)
		if err != nil {
			// Fail open: log + continue. JetStream MaxDeliver still bounds dup risk.
			slog.Warn("idempotency claim failed; processing anyway", "error", err, "id", event.ID, "correlationId", event.CorrelationID)
		} else if !acquired {
			span.SetAttributes(attribute.Bool("messaging.duplicate", true))
			slog.Debug("skipping duplicate event", "type", event.Type, "id", event.ID, "correlationId", event.CorrelationID)
			if err := msg.Ack(); err != nil {
				slog.Error("ack duplicate", "error", err, "subject", msg.Subject())
			}
			return
		} else {
			claimed = true
		}
	}

	slog.Info("processing event", "type", event.Type, "id", event.ID, "subject", msg.Subject(), "correlationId", event.CorrelationID)

	if err := c.processEvent(ctx, event); err != nil {
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

	// Success keeps the claim, which is what makes the next delivery a no-op.

	if err := msg.Ack(); err != nil {
		slog.Error("ack message", "error", err, "subject", msg.Subject())
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
		Payload:         msg.Data(),
		ConsumerService: "notification-service",
		ErrorMessage:    cause.Error(),
		RetryCount:      retryCount,
	}); err != nil {
		slog.Error("record dead letter", "error", err, "type", event.Type, "id", event.ID)
		return
	}
	slog.Warn("event moved to dead letter queue", "type", event.Type, "id", event.ID)
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
	case "talent.assignment.declined":
		return c.handleAssignmentDeclined(ctx, event)
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

	return c.createAndDeliver(ctx, payload.UserID, store.NotificationType(payload.Type),
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

	title := "Project status updated"
	message := fmt.Sprintf("Project status changed to %s", payload.ToStatus)
	link := fmt.Sprintf("/projects/%s", payload.ProjectID)

	return c.createAndDeliver(ctx, ownerID, store.TypeSystem,
		title, message, &link, []string{"in_app"})
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

	title := "Project completed"
	message := "Your project has been marked as completed."
	link := fmt.Sprintf("/projects/%s", payload.ProjectID)

	return c.createAndDeliver(ctx, payload.OwnerID, store.TypeSystem,
		title, message, &link, []string{"in_app", "email"})
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

	title := "Team formation complete"
	message := "All team positions have been filled for your project."
	link := fmt.Sprintf("/projects/%s", payload.ProjectID)

	return c.createAndDeliver(ctx, ownerID, store.TypeTeamFormation,
		title, message, &link, []string{"in_app", "email"})
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
	title := "Project has not started"

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
		if err := c.createAndDeliver(ctx, ownerID, store.TypeSystem, title,
			"Work on your project has not started since it was matched. "+
				"Contact the team or ask support to release your escrow.",
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

	adminMessage := fmt.Sprintf(
		"Project %s has held matched past the start deadline with escrow funded.", payload.ProjectID)
	for _, adminID := range admins {
		if err := c.createAndDeliver(ctx, adminID, store.TypeSystem,
			title, adminMessage, &link, []string{"in_app"}); err != nil && firstErr == nil {
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
		"Your PRD is waiting on a decision",
		"Your PRD is approved and the project has not moved since. "+
			"Fund the project to start matching, or take the PRD and close it out.",
		&link, []string{"in_app", "email"})
}

// handleTeamEscalated tells the owner and every admin that team formation ran
// past its 14-day deadline.
//
// The workflow has always emitted this and nothing consumed it, so the deadline
// the platform promises expired in silence: the project sat in team_forming and
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
	title := "Team formation needs attention"
	message := "This project has not filled every position within the 14-day window. " +
		"Adjust the timeline or scope, or accept the team assembled so far."

	var firstErr error
	ownerID, err := c.getProjectOwnerID(ctx, payload.ProjectID)
	if err != nil {
		firstErr = fmt.Errorf("get project owner: %w", err)
	} else if err := c.createAndDeliver(ctx, ownerID, store.TypeTeamFormation,
		title, message, &link, []string{"in_app", "email"}); err != nil {
		firstErr = err
	}

	admins, err := c.getAdminIDs(ctx)
	if err != nil {
		if firstErr == nil {
			firstErr = err
		}
		return firstErr
	}

	adminMessage := fmt.Sprintf(
		"Project %s passed the team formation deadline (%s).", payload.ProjectID, payload.Reason)
	for _, adminID := range admins {
		if err := c.createAndDeliver(ctx, adminID, store.TypeTeamFormation,
			title, adminMessage, &link, []string{"in_app"}); err != nil && firstErr == nil {
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
			"New assignment offer",
			"You have a work package offer waiting. Accept or decline it from your dashboard.",
			&link, []string{"in_app", "email"}); err != nil {
			return err
		}
	}
	return nil
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
		"A talent declined their offer",
		"A position on your project reopened. Pick a replacement from the matching page.",
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
			"A dispute was opened on your project",
			"The other party opened a dispute. Escrow is frozen while it is open. "+
				"You have three working days to settle it directly before an admin mediates.",
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
			"New dispute opened",
			"A dispute was opened and needs mediation. Escrow on the project is frozen.",
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

	message := "The dispute on your project was resolved and the escrow was released accordingly."
	switch payload.ResolutionType {
	case "funds_to_owner":
		message = "The dispute was resolved in the owner's favour and the held funds were refunded."
	case "funds_to_talent":
		message = "The dispute was resolved in the talent's favour and the held funds were released."
	case "split":
		message = "The dispute was resolved with the held funds split between both sides."
	}

	link := fmt.Sprintf("/projects/%s", payload.ProjectID)
	var firstErr error
	for _, userID := range []string{initiatedBy, againstUserID} {
		if userID == "" {
			continue
		}
		if err := c.createAndDeliver(ctx, userID, store.TypeDispute,
			"Your dispute was resolved", message,
			&link, []string{"in_app", "email"}); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}

// handleContractCreated tells both parties that agreements are waiting.
//
// Signing gates the start of work: a project cannot leave 'matched' until every
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
		"Agreements are ready to sign",
		fmt.Sprintf("The NDA and IP transfer agreement for %s are ready. "+
			"Work cannot start until both you and the talent have signed.", roleLabel),
		&link, []string{"in_app", "email"}); err != nil {
		firstErr = err
	}

	// One party missing does not cancel the other: the gate needs both, so
	// telling only whoever can be resolved still moves the project.
	if talentUserID != "" {
		if err := c.createAndDeliver(ctx, talentUserID, store.TypeSystem,
			"Agreements are ready to sign",
			"The NDA and IP transfer agreement for your position are ready. "+
				"Work cannot start until both you and the owner have signed.",
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
			"Every agreement is signed",
			"All NDAs and IP transfer agreements on this project are signed. Work can start.",
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
		"A talent applied to your project",
		"Someone applied to your project. Review the anonymous profile and decide who joins.",
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

	title := "Your application was not selected"
	message := "The owner has chosen another talent for this project. Your other applications are unaffected."
	if accepted {
		title = "Your application was accepted"
		message = "The owner accepted your application. Open the project to see the work."
	}
	link := fmt.Sprintf("/projects/%s", payload.ProjectID)

	return c.createAndDeliver(ctx, userID, store.TypeTeamFormation,
		title, message, &link, []string{"in_app", "email"})
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

	title := "Payment released"
	message := fmt.Sprintf("Payment of Rp %d has been released for your milestone.", payload.Amount)
	link := fmt.Sprintf("/projects/%s", payload.ProjectID)

	return c.createAndDeliver(ctx, userID, store.TypePayment,
		title, message, &link, []string{"in_app", "email"})
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

	title := "Milestone submitted"
	message := "A milestone has been submitted for your review."
	link := fmt.Sprintf("/projects/%s/milestones", payload.ProjectID)

	return c.createAndDeliver(ctx, ownerID, store.TypeMilestoneUpdate,
		title, message, &link, []string{"in_app"})
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

	title := "Milestone approved"
	message := fmt.Sprintf("Your milestone has been approved. Payment of Rp %d will be released.", payload.Amount)
	link := fmt.Sprintf("/projects/%s/milestones", payload.ProjectID)

	return c.createAndDeliver(ctx, payload.TalentID, store.TypeMilestoneUpdate,
		title, message, &link, []string{"in_app", "email"})
}

// The 14-day timer paid out without owner action.
func (c *Consumer) handleMilestoneAutoReleased(ctx context.Context, event NATSEvent) error {
	var payload MilestoneApprovedPayload
	if err := json.Unmarshal(event.Data, &payload); err != nil {
		return fmt.Errorf("unmarshal payload: %w", err)
	}

	c.publishMilestoneUpdate(ctx, payload.ProjectID, payload.MilestoneID, "milestone.auto_released")

	title := "Milestone auto-approved"
	message := fmt.Sprintf(
		"The 14-day review window closed, so this milestone was approved automatically and Rp %d released.",
		payload.Amount,
	)
	link := fmt.Sprintf("/projects/%s/milestones", payload.ProjectID)

	if payload.TalentID == "" {
		return nil
	}
	return c.createAndDeliver(ctx, payload.TalentID, store.TypeMilestoneUpdate,
		title, message, &link, []string{"in_app", "email"})
}

func (c *Consumer) handleMilestoneRejected(ctx context.Context, event NATSEvent) error {
	var payload MilestoneSubmittedPayload
	if err := json.Unmarshal(event.Data, &payload); err != nil {
		return fmt.Errorf("unmarshal payload: %w", err)
	}

	c.publishMilestoneUpdate(ctx, payload.ProjectID, payload.MilestoneID, "milestone.rejected")

	title := "Milestone rejected"
	message := "Your milestone submission has been rejected. Please review the feedback."
	link := fmt.Sprintf("/projects/%s/milestones", payload.ProjectID)

	var firstErr error
	if err := c.createAndDeliver(ctx, payload.TalentID, store.TypeMilestoneUpdate,
		title, message, &link, []string{"in_app", "email"}); err != nil {
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

	adminMessage := fmt.Sprintf(
		"Milestone %s on project %s was rejected. Check it against the agreed scope.",
		payload.MilestoneID, payload.ProjectID)
	for _, adminID := range admins {
		if err := c.createAndDeliver(ctx, adminID, store.TypeMilestoneUpdate,
			title, adminMessage, &link, []string{"in_app"}); err != nil && firstErr == nil {
			firstErr = err
		}
	}

	return firstErr
}

func (c *Consumer) handleMilestoneRevisionRequested(ctx context.Context, event NATSEvent) error {
	var payload MilestoneSubmittedPayload
	if err := json.Unmarshal(event.Data, &payload); err != nil {
		return fmt.Errorf("unmarshal payload: %w", err)
	}

	c.publishMilestoneUpdate(ctx, payload.ProjectID, payload.MilestoneID, "milestone.revision_requested")

	title := "Revision requested"
	message := "A revision has been requested for your milestone."
	link := fmt.Sprintf("/projects/%s/milestones", payload.ProjectID)

	return c.createAndDeliver(ctx, payload.TalentID, store.TypeMilestoneUpdate,
		title, message, &link, []string{"in_app", "email"})
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

	title := "Milestone overdue"
	link := fmt.Sprintf("/projects/%s/milestones", payload.ProjectID)

	var firstErr error
	if err := c.createAndDeliver(ctx, payload.TalentID, store.TypeMilestoneUpdate,
		title, "Your milestone is past due. Please submit as soon as possible.",
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
		title, "A milestone on your project is past its due date.",
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

	title := "Milestone due soon"
	message := "Your milestone is due within the next 7 days."
	link := fmt.Sprintf("/projects/%s/milestones", payload.ProjectID)

	return c.createAndDeliver(ctx, payload.TalentID, store.TypeMilestoneUpdate,
		title, message, &link, []string{"in_app"})
}

// resolveUserEmail looks up a user's email address from the database.
func (c *Consumer) resolveUserEmail(ctx context.Context, userID string) (string, error) {
	var email string
	err := c.db.QueryRow(ctx, `SELECT email FROM "user" WHERE id = $1`, userID).Scan(&email)
	if err != nil {
		return "", fmt.Errorf("failed to resolve email for user %s: %w", userID, err)
	}
	return email, nil
}

// createAndDeliver creates a notification in the DB, then delivers via configured channels.
func (c *Consumer) createAndDeliver(
	ctx context.Context,
	userID string,
	notifType store.NotificationType,
	title, message string,
	link *string,
	channels []string,
) error {
	if userID == "" {
		slog.Warn("createAndDeliver: empty userID, skipping notification", "type", string(notifType), "title", title)
		return nil
	}
	notif, err := c.store.Create(ctx, store.CreateInput{
		UserID:  userID,
		Type:    notifType,
		Title:   title,
		Message: message,
		Link:    link,
	})
	if err != nil {
		return fmt.Errorf("create notification: %w", err)
	}

	// Push real-time via Centrifugo (best-effort — Centrifugo may not be running).
	if err := c.centrifugo.PublishUserNotification(ctx, userID, notif); err != nil {
		slog.Warn("centrifugo publish failed", "error", err, "userId", userID)
	}

	// Deliver via each requested channel.
	for _, ch := range channels {
		switch ch {
		case "email":
			email, err := c.resolveUserEmail(ctx, userID)
			if err != nil {
				slog.Error("resolve user email failed", "error", err, "userId", userID)
				continue
			}
			if err := c.email.Send(ctx, sender.SendEmailInput{
				To:      email,
				Subject: title,
				HTML:    fmt.Sprintf("<h2>%s</h2><p>%s</p>", html.EscapeString(title), html.EscapeString(message)),
			}); err != nil {
				slog.Error("email send failed", "error", err, "userId", userID)
			}
		case "in_app":
			// Already handled above via store.Create + centrifugo.
		default:
			slog.Warn("unknown delivery channel", "channel", ch)
		}
	}

	return nil
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
