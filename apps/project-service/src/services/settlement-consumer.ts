import { getDb } from '@kerjacus/db'
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
import { ProjectRepository } from '../repositories/project.repository'
import { PaymentSettlementService } from './payment-settlement.service'
import { ProjectService } from './project.service'

/**
 * The durable half of learning that a payment settled.
 *
 * payment-service also POSTs /payment-callback, but that is one attempt with no
 * retry, and Midtrans redelivery cannot rescue it: the webhook's monotonic
 * status guard short-circuits every retry once the row is already completed. A
 * lost callback therefore meant an owner who paid for a BRD that stayed locked,
 * or a funded escrow on a project that never left prd_approved, with nothing to
 * reconcile it.
 *
 * Both paths land in the same PaymentSettlementService, every branch of which
 * is idempotent, so the callback and this consumer both running is a no-op.
 */

const STREAM = 'PAYMENT_EVENTS'
const DURABLE = 'project-payment-settlement'
const FILTER_SUBJECT = 'payment.settled'

const tracer = trace.getTracer('project-service-settlement-consumer')

let natsConn: NatsConnection | null = null
let js: JetStreamClient | null = null
let messages: ConsumerMessages | null = null
let running = false

type SettlementEvent = {
  id: string
  type: string
  data: { projectId?: string; orderId?: string; amount?: number }
}

async function ensureConsumer(): Promise<Consumer> {
  if (!natsConn) throw new Error('NATS connection not initialized')
  const mgr = await jetstreamManager(natsConn)
  try {
    await mgr.consumers.add(STREAM, {
      durable_name: DURABLE,
      ack_policy: AckPolicy.Explicit,
      ack_wait: 30 * 1_000_000_000,
      max_deliver: 5,
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
          const event = JSON.parse(new TextDecoder().decode(msg.data)) as SettlementEvent
          span.setAttribute('messaging.message.id', event.id)
          span.setAttribute('event.type', event.type)

          const { projectId, orderId, amount } = event.data ?? {}
          if (!projectId || !orderId) {
            // Unroutable, and no retry will make it routable.
            span.setStatus({ code: SpanStatusCode.ERROR, message: 'missing projectId or orderId' })
            msg.term('missing projectId or orderId')
            return
          }

          const db = getDb()
          const projects = new ProjectService(new ProjectRepository(db))
          const settlement = new PaymentSettlementService(db, (id, target, userId, reason) =>
            projects.transitionStatus(id, target, userId, reason),
          )
          await settlement.settle(projectId, orderId, amount)

          msg.ack()
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err)
          span.setStatus({ code: SpanStatusCode.ERROR, message: errMsg })
          console.error('[SettlementConsumer] handler error:', errMsg)
          msg.nak(5_000)
        } finally {
          span.end()
        }
      },
    )
  })
}

export async function startSettlementConsumer(): Promise<void> {
  try {
    natsConn = await connect({ servers: env.NATS_URL })
    js = jetstream(natsConn)
    const consumer = await ensureConsumer()
    messages = await consumer.consume({ callback: (m) => void handle(m) })
    running = true
    console.log('[SettlementConsumer] started')
  } catch (err) {
    console.error('[SettlementConsumer] start failed:', err)
    // Leave running=false so stop() is a no-op. Events wait in PAYMENT_EVENTS,
    // which retains for 90 days, until the consumer recovers.
  }
}

export async function stopSettlementConsumer(): Promise<void> {
  if (!running) return
  running = false
  if (messages) {
    try {
      await messages.close()
    } catch (err) {
      console.error('[SettlementConsumer] close iterator error:', err)
    }
    messages = null
  }
  if (natsConn) {
    try {
      await natsConn.drain()
    } catch (err) {
      console.error('[SettlementConsumer] drain error, forcing close:', err)
      try {
        await natsConn.close()
      } catch {
        // already closed
      }
    }
    natsConn = null
    js = null
  }
  console.log('[SettlementConsumer] stopped')
}
