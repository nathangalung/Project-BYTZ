import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AI_HEALTH_WINDOW_MS, AiHealthSweepService } from './ai-health-sweep'

vi.setConfig({ testTimeout: 30_000 })

type Counts = { success: number; error: number }

function makeService(opts: { counts?: Counts; admins?: string[] }) {
  const readCounts = vi.fn(async (_since: Date) => opts.counts ?? { success: 0, error: 0 })
  const listAdmins = vi.fn(async () => opts.admins ?? ['admin-1'])
  const notify = vi.fn(async (_userId: string, _params: { errors: number; total: number }) => {})
  return {
    service: new AiHealthSweepService(readCounts, listAdmins, notify),
    readCounts,
    listAdmins,
    notify,
  }
}

describe('AiHealthSweepService', () => {
  beforeEach(() => vi.restoreAllMocks())

  /** The case that went unseen for days: every call failing, none succeeding. */
  it('alerts every admin when nothing is succeeding', async () => {
    const { service, notify } = makeService({
      counts: { success: 0, error: 40 },
      admins: ['admin-1', 'admin-2'],
    })

    const result = await service.sweep()

    expect(result).toEqual({ alerted: 2, errorCount: 40, successCount: 0 })
    expect(notify).toHaveBeenCalledTimes(2)
    expect(notify.mock.calls[0][0]).toBe('admin-1')
  })

  // The alert has to carry both numbers: 40 failures out of 41 calls is an
  // outage, 40 out of 4000 is noise, and the admin reading it cannot tell them
  // apart from the failure count alone. The wording itself lives in the
  // notification catalog, so what this asserts is the params.
  it('names the failing count and the total in the params', async () => {
    const { service, notify } = makeService({ counts: { success: 0, error: 40 } })

    await service.sweep()

    expect(notify.mock.calls[0][1]).toEqual({ errors: 40, total: 40 })
  })

  it('stays quiet while calls are succeeding', async () => {
    const { service, notify } = makeService({ counts: { success: 100, error: 1 } })

    const result = await service.sweep()

    expect(notify).not.toHaveBeenCalled()
    expect(result.alerted).toBe(0)
  })

  /** A handful of failures in a healthy window is noise, not an outage. */
  it('stays quiet below the failure floor', async () => {
    const { service, notify } = makeService({ counts: { success: 0, error: 2 } })

    await service.sweep()

    expect(notify).not.toHaveBeenCalled()
  })

  it('alerts when most calls fail even though some succeed', async () => {
    const { service, notify } = makeService({ counts: { success: 5, error: 45 } })

    await service.sweep()

    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('stays quiet on an idle window', async () => {
    const { service, notify } = makeService({ counts: { success: 0, error: 0 } })

    await service.sweep()

    expect(notify).not.toHaveBeenCalled()
  })

  it('reads a window ending now', async () => {
    const { service, readCounts } = makeService({ counts: { success: 0, error: 0 } })
    const before = Date.now()

    await service.sweep()

    const since = readCounts.mock.calls[0][0] as Date
    expect(before - since.getTime()).toBeGreaterThanOrEqual(AI_HEALTH_WINDOW_MS - 5_000)
    expect(before - since.getTime()).toBeLessThanOrEqual(AI_HEALTH_WINDOW_MS + 5_000)
  })

  it('keeps going when one admin notification fails', async () => {
    const { service } = makeService({ counts: { success: 0, error: 40 } })
    const notify = vi.fn(async (userId: string) => {
      if (userId === 'admin-1') throw new Error('centrifugo down')
    })
    const svc = new AiHealthSweepService(
      async () => ({ success: 0, error: 40 }),
      async () => ['admin-1', 'admin-2'],
      notify,
    )

    const result = await svc.sweep()

    expect(notify).toHaveBeenCalledTimes(2)
    expect(result.alerted).toBe(1)
    expect(service).toBeDefined()
  })

  it('does nothing when there is no admin to tell', async () => {
    const { service, notify } = makeService({ counts: { success: 0, error: 40 }, admins: [] })

    const result = await service.sweep()

    expect(notify).not.toHaveBeenCalled()
    expect(result.alerted).toBe(0)
  })
})
