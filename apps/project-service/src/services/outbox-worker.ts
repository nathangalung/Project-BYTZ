import { deadLetterEvents, getDb, outboxEvents } from '@kerjacus/db'
import {
  injectNatsTraceContext,
  type NatsHeaderCarrier,
  restoreTraceContext,
} from '@kerjacus/logger'
import { type JetStreamClient, jetstream } from '@nats-io/jetstream'
import { connect, headers, type NatsConnection } from '@nats-io/transport-node'
import { context, isSpanContextValid, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api'
import { and, eq, lt } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { env } from '../lib/env'

const tracer = trace.getTracer('project-service-outbox')

let natsConn: NatsConnection | null = null
let js: JetStreamClient | null = null
let running = false
let pollLoop: Promise<void> | null = null

/** Poll interval when the last pass was healthy. */
const POLL_INTERVAL_MS = 1000
/** Ceiling for the backoff a failing NATS applies to the poll interval. */
const MAX_BACKOFF_MS = 30_000

/**
 * Try once to connect, reporting whether it worked.
 *
 * It used to swallow the failure and return. Startup called it once, so a
 * broker that was down for the ten seconds the service happened to boot in
 * left `js` null for the entire life of the process: every pass returned 0 at
 * the first line, the rows piled up unpublished, and nothing said so. The
 * retry now lives in the poll loop, which is the thing that runs forever.
 */
async function connectNats(): Promise<boolean> {
  try {
    natsConn = await connect({ servers: env.NATS_URL })
    js = jetstream(natsConn)
    console.log('[Outbox] Connected to NATS')
    return true
  } catch (err) {
    natsConn = null
    js = null
    console.error('[Outbox] NATS connection failed:', err)
    return false
  }
}

/**
 * Whether the publisher currently holds a JetStream client.
 *
 * Read by the readiness probe. Without it a disconnected publisher was
 * indistinguishable from a healthy one from outside the process.
 */
export function isOutboxConnected(): boolean {
  return js !== null
}

/**
 * How long the next poll should wait, given how many passes in a row have
 * failed to publish.
 *
 * Exported for the test, and because the shape of the curve is the fix: the
 * retry budget is three attempts and the poll interval was a flat second, so a
 * NATS blip of about three seconds spent all three on every pending row and
 * dead lettered the lot. Doubling puts the three attempts at 0s, 2s and 6s and
 * reaches the 30s ceiling after five failures.
 *
 * It widens the window rather than removing the cliff: the budget is a count of
 * attempts, not a span of time. Making downtime survivable outright needs the
 * row to carry its own next_attempt_at, which is a schema change and is not
 * done here.
 */
export function backoffMs(consecutiveFailures: number): number {
  if (consecutiveFailures <= 0) return POLL_INTERVAL_MS
  return Math.min(POLL_INTERVAL_MS * 2 ** consecutiveFailures, MAX_BACKOFF_MS)
}

type OutboxEvent = typeof outboxEvents.$inferSelect

/** Publish one row to JetStream under a span linked to the request that wrote it. */
async function publishEvent(client: JetStreamClient, event: OutboxEvent): Promise<void> {
  const parentCtx = restoreTraceContext(event.traceContext as Record<string, string> | null)
  await context.with(parentCtx, async () => {
    await tracer.startActiveSpan(
      `nats.publish ${event.eventType}`,
      {
        kind: SpanKind.PRODUCER,
        attributes: {
          'messaging.system': 'nats',
          'messaging.destination.name': event.eventType,
          'messaging.message.id': event.id,
          'messaging.operation': 'publish',
        },
      },
      async (span) => {
        try {
          // correlationId = trace_id of this publish span. Because parent
          // context was restored from outbox row, this id ties the event
          // back to the original request that wrote the row.
          const spanCtx = span.spanContext()
          const correlationId = isSpanContextValid(spanCtx) ? spanCtx.traceId : undefined
          const envelope = {
            id: event.id,
            type: event.eventType,
            source: 'project-service',
            timestamp: (event.createdAt ?? new Date()).toISOString(),
            ...(correlationId ? { correlationId } : {}),
            data: event.payload,
          }
          const hdr = headers()
          injectNatsTraceContext(hdr as unknown as NatsHeaderCarrier)
          await client.publish(event.eventType, JSON.stringify(envelope), {
            msgID: event.id,
            headers: hdr,
          })
        } catch (err) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) })
          throw err
        } finally {
          span.end()
        }
      },
    )
  })
}

type ClaimOutcome =
  | { kind: 'published' }
  | { kind: 'taken' }
  | { kind: 'failed'; event: OutboxEvent; error: unknown }

/**
 * Publish one event under a row lock, then mark it published.
 *
 * FOR UPDATE SKIP LOCKED is what makes two replicas take disjoint work: the
 * second poller walks straight past a row the first is holding instead of
 * publishing it a second time. The lock is per event and lives exactly as long
 * as the publish - one transaction spanning the whole batch of 100 would pin a
 * connection and hold back vacuum for as long as NATS took to accept them all.
 *
 * The row is re-checked inside the transaction because the batch that selected
 * it took no lock: by now another replica may have published it, or its retry
 * budget may be spent.
 *
 * Publishing inside the transaction is deliberate. Marking the row first would
 * lose the event if the publish then failed; committing first and publishing
 * after is the same dual-write the outbox exists to remove. A crash between
 * publish and commit republishes, which the msgID dedup window absorbs.
 */
