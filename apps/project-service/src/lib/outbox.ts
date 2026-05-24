import { outboxEvents } from '@kerjacus/db'
import { captureTraceContext } from '@kerjacus/logger'
import { uuidv7 } from 'uuidv7'

type OutboxInput = {
  aggregateType: string
  aggregateId: string
  eventType: string
  payload: unknown
  id?: string
}

type DbLike = {
  insert: (table: typeof outboxEvents) => {
    values: (row: typeof outboxEvents.$inferInsert) => Promise<unknown>
  }
}

// Insert outbox row with captured trace context.
export async function appendOutboxEvent(db: DbLike, input: OutboxInput): Promise<void> {
  const traceContext = captureTraceContext()
  await db.insert(outboxEvents).values({
    id: input.id ?? uuidv7(),
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    eventType: input.eventType,
    payload: input.payload as never,
    traceContext: traceContext as never,
  })
}
