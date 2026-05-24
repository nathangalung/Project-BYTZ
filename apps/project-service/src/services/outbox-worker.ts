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

async function pollAndPublish(): Promise<number> {
  if (!js) return 0

  const db = getDb()
  const events = await db
    .select()
    .from(outboxEvents)
    .where(and(eq(outboxEvents.published, false), lt(outboxEvents.retryCount, 3)))
    .orderBy(outboxEvents.createdAt)
    .limit(100)

  if (events.length === 0) return 0

  let published = 0

  for (const event of events) {
    try {
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
              // biome-ignore lint/style/noNonNullAssertion: js is checked above
              await js!.publish(event.eventType, JSON.stringify(envelope), {
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

      await db
        .update(outboxEvents)
        .set({ published: true, publishedAt: new Date() })
        .where(eq(outboxEvents.id, event.id))

      published++
    } catch (err) {
      const retryCount = (event.retryCount ?? 0) + 1
      const errMsg = err instanceof Error ? err.message : String(err)

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
