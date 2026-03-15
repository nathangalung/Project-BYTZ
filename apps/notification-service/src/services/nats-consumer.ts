// NATS JetStream consumer for notifications
// Listens for platform events and creates in-app/email notifications
export async function startNatsConsumer() {
  console.log('[NATS] Consumer ready (placeholder - connect when NATS is configured)')

  // Production implementation:
  // 1. Connect to NATS via @nats-io/transport-node
  // 2. Access JetStream manager
  // 3. Create durable consumers for relevant streams:
  //    - PROJECT_EVENTS: project.status.changed, project.team.*
  //    - PAYMENT_EVENTS: payment.released, payment.refunded
  //    - MILESTONE_EVENTS: milestone.submitted, milestone.approved, milestone.overdue
  //    - WORKER_EVENTS: worker.assignment.*
  // 4. For each event:
  //    a. Check idempotency (Redis SET with event ID)
  //    b. Map event type to notification template
  //    c. Determine recipients based on event data
  //    d. Create notification in DB via notificationService.createNotification()
  //    e. Send email via Resend for email-worthy events
  //    f. Push via Centrifugo SSE for real-time
  //    g. msg.ack() on success, msg.nak() on failure
  // 5. DLQ: after MaxDeliver (3) failures, publish to dlq.notification.*
}
