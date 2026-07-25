import type { Database } from '@kerjacus/db'
import { describe, expect, it, vi } from 'vitest'
import { InvoiceRepository } from './invoice.repository'

/**
 * Invoice numbers are what an owner quotes to their accountant, so the two
 * properties that matter are that a milestone's copies agree and that the
 * per-project sequence counts settlements rather than PDFs.
 */

function makeDb(over: { existing?: string; distinctMilestones?: number } = {}) {
  const select = vi.fn(() => ({
    from: () => ({
      where: () => ({
        limit: async () =>
          over.existing ? [{ invoiceNumber: over.existing }] : ([] as { invoiceNumber: string }[]),
      }),
    }),
  }))
  const execute = vi.fn(async (_query: unknown) => [{ count: over.distinctMilestones ?? 0 }])
  return { db: { select, execute } as unknown as Database, execute }
}

const PROJECT_ID = '0198c4de-7f31-7a2b-9c4d-5e6f7a8b9c0d'

describe('invoiceNumberForMilestone', () => {
  it('opens a project at 0001', async () => {
    const { db } = makeDb()
    const repo = new InvoiceRepository(db)
    expect(await repo.invoiceNumberForMilestone(PROJECT_ID, 'ms-1')).toBe('INV-7A8B9C0D-0001')
  })

  it('reuses the number a sibling copy already holds', async () => {
    const { db, execute } = makeDb({ existing: 'INV-7A8B9C0D-0004', distinctMilestones: 9 })
    const repo = new InvoiceRepository(db)
    expect(await repo.invoiceNumberForMilestone(PROJECT_ID, 'ms-1')).toBe('INV-7A8B9C0D-0004')
    expect(execute).not.toHaveBeenCalled()
  })

  it('advances once per milestone invoiced, not once per copy written', async () => {
    const { db } = makeDb({ distinctMilestones: 1 })
    const repo = new InvoiceRepository(db)
    // One milestone already invoiced means three rows written; the next
    // milestone is still 0002.
    expect(await repo.invoiceNumberForMilestone(PROJECT_ID, 'ms-2')).toBe('INV-7A8B9C0D-0002')
  })

  it('counts distinct milestones rather than rows', async () => {
    const { db, execute } = makeDb({ distinctMilestones: 3 })
    const repo = new InvoiceRepository(db)
    await repo.invoiceNumberForMilestone(PROJECT_ID, 'ms-4')
    expect(JSON.stringify(execute.mock.calls[0]?.[0])).toContain('COUNT(DISTINCT milestone_id)')
  })

  it('pads the sequence to four digits', async () => {
    const { db } = makeDb({ distinctMilestones: 41 })
    const repo = new InvoiceRepository(db)
    expect(await repo.invoiceNumberForMilestone(PROJECT_ID, 'ms-x')).toBe('INV-7A8B9C0D-0042')
  })
})
