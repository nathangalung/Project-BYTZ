import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Graceful shutdown: the thirty seconds between SIGTERM and the orchestrator
 * killing the process.
 *
 * What has to happen in that window is that the outbox worker finishes its
 * in-flight batch and the two NATS consumers drain, so acknowledgements
 * already earned are flushed rather than dropped and redelivered. The whole
 * sequence is registered on a signal and ends in `process.exit(0)`, which is
 * why nothing had executed it - importing the module to test it would have
 * killed the test runner.
 *
 * The branch that matters is that each stop is individually guarded. A stop
 * that throws must not skip the ones after it: the consumers are stopped
 * first and the outbox last, so an exception from a broken NATS connection
 * would otherwise take out the outbox drain, which is the one holding
 * unpublished events. That is a silent data-loss path on every deploy where
 * NATS is unhealthy - exactly when it is most likely to happen.
 *
 * A separate file from index-auth-dispatch because these mocks throw and
 * those do not, and each test file gets its own module registry.
 */

const h = vi.hoisted(() => ({
  stopScheduled: vi.fn(),
  stopInvoice: vi.fn(),
  stopSettlement: vi.fn(),
  stopOutbox: vi.fn(),
}))

vi.mock('./otel', () => ({}))
vi.mock('./services/outbox-worker', () => ({
  startOutboxProcessor: async () => {},
  stopOutboxProcessor: h.stopOutbox,
}))
vi.mock('./services/scheduled-jobs', () => ({
  startScheduledJobs: () => {},
  stopScheduledJobs: h.stopScheduled,
}))
vi.mock('./services/invoice-consumer', () => ({
  startInvoiceConsumer: async () => {},
  stopInvoiceConsumer: h.stopInvoice,
}))
vi.mock('./services/settlement-consumer', () => ({
  startSettlementConsumer: async () => {},
  stopSettlementConsumer: h.stopSettlement,
}))

type Signal = 'SIGTERM' | 'SIGINT'

/**
 * Re-import the module with the signal registration intercepted, and hand
 * back the handlers it installed. Fresh each time, because `shuttingDown` is
 * module-level and latches on the first call.
 */
async function bootAndCaptureSignals(): Promise<Map<Signal, () => void>> {
  vi.resetModules()
  const handlers = new Map<Signal, () => void>()
  const realOn = process.on.bind(process)

  vi.spyOn(process, 'on').mockImplementation(((event: string, handler: () => void) => {
    if (event === 'SIGTERM' || event === 'SIGINT') {
      handlers.set(event, handler)
      return process
    }
    return realOn(event as 'exit', handler)
  }) as never)

  await import('./index')
  return handlers
}

/** Drive one signal and wait for the async shutdown chain to settle. */
async function raise(handlers: Map<Signal, () => void>, signal: Signal): Promise<void> {
  const handler = handlers.get(signal)
  if (!handler) throw new Error(`no ${signal} handler was registered`)
  handler()
  // The handler is sync and fires an async shutdown; let its promise chain run.
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
}

describe('graceful shutdown', () => {
  let exit: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    for (const fn of Object.values(h)) fn.mockReset()
    h.stopInvoice.mockResolvedValue(undefined)
    h.stopSettlement.mockResolvedValue(undefined)
    h.stopOutbox.mockResolvedValue(undefined)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each(['SIGTERM', 'SIGINT'] as const)('registers a %s handler', async (signal) => {
    const handlers = await bootAndCaptureSignals()

    expect(handlers.has(signal)).toBe(true)
  })

  it('stops the scheduler, both consumers and the outbox, then exits zero', async () => {
    const handlers = await bootAndCaptureSignals()

    await raise(handlers, 'SIGTERM')

    expect(h.stopScheduled).toHaveBeenCalledTimes(1)
    expect(h.stopInvoice).toHaveBeenCalledTimes(1)
    expect(h.stopSettlement).toHaveBeenCalledTimes(1)
    expect(h.stopOutbox).toHaveBeenCalledTimes(1)
    expect(exit).toHaveBeenCalledWith(0)
  })

  it('shuts down on SIGINT the same way', async () => {
    const handlers = await bootAndCaptureSignals()

    await raise(handlers, 'SIGINT')

    expect(h.stopOutbox).toHaveBeenCalledTimes(1)
    expect(exit).toHaveBeenCalledWith(0)
  })

  /**
   * Orchestrators send SIGTERM and then SIGINT, or a shell forwards both. The
   * second must not restart a drain that is already half-finished.
   */
  it('ignores a second signal while already shutting down', async () => {
    const handlers = await bootAndCaptureSignals()

    await raise(handlers, 'SIGTERM')
    await raise(handlers, 'SIGINT')

    expect(h.stopOutbox).toHaveBeenCalledTimes(1)
    expect(exit).toHaveBeenCalledTimes(1)
  })

  /**
   * The data-loss branch. The outbox is drained last, so a consumer that
   * throws on the way down must not carry the exception past its own try -
   * unpublished events would sit in the table until the next boot, and on a
   * scale-down that never comes.
   */
  it('still drains the outbox when the invoice consumer fails to stop', async () => {
    h.stopInvoice.mockRejectedValue(new Error('connection already destroyed'))
    const handlers = await bootAndCaptureSignals()

    await raise(handlers, 'SIGTERM')

    expect(h.stopOutbox).toHaveBeenCalledTimes(1)
    expect(exit).toHaveBeenCalledWith(0)
  })

  it('still drains the outbox when the settlement consumer fails to stop', async () => {
    h.stopSettlement.mockRejectedValue(new Error('connection already destroyed'))
    const handlers = await bootAndCaptureSignals()

    await raise(handlers, 'SIGTERM')

    expect(h.stopOutbox).toHaveBeenCalledTimes(1)
    expect(exit).toHaveBeenCalledWith(0)
  })

  /** Even the last one failing must still reach the exit. */
  it('exits zero when the outbox itself fails to stop', async () => {
    h.stopOutbox.mockRejectedValue(new Error('worker stuck'))
    const handlers = await bootAndCaptureSignals()

    await raise(handlers, 'SIGTERM')

    expect(exit).toHaveBeenCalledWith(0)
  })

  it('names which component failed to stop', async () => {
    h.stopSettlement.mockRejectedValue(new Error('connection already destroyed'))
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const handlers = await bootAndCaptureSignals()

    await raise(handlers, 'SIGTERM')

    // An operator reading the deploy log has to be able to tell which one.
    expect(logged).toHaveBeenCalledWith(
      '[project-service] settlement consumer stop error:',
      expect.any(Error),
    )
  })

  /** The scheduler stops first and synchronously; nothing may precede it. */
  it('stops the scheduler before anything that can block', async () => {
    const order: string[] = []
    h.stopScheduled.mockImplementation(() => void order.push('scheduler'))
    h.stopInvoice.mockImplementation(async () => void order.push('invoice'))
    h.stopSettlement.mockImplementation(async () => void order.push('settlement'))
    h.stopOutbox.mockImplementation(async () => void order.push('outbox'))
    const handlers = await bootAndCaptureSignals()

    await raise(handlers, 'SIGTERM')

    expect(order).toEqual(['scheduler', 'invoice', 'settlement', 'outbox'])
  })
})
