import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The paywall gate: dailyDocsCreated feeds the 1-free-per-day quota and
 * isDocumentPaid decides watermark, download and the paid revision cap. These
 * were only covered by source-string greps, which cannot catch a wrong tx
 * type, a missed backfill, or the paid short-circuit regressing.
 */

let selectRows: Array<Record<string, unknown>> = []
const selectCalls: number[] = []
const updateCalls: Array<Record<string, unknown>> = []

vi.mock('@kerjacus/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@kerjacus/db')>()),
  getDb: () => ({
    select: () => {
      selectCalls.push(1)
      // `where` resolves directly (dailyDocsCreated awaits it) and also
      // carries .limit (isDocumentPaid chains one more step).
      const terminal = () =>
        Object.assign(Promise.resolve(selectRows), { limit: async () => selectRows })
      const chain = {
        from: () => chain,
        innerJoin: () => chain,
        where: terminal,
      }
      return chain
    },
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          updateCalls.push(values)
        },
      }),
    }),
  }),
}))

const { dailyDocsCreated, isDocumentPaid } = await import('./document-entitlement')

beforeEach(() => {
  selectRows = []
  selectCalls.length = 0
  updateCalls.length = 0
})

describe('isDocumentPaid', () => {
  it('short-circuits on an existing paidAt without touching the db', async () => {
    const paid = await isDocumentPaid('proj-1', 'brd', new Date())
    expect(paid).toBe(true)
    expect(selectCalls).toHaveLength(0)
    expect(updateCalls).toHaveLength(0)
  })

  it('stays unpaid with no completed transaction and does not backfill', async () => {
    selectRows = []
    const paid = await isDocumentPaid('proj-1', 'brd', null)
    expect(paid).toBe(false)
    expect(updateCalls).toHaveLength(0)
  })

  it('unlocks on a completed transaction and backfills paidAt', async () => {
    selectRows = [{ id: 'txn-1' }]
    const paid = await isDocumentPaid('proj-1', 'prd', null)
    expect(paid).toBe(true)
    // The backfill keeps download, watermark and revision cap in agreement.
    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0].paidAt).toBeInstanceOf(Date)
  })
})

describe('dailyDocsCreated', () => {
  it('returns the counted rows', async () => {
    selectRows = [{ count: 2 }]
    expect(await dailyDocsCreated('user-1', 'brd')).toBe(2)
  })

  it('returns zero when nothing was created today', async () => {
    selectRows = []
    expect(await dailyDocsCreated('user-1', 'prd')).toBe(0)
  })
})