async function claimAndPublish(
  db: ReturnType<typeof getDb>,
  client: JetStreamClient,
  id: string,
): Promise<ClaimOutcome> {
  let claimed: OutboxEvent | undefined

  try {
    await db.transaction(async (tx) => {
      const [event] = await tx
        .select()
        .from(outboxEvents)
        .where(
          and(
            eq(outboxEvents.id, id),
            eq(outboxEvents.published, false),
            lt(outboxEvents.retryCount, 3),
          ),
        )
        .limit(1)
        .for('update', { skipLocked: true })

      if (!event) return
      claimed = event

      await publishEvent(client, event)

      await tx
        .update(outboxEvents)
        .set({ published: true, publishedAt: new Date() })
        .where(eq(outboxEvents.id, event.id))
    })
  } catch (error) {
    // A publish failure rolls the claim back, so the retry bookkeeping below
    // has to run on its own connection or it would roll back with it.
    if (!claimed) throw error
    return { kind: 'failed', event: claimed, error }
  }

  return claimed ? { kind: 'published' } : { kind: 'taken' }
}

/**
 * Record a failed publish: bump retry_count, dead-letter once the budget is
 * spent. Both writes commit together.
 *
 * They were two autocommits. A crash between them left the dead-letter row
 * written and retry_count still at 2, so the next pass retried, failed again
 * and inserted a SECOND dead-letter row for one event. An admin reprocessing
 * the queue then republished it twice - and the reprocess path mints a fresh
 * msgID specifically to bypass JetStream dedup, so both copies are delivered.
 */
async function recordFailure(
  db: ReturnType<typeof getDb>,
  event: OutboxEvent,
  error: unknown,
): Promise<void> {
  const retryCount = (event.retryCount ?? 0) + 1
  const errMsg = error instanceof Error ? error.message : String(error)

  await db.transaction(async (tx) => {
    if (retryCount >= 3) {
      await tx.insert(deadLetterEvents).values({
        id: uuidv7(),
        originalEventId: event.id,
        eventType: event.eventType,
        payload: event.payload,
        traceContext: event.traceContext as never,
        consumerService: 'outbox-processor',
        errorMessage: errMsg,
        retryCount,
        reprocessed: false,
        createdAt: new Date(),
      })
    }

    await tx
      .update(outboxEvents)
      .set({ retryCount, errorMessage: errMsg })
      .where(eq(outboxEvents.id, event.id))
  })
}

/**
 * One pass over the outbox, reporting both outcomes.
 *
 * The failure count is what the poll loop backs off on: a broker that is
 * refusing every publish should be retried more slowly than one that is merely
 * idle, because each pass against it spends one of the three retries a row
 * gets before it is dead lettered.
 *
 * The client is a parameter so a test can drive a pass without standing up the
 * poll loop; production always takes the connection made at startup.
 */
export async function pollPass(
  client: JetStreamClient | null = js,
): Promise<{ published: number; failed: number }> {
  if (!client) return { published: 0, failed: 0 }

  const db = getDb()
  // Candidates only, no lock. Whether this replica may publish a row is
  // decided per event, under the lock claimAndPublish takes.
  const candidates = await db
    .select({ id: outboxEvents.id })
    .from(outboxEvents)
    .where(and(eq(outboxEvents.published, false), lt(outboxEvents.retryCount, 3)))
    // created_at alone has no tiebreak, so same-millisecond events came back in
    // an arbitrary order. The ids are UUIDv7 and sort by time, so they settle it.
    .orderBy(outboxEvents.createdAt, outboxEvents.id)
    .limit(100)

  let published = 0
  let failed = 0

  for (const candidate of candidates) {
    const outcome = await claimAndPublish(db, client, candidate.id)
    if (outcome.kind === 'published') published++
    else if (outcome.kind === 'failed') {
      failed++
      await recordFailure(db, outcome.event, outcome.error)
    }
  }

  return { published, failed }
}

/** One pass, counted by what it published. Kept for callers that only need that. */
export async function pollAndPublish(client: JetStreamClient | null = js): Promise<number> {
  return (await pollPass(client)).published
}

export async function startOutboxProcessor(): Promise<void> {
  await connectNats()
  running = true
  console.log('[Outbox] Processor started')

  const poll = async () => {
    // Passes in a row that could not reach the broker. Reset by any pass that
    // publishes or finds nothing wrong, so a single blip does not slow the
    // loop down for the rest of the day.
    let consecutiveFailures = 0

    while (running) {
      try {
        if (!js) {
          // The retry the boot-time connect never had. Counted as a failure so
          // a broker that stays down is dialled at the same widening interval
          // rather than once a second forever.
          consecutiveFailures = (await connectNats()) ? 0 : consecutiveFailures + 1
        }

        if (js) {
          const { published, failed } = await pollPass()
          if (published > 0) {
            console.log(`[Outbox] Published ${published} events`)
          }
          consecutiveFailures = failed > 0 ? consecutiveFailures + 1 : 0
        }
      } catch (err) {
        console.error('[Outbox] Poll error:', err)
        consecutiveFailures++
      }
      await new Promise((r) => setTimeout(r, backoffMs(consecutiveFailures)))
    }
  }

  pollLoop = poll()
}

export async function stopOutboxProcessor(): Promise<void> {
  running = false

  // Let any in-flight pollAndPublish finish before draining the connection,
  // otherwise mid-publish events can be dropped without DB ack.
  if (pollLoop) {
    try {
      await pollLoop
    } catch (err) {
      console.error('[Outbox] Poll loop exited with error:', err)
    }
    pollLoop = null
  }

  if (natsConn) {
    // drain() flushes pending publishes and closes the connection — preferred
    // over close() which drops in-flight messages. Fall back to close() if the
    // drain itself errors (e.g. server already gone).
    try {
      await natsConn.drain()
    } catch (err) {
      console.error('[Outbox] NATS drain error, forcing close:', err)
      try {
        await natsConn.close()
      } catch {
        // already closed
      }
    }
    natsConn = null
    js = null
  }
  console.log('[Outbox] Processor stopped')
}
