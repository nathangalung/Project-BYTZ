import { type NatsHeaderCarrier, restoreTraceContext } from '@kerjacus/logger'
import {
  AckPolicy,
  type Consumer,
  type ConsumerMessages,
  type JetStreamClient,
  type JsMsg,
  jetstream,
  jetstreamManager,
} from '@nats-io/jetstream'
import { connect, type NatsConnection } from '@nats-io/transport-node'
import { context, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api'
import { env } from '../lib/env'
import { getInvoiceService } from '../routes/invoices'

const STREAM = 'MILESTONE_EVENTS'
const DURABLE = 'project-invoice-generator'
const FILTER_SUBJECT = 'milestone.invoice_requested'

const tracer = trace.getTracer('project-service-invoice-consumer')

let natsConn: NatsConnection | null = null
let js: JetStreamClient | null = null
let messages: ConsumerMessages | null = null
let running = false

type InvoiceEvent = {
  id: string
  type: string
  source?: string
  timestamp?: string
  correlationId?: string
  data: { milestoneId: string; projectId?: string }
}

async function ensureConsumer(): Promise<Consumer> {
  if (!natsConn) throw new Error('NATS connection not initialized')
  const mgr = await jetstreamManager(natsConn)
  try {
    await mgr.consumers.add(STREAM, {
      durable_name: DURABLE,
      ack_policy: AckPolicy.Explicit,
      ack_wait: 30 * 1_000_000_000,
      max_deliver: 3,
      filter_subject: FILTER_SUBJECT,
    })
  } catch (err) {
    // Already exists is fine. Anything else is a real failure.
    const msg = err instanceof Error ? err.message : String(err)
    if (!/already in use|already exists|consumer name already in use/i.test(msg)) {
      throw err
    }
  }
  // biome-ignore lint/style/noNonNullAssertion: js initialized alongside natsConn
  return await js!.consumers.get(STREAM, DURABLE)
}

async function handle(msg: JsMsg): Promise<void> {
  const headers = msg.headers as unknown as NatsHeaderCarrier | undefined
  const carrier = headers
    ? {
        get: (k: string) => headers.get(k) ?? '',
        set: (k: string, v: string) => headers.set(k, v),
        keys: () => headers.keys(),
      }
    : undefined
  const parentCtx = restoreTraceContext(
    carrier
      ? carrier.keys().reduce<Record<string, string>>((acc, k) => {
          acc[k] = carrier.get(k)
          return acc
        }, {})
      : null,
  )

  await context.with(parentCtx, async () => {
    await tracer.startActiveSpan(
      `nats.consume ${msg.subject}`,
      {
        kind: SpanKind.CONSUMER,
        attributes: {
          'messaging.system': 'nats',
          'messaging.destination.name': msg.subject,
          'messaging.operation': 'process',
        },
      },
      async (span) => {
        try {
          const text = new TextDecoder().decode(msg.data)
          const event = JSON.parse(text) as InvoiceEvent
          span.setAttribute('messaging.message.id', event.id)
          span.setAttribute('event.type', event.type)

          const milestoneId = event.data?.milestoneId
          if (!milestoneId) {
            span.setStatus({ code: SpanStatusCode.ERROR, message: 'missing milestoneId' })
            msg.term('missing milestoneId')
            return
          }

          const service = getInvoiceService()
          // Idempotent: invoice.service.findByMilestone short-circuits duplicates.
          await service.generateInvoice(milestoneId, { isAdminCopy: false })
          await service.generateInvoice(milestoneId, { isAdminCopy: true })

          msg.ack()
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err)
          span.setStatus({ code: SpanStatusCode.ERROR, message: errMsg })
          console.error('[InvoiceConsumer] handler error:', errMsg)
          // nak with backoff. JetStream will redeliver up to max_deliver, then
          // notification-service consumer handles DLQ for other subjects; for
          // milestone.invoice_requested we let JetStream drop after max retries.
          msg.nak(5_000)
        } finally {
          span.end()
        }
      },
    )
  })
}

export async function startInvoiceConsumer(): Promise<void> {
  try {
    natsConn = await connect({ servers: env.NATS_URL })
    js = jetstream(natsConn)
    const consumer = await ensureConsumer()
    messages = await consumer.consume({ callback: (m) => void handle(m) })
    running = true
    console.log('[InvoiceConsumer] started')
  } catch (err) {
    console.error('[InvoiceConsumer] start failed:', err)
    // Leave running=false so stop() is a no-op. Service stays up; invoice
    // events accumulate in MILESTONE_EVENTS until consumer recovers.
  }
}

export async function stopInvoiceConsumer(): Promise<void> {
  if (!running) return
  running = false
  if (messages) {
    try {
      await messages.close()
    } catch (err) {
      console.error('[InvoiceConsumer] close iterator error:', err)
    }
    messages = null
  }
  if (natsConn) {
    try {
      await natsConn.drain()
    } catch (err) {
      console.error('[InvoiceConsumer] drain error, forcing close:', err)
      try {
        await natsConn.close()
      } catch {
        // already closed
      }
    }
    natsConn = null
    js = null
  }
  console.log('[InvoiceConsumer] stopped')
}
