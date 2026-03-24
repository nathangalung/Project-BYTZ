package consumer

import (
	"context"
	"encoding/json"
	"fmt"
	"html"
	"log/slog"
	"time"

	"github.com/bytz/notification-service/internal/sender"
	"github.com/bytz/notification-service/internal/store"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
)

// NATSEvent mirrors the shared event envelope.
type NATSEvent struct {
	ID        string          `json:"id"`
	Type      string          `json:"type"`
	Source    string          `json:"source"`
	Timestamp string          `json:"timestamp"`
	Data      json.RawMessage `json:"data"`
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
	Stream   string
	Durable  string
}

// Consumer subscribes to NATS JetStream and processes notification events.
type Consumer struct {
	store      *store.Store
	db         *pgxpool.Pool
	email      *sender.EmailSender
	centrifugo *sender.CentrifugoSender
	nc         *nats.Conn
	js         jetstream.JetStream
	contexts   []jetstream.ConsumeContext
}

func New(notifStore *store.Store, db *pgxpool.Pool, emailSender *sender.EmailSender, centrifugoSender *sender.CentrifugoSender) *Consumer {
	return &Consumer{
		store:      notifStore,
		db:         db,
		email:      emailSender,
		centrifugo: centrifugoSender,
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

	// Subscribe to each domain stream with a dedicated durable consumer.
	streams := []streamConsumerDef{
		{Stream: "PROJECT_EVENTS", Durable: "notif-project"},
		{Stream: "PAYMENT_EVENTS", Durable: "notif-payment"},
		{Stream: "WORKER_EVENTS", Durable: "notif-worker"},
		{Stream: "MILESTONE_EVENTS", Durable: "notif-milestone"},
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

	return nil
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
		MaxDeliver: 3,
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
	var event NATSEvent
	if err := json.Unmarshal(msg.Data(), &event); err != nil {
		slog.Error("unmarshal event", "error", err, "subject", msg.Subject())
		// Bad data — ack to avoid redelivery loop.
		_ = msg.Ack()
		return
	}

	slog.Info("processing event", "type", event.Type, "id", event.ID, "subject", msg.Subject())

	if err := c.processEvent(ctx, event); err != nil {
		slog.Error("process event failed", "error", err, "type", event.Type, "id", event.ID)
		_ = msg.Nak()
		return
	}

	if err := msg.Ack(); err != nil {
		slog.Error("ack message", "error", err, "subject", msg.Subject())
	}
}

func (c *Consumer) processEvent(ctx context.Context, event NATSEvent) error {
	switch event.Type {
	case "notification.send":
		return c.handleNotificationSend(ctx, event)
	case "project.status.changed":
		return c.handleProjectStatusChanged(ctx, event)
	case "project.completed":
		return c.handleProjectCompleted(ctx, event)
	case "project.team.complete":
		return c.handleTeamComplete(ctx, event)
	case "payment.released":
		return c.handlePaymentReleased(ctx, event)
	case "milestone.submitted":
		return c.handleMilestoneSubmitted(ctx, event)
	case "milestone.approved":
		return c.handleMilestoneApproved(ctx, event)
	case "milestone.rejected":
		return c.handleMilestoneRejected(ctx, event)
	case "milestone.revision_requested":
		return c.handleMilestoneRevisionRequested(ctx, event)
	case "milestone.overdue":
		return c.handleMilestoneOverdue(ctx, event)
	case "milestone.due_soon":
		return c.handleMilestoneDueSoon(ctx, event)
	default:
		slog.Debug("unhandled event type", "type", event.Type)
		return nil
	}
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

	title := "Project completed"
	message := "Your project has been marked as completed."
	link := fmt.Sprintf("/projects/%s", payload.ProjectID)

	return c.createAndDeliver(ctx, payload.OwnerID, store.TypeSystem,
		title, message, &link, []string{"in_app", "email"})
}

func (c *Consumer) handleTeamComplete(ctx context.Context, event NATSEvent) error {
	var payload struct {
		ProjectID string `json:"projectId"`
		OwnerID   string `json:"ownerId"`
	}
	if err := json.Unmarshal(event.Data, &payload); err != nil {
		return fmt.Errorf("unmarshal payload: %w", err)
	}

	title := "Team formation complete"
	message := "All team positions have been filled for your project."
	link := fmt.Sprintf("/projects/%s", payload.ProjectID)

	return c.createAndDeliver(ctx, payload.OwnerID, store.TypeTeamFormation,
		title, message, &link, []string{"in_app", "email"})
}

func (c *Consumer) handlePaymentReleased(ctx context.Context, event NATSEvent) error {
	var payload PaymentReleasedPayload
	if err := json.Unmarshal(event.Data, &payload); err != nil {
		return fmt.Errorf("unmarshal payload: %w", err)
	}

	title := "Payment released"
	message := fmt.Sprintf("Payment of Rp %d has been released for your milestone.", payload.Amount)
	link := fmt.Sprintf("/projects/%s", payload.ProjectID)

	return c.createAndDeliver(ctx, payload.TalentID, store.TypePayment,
		title, message, &link, []string{"in_app", "email"})
}

func (c *Consumer) handleMilestoneSubmitted(ctx context.Context, event NATSEvent) error {
	var payload MilestoneSubmittedPayload
	if err := json.Unmarshal(event.Data, &payload); err != nil {
		return fmt.Errorf("unmarshal payload: %w", err)
	}

	title := "Milestone submitted"
	message := "A milestone has been submitted for your review."
	link := fmt.Sprintf("/projects/%s/milestones", payload.ProjectID)

	// Notify the talent as confirmation; in production, also look up
	// the project owner and notify them.
	return c.createAndDeliver(ctx, payload.TalentID, store.TypeMilestoneUpdate,
		title, message, &link, []string{"in_app"})
}

func (c *Consumer) handleMilestoneApproved(ctx context.Context, event NATSEvent) error {
	var payload MilestoneApprovedPayload
	if err := json.Unmarshal(event.Data, &payload); err != nil {
		return fmt.Errorf("unmarshal payload: %w", err)
	}

	title := "Milestone approved"
	message := fmt.Sprintf("Your milestone has been approved. Payment of Rp %d will be released.", payload.Amount)
	link := fmt.Sprintf("/projects/%s/milestones", payload.ProjectID)

	return c.createAndDeliver(ctx, payload.TalentID, store.TypeMilestoneUpdate,
		title, message, &link, []string{"in_app", "email"})
}

func (c *Consumer) handleMilestoneRejected(ctx context.Context, event NATSEvent) error {
	var payload MilestoneSubmittedPayload
	if err := json.Unmarshal(event.Data, &payload); err != nil {
		return fmt.Errorf("unmarshal payload: %w", err)
	}

	title := "Milestone rejected"
	message := "Your milestone submission has been rejected. Please review the feedback."
	link := fmt.Sprintf("/projects/%s/milestones", payload.ProjectID)

	return c.createAndDeliver(ctx, payload.TalentID, store.TypeMilestoneUpdate,
		title, message, &link, []string{"in_app", "email"})
}

func (c *Consumer) handleMilestoneRevisionRequested(ctx context.Context, event NATSEvent) error {
	var payload MilestoneSubmittedPayload
	if err := json.Unmarshal(event.Data, &payload); err != nil {
		return fmt.Errorf("unmarshal payload: %w", err)
	}

	title := "Revision requested"
	message := "A revision has been requested for your milestone."
	link := fmt.Sprintf("/projects/%s/milestones", payload.ProjectID)

	return c.createAndDeliver(ctx, payload.TalentID, store.TypeMilestoneUpdate,
		title, message, &link, []string{"in_app", "email"})
}

func (c *Consumer) handleMilestoneOverdue(ctx context.Context, event NATSEvent) error {
	var payload MilestoneSubmittedPayload
	if err := json.Unmarshal(event.Data, &payload); err != nil {
		return fmt.Errorf("unmarshal payload: %w", err)
	}

	title := "Milestone overdue"
	message := "Your milestone is past due. Please submit as soon as possible."
	link := fmt.Sprintf("/projects/%s/milestones", payload.ProjectID)

	return c.createAndDeliver(ctx, payload.TalentID, store.TypeMilestoneUpdate,
		title, message, &link, []string{"in_app"})
}

func (c *Consumer) handleMilestoneDueSoon(ctx context.Context, event NATSEvent) error {
	var payload MilestoneSubmittedPayload
	if err := json.Unmarshal(event.Data, &payload); err != nil {
		return fmt.Errorf("unmarshal payload: %w", err)
	}

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

	// Push real-time via Centrifugo.
	if err := c.centrifugo.PublishUserNotification(ctx, userID, notif); err != nil {
		slog.Error("centrifugo publish failed", "error", err, "userId", userID)
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

func (c *Consumer) Close() {
	for _, cc := range c.contexts {
		cc.Stop()
	}
	if c.nc != nil {
		c.nc.Close()
	}
}

func strPtr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
