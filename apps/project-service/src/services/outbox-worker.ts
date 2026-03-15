// Outbox pattern worker for reliable event publishing
// Polls outbox_events table and publishes to NATS JetStream
export async function startOutboxWorker() {
  console.log('[Outbox] Worker ready (placeholder - polls outbox_events table)')

  // Production implementation:
  // 1. Connect to NATS via @nats-io/transport-node
  // 2. Access JetStream for publishing
  // 3. Start polling loop (every 1 second):
  //    a. SELECT * FROM outbox_events WHERE published = false ORDER BY created_at LIMIT 100
  //    b. For each event:
  //       - Publish to NATS subject (event.eventType) with payload
  //       - Set msgID = event.id for deduplication
  //       - On success: UPDATE outbox_events SET published = true, published_at = NOW()
  //       - On failure: INCREMENT retry_count, SET error_message
  //       - If retry_count >= 3: move to dead_letter_events table
  // 4. Graceful shutdown: stop polling, finish in-flight publishes
}
