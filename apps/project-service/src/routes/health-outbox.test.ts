import { describe, expect, it, vi } from 'vitest'

/**
 * An outbox publisher that has lost NATS is invisible from outside the
 * process: the rows are durable, they pile up, and nothing answers for it. The
 * readiness body carries the connection state so an operator can see it.
 *
 * It is reported, not failed on. The service still serves every read and write
 * while the publisher is disconnected and the queue drains on reconnect, so
 * taking the pod out of rotation over a broker blip costs availability and
 * publishes nothing.
 */

const h = vi.hoisted(() => ({
  execute: vi.fn(),
  connected: vi.fn(),
}))

vi.mock('@kerjacus/db', () => ({ getDb: () => ({ execute: h.execute }) }))
vi.mock('../services/outbox-worker', () => ({ isOutboxConnected: h.connected }))
vi.mock('drizzle-orm', () => ({ sql: (s: unknown) => s }))

const { healthRoute } = await import('./health')

async function ready() {
  const res = await healthRoute.request('/ready')
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

describe('GET /health/ready', () => {
  it('reports a connected publisher', async () => {
    h.execute.mockResolvedValue(undefined)
    h.connected.mockReturnValue(true)

    expect(await ready()).toEqual({ status: 200, body: { status: 'ready', outbox: 'connected' } })
  })

  it('names a disconnected publisher without failing the probe', async () => {
    h.execute.mockResolvedValue(undefined)
    h.connected.mockReturnValue(false)

    expect(await ready()).toEqual({
      status: 200,
      body: { status: 'ready', outbox: 'disconnected' },
    })
  })

  /** The database is the dependency the service genuinely cannot serve without. */
  it('still fails the probe when the database is unreachable', async () => {
    h.execute.mockRejectedValue(new Error('ECONNREFUSED'))
    h.connected.mockReturnValue(true)

    const { status, body } = await ready()
    expect(status).toBe(503)
    expect(body.status).toBe('not ready')
    expect(body.reason).toBe('database unreachable')
  })
})
