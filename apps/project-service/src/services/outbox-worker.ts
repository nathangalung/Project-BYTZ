import { deadLetterEvents, getDb, outboxEvents } from '@kerjacus/db'
import { type JetStreamClient, jetstream } from '@nats-io/jetstream'
import { connect, type NatsConnection } from '@nats-io/transport-node'
import { and, eq, lt } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'

let natsConn: NatsConnection | null = null
let js: JetStreamClient | null = null
let running = false

async function connectNats(): Promise<void> {
  const url = process.env.NATS_URL || 'nats://localhost:4222'
  try {
    natsConn = await connect({ servers: url })
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
      await js.publish(event.eventType, JSON.stringify(event.payload), {
        msgID: event.id,
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
        // Move to dead letter
        await db.insert(deadLetterEvents).values({
          id: uuidv7(),
          originalEventId: event.id,
          eventType: event.eventType,
          payload: event.payload,
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

  poll()
}

export async function stopOutboxProcessor(): Promise<void> {
  running = false
  if (natsConn) {
    await natsConn.close()
    natsConn = null
    js = null
  }
  console.log('[Outbox] Processor stopped')
}
