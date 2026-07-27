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

async function connectNats(): Promise<void> {
  try {
    natsConn = await connect({ servers: env.NATS_URL })
    js = jetstream(natsConn)
    console.log('[Outbox] Connected to NATS')
  } catch (err) {
    console.error('[Outbox] NATS connection failed:', err)
  }
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

/** Record a failed publish: bump retry_count, dead-letter once the budget is spent. */
async function recordFailure(
  db: ReturnType<typeof getDb>,
  event: OutboxEvent,
  error: unknown,
): Promise<void> {
  const retryCount = (event.retryCount ?? 0) + 1
  const errMsg = error instanceof Error ? error.message : String(error)

  if (retryCount >= 3) {
    await db.insert(deadLetterEvents).values({
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

  await db
    .update(outboxEvents)
    .set({ retryCount, errorMessage: errMsg })
    .where(eq(outboxEvents.id, event.id))
}

/**
 * One pass over the outbox. Returns how many events this caller published.
 *
 * The client is a parameter so a test can drive a pass without standing up the
 * poll loop; production always takes the connection made at startup.
 */
export async function pollAndPublish(client: JetStreamClient | null = js): Promise<number> {
  if (!client) return 0

  const db = getDb()
  // Candidates only, no lock. Whether this replica may publish a row is
  // decided per event, under the lock claimAndPublish takes.
  const candidates = await db
    .select({ id: outboxEvents.id })
    .from(outboxEvents)
    .where(and(eq(outboxEvents.published, false), lt(outboxEvents.retryCount, 3)))
    .orderBy(outboxEvents.createdAt)
    .limit(100)

  let published = 0

  for (const candidate of candidates) {
    const outcome = await claimAndPublish(db, client, candidate.id)
    if (outcome.kind === 'published') published++
    else if (outcome.kind === 'failed') await recordFailure(db, outcome.event, outcome.error)
  }

  return published
}

export async function startOutboxProcessor(): Promise<void> {
  await connectNats()
  running = true
  console.log('[Outbox] Processor started')

  const poll = async () => {
    while (running) {
      try {
        const count = await pollAndPublish()
        if (count > 0) {
          console.log(`[Outbox] Published ${count} events`)
        }
      } catch (err) {
        console.error('[Outbox] Poll error:', err)
      }
      await new Promise((r) => setTimeout(r, 1000))
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
