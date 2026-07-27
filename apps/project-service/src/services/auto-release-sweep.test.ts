import { AUTO_RELEASE_DAYS } from '@kerjacus/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { withAdvisoryLease } from '../lib/advisory-lease'
import { AutoReleaseSweepService, runAutoReleaseSweep } from './auto-release-sweep'

vi.mock('@kerjacus/logger', () => ({ createLogger: () => ({ error: vi.fn() }) }))
vi.mock('../lib/advisory-lease', () => ({ withAdvisoryLease: vi.fn() }))

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = new Date('2026-07-27T00:00:00.000Z')

const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS)

type Row = { id: string; submittedAt: Date | null }

// Applies the same predicate as the repository SQL: still 'submitted' and
// submitted before the cutoff. Only rows the caller declares as submitted are
// present, so status filtering is implicit.
function fakeRepo(rows: Row[]) {
  return {
    findOverdueSubmitted: vi.fn(async (cutoff: Date, limit: number) =>
      rows
        .filter((row) => row.submittedAt !== null && row.submittedAt < cutoff)
        .slice(0, limit)
        .map((row) => ({ ...row })),
    ),
  }
}

const settle = () => vi.fn().mockResolvedValue({ paid: true })

describe('AutoReleaseSweepService', () => {
  afterEach(() => vi.clearAllMocks())

  it('asks for milestones submitted before the review window closed', async () => {
    const repo = fakeRepo([])
    await new AutoReleaseSweepService(repo, vi.fn(), vi.fn(), vi.fn()).sweep(NOW)

    const [cutoff] = repo.findOverdueSubmitted.mock.calls[0]
    expect(cutoff.getTime()).toBe(NOW.getTime() - AUTO_RELEASE_DAYS * DAY_MS)
  })

  it('settles a milestone submitted 15 days ago', async () => {
    const repo = fakeRepo([{ id: 'ms-old', submittedAt: daysAgo(15) }])
    const release = vi.fn().mockResolvedValue({ released: true })
    const notify = vi.fn()

    const result = await new AutoReleaseSweepService(repo, settle(), release, notify).sweep(NOW)

    expect(release).toHaveBeenCalledWith('ms-old')
    expect(notify).toHaveBeenCalledWith('ms-old')
    expect(result).toEqual({ settled: 1, failed: 0 })
  })

  it('leaves a milestone submitted 13 days ago alone', async () => {
    const repo = fakeRepo([{ id: 'ms-fresh', submittedAt: daysAgo(13) }])
    const release = vi.fn()

    const result = await new AutoReleaseSweepService(repo, settle(), release, vi.fn()).sweep(NOW)

    expect(release).not.toHaveBeenCalled()
    expect(result).toEqual({ settled: 0, failed: 0 })
  })

  // The owner is owed 14 days per submission, not per milestone. Resubmitting
  // after a revision rewrites submitted_at, which is what the sweep measures.
  it('restarts the window when a revision produced a newer submission', async () => {
    const repo = fakeRepo([{ id: 'ms-revised', submittedAt: daysAgo(1) }])
    const release = vi.fn()

    const result = await new AutoReleaseSweepService(repo, settle(), release, vi.fn()).sweep(NOW)

    expect(release).not.toHaveBeenCalled()
    expect(result.settled).toBe(0)
  })

  // Second run replays the release; the status flip already happened, so it
  // reports not-released and the talent is not notified twice.
  it('does not settle the same milestone twice across runs', async () => {
    const repo = fakeRepo([{ id: 'ms-old', submittedAt: daysAgo(20) }])
    const release = vi
      .fn()
      .mockResolvedValueOnce({ released: true })
      .mockResolvedValueOnce({ released: false })
    const notify = vi.fn()
    const service = new AutoReleaseSweepService(repo, settle(), release, notify)

    const first = await service.sweep(NOW)
    const second = await service.sweep(NOW)

    expect(first.settled).toBe(1)
    expect(second.settled).toBe(0)
    expect(notify).toHaveBeenCalledTimes(1)
  })

  // The release refuses a milestone priced above its work package. Approving it
  // anyway would announce a payout that never happened and take the row out of
  // the sweep's own predicate, so nothing would ever retry it.
  it('does not approve a milestone whose payout was refused', async () => {
    const repo = fakeRepo([{ id: 'ms-corrupt', submittedAt: daysAgo(20) }])
    const settleFails = vi.fn().mockRejectedValue(new Error('exceeds its work package amount'))
    const release = vi.fn()
    const notify = vi.fn()

    const result = await new AutoReleaseSweepService(repo, settleFails, release, notify).sweep(NOW)

    expect(release).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
    expect(result).toEqual({ settled: 0, failed: 1 })
  })

  it('pays before it records the approval', async () => {
    const repo = fakeRepo([{ id: 'ms-old', submittedAt: daysAgo(20) }])
    const order: string[] = []
    const settleFirst = vi.fn(async () => {
      order.push('settle')
      return { paid: true }
    })
    const release = vi.fn(async () => {
      order.push('release')
      return { released: true }
    })

    await new AutoReleaseSweepService(repo, settleFirst, release, vi.fn()).sweep(NOW)

    expect(order).toEqual(['settle', 'release'])
    expect(settleFirst).toHaveBeenCalledWith('ms-old', 'system:auto_release', 'submitted')
  })

  it('keeps settling the batch after one milestone fails', async () => {
    const repo = fakeRepo([
      { id: 'ms-bad', submittedAt: daysAgo(20) },
      { id: 'ms-good', submittedAt: daysAgo(19) },
    ])
    const release = vi
      .fn()
      .mockRejectedValueOnce(new Error('payment service down'))
      .mockResolvedValueOnce({ released: true })
    const notify = vi.fn()

    const result = await new AutoReleaseSweepService(repo, settle(), release, notify).sweep(NOW)

    expect(result).toEqual({ settled: 1, failed: 1 })
    expect(notify).toHaveBeenCalledWith('ms-good')
  })
})

describe('runAutoReleaseSweep', () => {
  afterEach(() => vi.clearAllMocks())

  it('sweeps on the replica that wins the lease', async () => {
    const sweep = vi.fn().mockResolvedValue({ settled: 2, failed: 0 })
    vi.mocked(withAdvisoryLease).mockImplementation(async (_key, fn) => await fn())

    expect(await runAutoReleaseSweep({ sweep })).toEqual({ settled: 2, failed: 0 })
    expect(sweep).toHaveBeenCalledOnce()
  })

  it('does not sweep concurrently on a replica that lost the lease', async () => {
    const sweep = vi.fn()
    vi.mocked(withAdvisoryLease).mockResolvedValue(null)

    expect(await runAutoReleaseSweep({ sweep })).toBeNull()
    expect(sweep).not.toHaveBeenCalled()
  })
})
