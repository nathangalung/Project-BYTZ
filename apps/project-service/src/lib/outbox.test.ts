import { captureTraceContext, restoreTraceContext } from '@kerjacus/logger'
import { context, propagation, ROOT_CONTEXT, trace } from '@opentelemetry/api'
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks'
import { W3CTraceContextPropagator } from '@opentelemetry/core'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { appendOutboxEvent } from './outbox'

vi.mock('@kerjacus/db', () => ({
  outboxEvents: {},
}))

beforeAll(() => {
  propagation.setGlobalPropagator(new W3CTraceContextPropagator())
  const cm = new AsyncHooksContextManager()
  cm.enable()
  context.setGlobalContextManager(cm)
})

function makeSpanCtx(traceId: string, spanId: string) {
  return { traceId, spanId, traceFlags: 1, isRemote: false }
}

function fakeDb() {
  const captured: { row: unknown } = { row: null }
  return {
    db: {
      insert: () => ({
        values: async (row: unknown) => {
          captured.row = row
        },
      }),
    },
    captured,
  }
}

describe('appendOutboxEvent trace context capture', () => {
  it('captures active traceparent into row.traceContext', async () => {
    const { db, captured } = fakeDb()
    const spanCtx = makeSpanCtx('0af7651916cd43dd8448eb211c80319c', 'b7ad6b7169203331')
    const ctx = trace.setSpanContext(ROOT_CONTEXT, spanCtx)

    await context.with(ctx, async () => {
      await appendOutboxEvent(db, {
        aggregateType: 'milestone',
        aggregateId: 'm1',
        eventType: 'milestone.submitted',
        payload: { ok: true },
      })
    })

    const row = captured.row as { traceContext: Record<string, string> }
    expect(row.traceContext).toBeTruthy()
    expect(row.traceContext.traceparent).toMatch(
      /^00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01$/,
    )
  })

  it('restoreTraceContext yields original span context', () => {
    const original = makeSpanCtx('4bf92f3577b34da6a3ce929d0e0e4736', '00f067aa0ba902b7')
    const captured = captureTraceContext(trace.setSpanContext(ROOT_CONTEXT, original))
    expect(captured).toBeTruthy()

    const restored = restoreTraceContext(captured)
    const span = trace.getSpanContext(restored)
    expect(span?.traceId).toBe(original.traceId)
    expect(span?.spanId).toBe(original.spanId)
  })

  it('returns null traceContext when no active span', async () => {
    const { db, captured } = fakeDb()
    await appendOutboxEvent(db, {
      aggregateType: 'milestone',
      aggregateId: 'm2',
      eventType: 'milestone.submitted',
      payload: {},
    })
    const row = captured.row as { traceContext: unknown }
    expect(row.traceContext).toBeNull()
  })
})
