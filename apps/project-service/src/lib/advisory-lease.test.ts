import { getDb } from '@kerjacus/db'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { withAdvisoryLease } from './advisory-lease'

vi.mock('@kerjacus/db', () => ({ getDb: vi.fn() }))

// Every statement inside the callback runs on the transaction's connection,
// which is the point of the lock being transaction-scoped.
function stubTransaction(locked: boolean) {
  const execute = vi.fn().mockResolvedValue([{ locked }])
  ;(getDb as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    transaction: (fn: (tx: { execute: typeof execute }) => Promise<unknown>) => fn({ execute }),
  })
  return execute
}

describe('withAdvisoryLease', () => {
  afterEach(() => vi.clearAllMocks())

  it('runs the callback when it wins the lease', async () => {
    const execute = stubTransaction(true)
    const fn = vi.fn().mockResolvedValue('done')

    const result = await withAdvisoryLease(42, fn)

    expect(result).toBe('done')
    expect(fn).toHaveBeenCalledOnce()
    expect(execute).toHaveBeenCalledOnce()
  })

  it('skips the callback when another replica holds the lease', async () => {
    stubTransaction(false)
    const fn = vi.fn()

    const result = await withAdvisoryLease(42, fn)

    expect(result).toBeNull()
    expect(fn).not.toHaveBeenCalled()
  })

  it('treats a missing lock row as not acquired rather than as a win', async () => {
    const execute = vi.fn().mockResolvedValue([])
    ;(getDb as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      transaction: (fn: (tx: { execute: typeof execute }) => Promise<unknown>) => fn({ execute }),
    })
    const fn = vi.fn()

    expect(await withAdvisoryLease(42, fn)).toBeNull()
    expect(fn).not.toHaveBeenCalled()
  })
})
