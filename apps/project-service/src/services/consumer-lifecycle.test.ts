import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * How the two NATS consumers come up, and how they go down.
 *
 * The integration suites drive what each consumer DOES with a message. What
 * neither can reach is the lifecycle around it, because both require a broker
 * that is misbehaving in a specific way.
 *
 * Two properties matter and both are about not making an outage worse. A
 * broker that is down at boot must not take the HTTP service down with it -
 * the events keep in their stream (PAYMENT_EVENTS retains for 90 days) and are
 * consumed when the broker returns, whereas a service that refuses to start
 * serves nobody. And shutdown must reach the end of its sequence even when the
 * connection is already broken: this runs on SIGTERM with a 30 second budget,
 * and an exception part-way through skips the drain that flushes in-flight
 * work.
 *
 * The `running` flag is what makes stop() safe to call when start() failed,
 * which index.ts does unconditionally on every shutdown.
 */

const h = vi.hoisted(() => ({
  connect: vi.fn(),
  jetstream: vi.fn(),
  jetstreamManager: vi.fn(),
  consume: vi.fn(),
  closeIterator: vi.fn(),
  drain: vi.fn(),
  close: vi.fn(),
}))

vi.mock('@nats-io/transport-node', () => ({
  connect: h.connect,
}))

vi.mock('@nats-io/jetstream', () => ({
  jetstream: h.jetstream,
  jetstreamManager: h.jetstreamManager,
  AckPolicy: { Explicit: 'explicit' },
}))

/** Both modules have the same shape; each case drives one of them. */
const CONSUMERS = [
  {
    label: 'invoice',
    module: './invoice-consumer',
    start: 'startInvoiceConsumer',
    stop: 'stopInvoiceConsumer',
    tag: '[InvoiceConsumer]',
  },
  {
    label: 'settlement',
    module: './settlement-consumer',
    start: 'startSettlementConsumer',
    stop: 'stopSettlementConsumer',
    tag: '[SettlementConsumer]',
  },
] as const

type Lifecycle = Record<string, () => Promise<void>>

async function load(module: string): Promise<Lifecycle> {
  vi.resetModules()
  return (await import(module)) as unknown as Lifecycle
}

/** A connection whose consumer can be created and consumed from. */
function healthyBroker(): void {
  h.connect.mockResolvedValue({ drain: h.drain, close: h.close })
  h.jetstream.mockReturnValue({
    consumers: { get: async () => ({ consume: h.consume }) },
  })
  h.jetstreamManager.mockResolvedValue({
    consumers: { info: async () => ({}), add: async () => ({}) },
  })
  h.consume.mockResolvedValue({ close: h.closeIterator })
}

describe.each(CONSUMERS)('$label consumer lifecycle', ({ module, start, stop, tag }) => {
  let logged: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    for (const fn of Object.values(h)) fn.mockReset()
    h.drain.mockResolvedValue(undefined)
    h.close.mockResolvedValue(undefined)
    h.closeIterator.mockResolvedValue(undefined)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    logged = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('connects and begins consuming', async () => {
    healthyBroker()
    const mod = await load(module)

    await mod[start]()

    expect(h.connect).toHaveBeenCalledTimes(1)
    expect(h.consume).toHaveBeenCalledTimes(1)
  })

  /**
   * The service must stay up. Refusing to boot because the broker is down
   * takes every HTTP route with it, and the events are durable anyway.
   */
  it('survives a broker that is down at boot', async () => {
    h.connect.mockRejectedValue(new Error('ECONNREFUSED'))
    const mod = await load(module)

    await expect(mod[start]()).resolves.toBeUndefined()

    expect(logged).toHaveBeenCalledWith(`${tag} start failed:`, expect.any(Error))
  })

  /**
   * index.ts calls stop unconditionally on SIGTERM, including when start
   * failed. Draining a connection that was never established would throw
   * inside the shutdown path.
   */
  it('makes shutdown a no-op when the consumer never started', async () => {
    h.connect.mockRejectedValue(new Error('ECONNREFUSED'))
    const mod = await load(module)
    await mod[start]()

    await expect(mod[stop]()).resolves.toBeUndefined()

    expect(h.drain).not.toHaveBeenCalled()
  })

  it('is a no-op when stop is called twice', async () => {
    healthyBroker()
    const mod = await load(module)
    await mod[start]()
    await mod[stop]()

    await mod[stop]()

    expect(h.drain).toHaveBeenCalledTimes(1)
  })

  it('closes the iterator and drains the connection on shutdown', async () => {
    healthyBroker()
    const mod = await load(module)
    await mod[start]()

    await mod[stop]()

    expect(h.closeIterator).toHaveBeenCalledTimes(1)
    expect(h.drain).toHaveBeenCalledTimes(1)
  })

  /**
   * A broken iterator must not skip the drain. The drain is what flushes
   * in-flight acknowledgements, so losing it redelivers work that was already
   * done.
   */
  it('still drains when closing the iterator throws', async () => {
    healthyBroker()
    h.closeIterator.mockRejectedValue(new Error('iterator already closed'))
    const mod = await load(module)
    await mod[start]()

    await expect(mod[stop]()).resolves.toBeUndefined()

    expect(logged).toHaveBeenCalledWith(`${tag} close iterator error:`, expect.any(Error))
    expect(h.drain).toHaveBeenCalledTimes(1)
  })

  /** A connection too broken to drain still has to be released. */
  it('forces a close when the drain fails', async () => {
    healthyBroker()
    h.drain.mockRejectedValue(new Error('connection reset'))
    const mod = await load(module)
    await mod[start]()

    await expect(mod[stop]()).resolves.toBeUndefined()

    expect(logged).toHaveBeenCalledWith(`${tag} drain error, forcing close:`, expect.any(Error))
    expect(h.close).toHaveBeenCalledTimes(1)
  })

  /** Already closed is the expected case here, not an error worth raising. */
  it('completes shutdown when even the forced close fails', async () => {
    healthyBroker()
    h.drain.mockRejectedValue(new Error('connection reset'))
    h.close.mockRejectedValue(new Error('already closed'))
    const mod = await load(module)
    await mod[start]()

    await expect(mod[stop]()).resolves.toBeUndefined()
  })
})
