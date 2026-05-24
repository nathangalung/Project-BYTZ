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
