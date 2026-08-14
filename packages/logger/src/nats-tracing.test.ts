import { context, propagation, ROOT_CONTEXT, trace } from '@opentelemetry/api'
import { W3CTraceContextPropagator } from '@opentelemetry/core'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  captureTraceContext,
  extractNatsTraceContext,
  injectNatsTraceContext,
  type NatsHeaderCarrier,
  restoreTraceContext,
} from './nats-tracing'

/**
 * Trace context across a NATS hop, and it had no tests.
 *
 * This is what joins a span in the publisher to a span in the consumer. When it
 * breaks nothing fails: every service keeps logging, every trace is just short,
 * and the one question distributed tracing exists to answer, where the request
 * went after the event was published, silently stops having an answer.
 *
 * A propagator has to be registered globally or inject writes nothing, which is
 * itself the most likely way for this to be broken in production.
 */

beforeAll(() => {
  propagation.setGlobalPropagator(new W3CTraceContextPropagator())
})

/** Matches the nats MsgHdrs surface the real carrier duck-types. */
function headers(initial: Record<string, string> = {}): NatsHeaderCarrier & {
  data: Record<string, string>
} {
  const data = { ...initial }
  return {
    data,
    get: (k) => data[k] ?? '',
    set: (k, v) => {
      data[k] = v
    },
    keys: () => Object.keys(data),
  }
}

/** A context carrying a sampled span, which is what makes inject emit. */
function sampledContext() {
  return trace.setSpanContext(ROOT_CONTEXT, {
    traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
    spanId: '00f067aa0ba902b7',
    traceFlags: 1,
    isRemote: false,
  })
}

describe('injectNatsTraceContext', () => {
  it('writes traceparent onto the carrier', () => {
    const carrier = headers()

    injectNatsTraceContext(carrier, sampledContext())

    expect(carrier.data.traceparent).toContain('4bf92f3577b34da6a3ce929d0e0e4736')
  })

  it('writes nothing when there is no span to propagate', () => {
    const carrier = headers()

    injectNatsTraceContext(carrier, ROOT_CONTEXT)

    expect(carrier.keys()).toEqual([])
  })

  /**
   * No ContextManager is registered here, so context.active() is the root and
   * the default parameter produces nothing. That is the branch under test: the
   * argument is optional and falls back to whatever is active.
   */
  it('falls back to the active context when none is passed', () => {
    const carrier = headers()

    injectNatsTraceContext(carrier)

    expect(carrier.keys()).toEqual([])
  })
})

describe('extractNatsTraceContext', () => {
  it('rebuilds the span context a publisher injected', () => {
    const carrier = headers()
    injectNatsTraceContext(carrier, sampledContext())

    const extracted = extractNatsTraceContext(carrier, ROOT_CONTEXT)

    expect(trace.getSpanContext(extracted)?.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736')
  })

  /** A message published before tracing existed has no headers at all. */
  it('returns the given context when the carrier is absent', () => {
    expect(extractNatsTraceContext(undefined, ROOT_CONTEXT)).toBe(ROOT_CONTEXT)
  })

  /**
   * nats returns an empty string for a header it does not have, and the
   * propagator has to see undefined instead or it parses "" as a traceparent
   * and yields a context with no usable span.
   */
  it('treats an empty header as absent rather than as a value', () => {
    const extracted = extractNatsTraceContext(headers({ traceparent: '' }), ROOT_CONTEXT)

    expect(trace.getSpanContext(extracted)).toBeUndefined()
  })

  it('defaults to the active context', () => {
    const carrier = headers()
    injectNatsTraceContext(carrier, sampledContext())

    const traceId = context.with(
      ROOT_CONTEXT,
      () => trace.getSpanContext(extractNatsTraceContext(carrier))?.traceId,
    )

    expect(traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736')
  })
})

describe('captureTraceContext', () => {
  /** Stored in outbox_events.trace_context, so it has to be plain JSON. */
  it('returns a plain object a JSONB column can hold', () => {
    const captured = captureTraceContext(sampledContext())

    expect(captured).not.toBeNull()
    expect(JSON.parse(JSON.stringify(captured))).toEqual(captured)
    expect(captured?.traceparent).toContain('4bf92f3577b34da6a3ce929d0e0e4736')
  })

  /** Null rather than {} so the column stays honestly empty. */
  it('returns null when there is nothing to capture', () => {
    expect(captureTraceContext(ROOT_CONTEXT)).toBeNull()
  })

  it('falls back to the active context when none is passed', () => {
    expect(captureTraceContext()).toBeNull()
  })
})

describe('restoreTraceContext', () => {
  it('round-trips what captureTraceContext produced', () => {
    const stored = captureTraceContext(sampledContext())

    const restored = restoreTraceContext(stored, ROOT_CONTEXT)

    expect(trace.getSpanContext(restored)?.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736')
    expect(trace.getSpanContext(restored)?.spanId).toBe('00f067aa0ba902b7')
  })

  /** Rows written before the column existed carry null, and must not throw. */
  it('returns the given context for null or undefined', () => {
    expect(restoreTraceContext(null, ROOT_CONTEXT)).toBe(ROOT_CONTEXT)
    expect(restoreTraceContext(undefined, ROOT_CONTEXT)).toBe(ROOT_CONTEXT)
  })

  it('defaults to the active context', () => {
    const stored = captureTraceContext(sampledContext())

    const traceId = context.with(
      ROOT_CONTEXT,
      () => trace.getSpanContext(restoreTraceContext(stored))?.traceId,
    )

    expect(traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736')
  })
})
