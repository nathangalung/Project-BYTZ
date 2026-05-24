import {
  type Context,
  context,
  propagation,
  type TextMapGetter,
  type TextMapSetter,
} from '@opentelemetry/api'

// Duck-typed carrier matching nats MsgHdrs surface.
// Kept here so this package doesn't take a @nats-io/* dependency.
export type NatsHeaderCarrier = {
  get(key: string): string
  set(key: string, value: string): void
  keys(): string[]
}

const setter: TextMapSetter<NatsHeaderCarrier> = {
  set(carrier, key, value) {
    carrier.set(key, value)
  },
}

const getter: TextMapGetter<NatsHeaderCarrier> = {
  get(carrier, key) {
    const value = carrier.get(key)
    return value === '' ? undefined : value
  },
  keys(carrier) {
    return carrier.keys()
  },
}

export function injectNatsTraceContext(
  carrier: NatsHeaderCarrier,
  ctx: Context = context.active(),
): void {
  propagation.inject(ctx, carrier, setter)
}

export function extractNatsTraceContext(
  carrier: NatsHeaderCarrier | undefined,
  ctx: Context = context.active(),
): Context {
  if (!carrier) return ctx
  return propagation.extract(ctx, carrier, getter)
}

// Plain serializable carrier for storing trace context in JSONB.
class RecordCarrier {
  data: Record<string, string> = {}
  get(key: string): string {
    return this.data[key] ?? ''
  }
  set(key: string, value: string): void {
    this.data[key] = value
  }
  keys(): string[] {
    return Object.keys(this.data)
  }
}

// captureTraceContext serializes the active trace context to a plain object
// suitable for storing in a JSONB column (e.g. outbox_events.trace_context).
export function captureTraceContext(
  ctx: Context = context.active(),
): Record<string, string> | null {
  const carrier = new RecordCarrier()
  propagation.inject(ctx, carrier, setter)
  const keys = carrier.keys()
  if (keys.length === 0) return null
  return carrier.data
}

// restoreTraceContext rebuilds a Context from a previously captured object.
export function restoreTraceContext(
  stored: Record<string, string> | null | undefined,
  ctx: Context = context.active(),
): Context {
  if (!stored) return ctx
  const carrier = new RecordCarrier()
  carrier.data = stored
  return propagation.extract(ctx, carrier, getter)
}
