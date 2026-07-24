import { describe, expect, it, vi } from 'vitest'
import type { InvoiceRepository, InvoiceSourceData } from '../repositories/invoice.repository'
import { InvoiceService } from './invoice.service'

/**
 * Revenue-facing logic that had zero behavioral coverage: the idempotency
 * guard, the subtotal source (released escrow vs milestone amount), and the
 * prorated platform fee that lands on every invoice PDF.
 */

function makeData(over: Partial<InvoiceSourceData> = {}): InvoiceSourceData {
  return {
    owner: { id: 'u-owner', name: 'Owner', email: 'owner@x.id' },
    talent: { id: 'u-talent', name: 'Talent', email: 'talent@x.id' },
    project: { id: 'proj-1', title: 'Toko Online', finalPrice: 12_000_000, platformFee: 2_000_000 },
    milestone: { id: 'ms-1', title: 'Backend', description: 'API', amount: 4_000_000 },
    transaction: { amount: 5_000_000 },
    ...over,
  }
}

function makeRepo(over: Partial<Record<keyof InvoiceRepository, unknown>> = {}) {
  return {
    findByMilestone: vi.fn().mockResolvedValue(null),
    loadInvoiceData: vi.fn().mockResolvedValue(makeData()),
    nextInvoiceNumber: vi.fn().mockResolvedValue('INV-PROJ0001-0001'),
    recordInvoice: vi.fn().mockResolvedValue(undefined),
    ...over,
  } as unknown as InvoiceRepository
}

type RenderInput = { amounts: { subtotal: number; platformFee: number; total: number } }

// PDF rendering is exercised elsewhere; here the amounts flowing into it are
// the subject, so stub the renderer and capture its input.
function makeService(repo: InvoiceRepository) {
  const service = new InvoiceService(repo, null, 'bucket', 'http://minio:9000')
  const rendered: RenderInput[] = []
  vi.spyOn(service as never, 'renderPdf' as never).mockImplementation(
    async (...args: unknown[]) => {
      rendered.push(args[0] as RenderInput)
      return Buffer.from('pdf')
    },
  )
  return { service, rendered }
}

describe('generateInvoice', () => {
  it('is idempotent: an existing invoice returns without renumbering', async () => {
    const repo = makeRepo({
      findByMilestone: vi
        .fn()
        .mockResolvedValue({ pdfUrl: 'file:///x.pdf', invoiceNumber: 'INV-A-0001' }),
    })
    const { service } = makeService(repo)

    const result = await service.generateInvoice('ms-1')
    expect(result.invoiceNumber).toBe('INV-A-0001')
    expect(repo.nextInvoiceNumber).not.toHaveBeenCalled()
    expect(repo.recordInvoice).not.toHaveBeenCalled()
  })

  it('prefers the released escrow amount over the milestone amount', async () => {
    const repo = makeRepo()
    const { service, rendered } = makeService(repo)

    await service.generateInvoice('ms-1')
    // subtotal 5M (transaction), payout = 12M - 2M = 10M, share 0.5 -> fee 1M.
    expect(rendered[0].amounts).toEqual({
      subtotal: 5_000_000,
      platformFee: 1_000_000,
      total: 6_000_000,
      currency: 'IDR',
    })
  })

  it('falls back to the milestone amount before escrow release', async () => {
    const repo = makeRepo({
      loadInvoiceData: vi.fn().mockResolvedValue(makeData({ transaction: null })),
    })
    const { service, rendered } = makeService(repo)

    await service.generateInvoice('ms-1')
    // subtotal 4M, share 0.4 -> fee 800k.
    expect(rendered[0].amounts.subtotal).toBe(4_000_000)
    expect(rendered[0].amounts.platformFee).toBe(800_000)
  })

  it('defaults the fee to zero when project pricing is not set yet', async () => {
    const repo = makeRepo({
      loadInvoiceData: vi
        .fn()
        .mockResolvedValue(
          makeData({ project: { id: 'p', title: 'T', finalPrice: null, platformFee: null } }),
        ),
    })
    const { service, rendered } = makeService(repo)

    await service.generateInvoice('ms-1')
    expect(rendered[0].amounts.platformFee).toBe(0)
  })

  it('records the invoice it generated', async () => {
    const repo = makeRepo()
    const { service } = makeService(repo)

    const result = await service.generateInvoice('ms-1')
    expect(result.invoiceNumber).toBe('INV-PROJ0001-0001')
    expect(repo.recordInvoice).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'proj-1',
        milestoneId: 'ms-1',
        invoiceNumber: 'INV-PROJ0001-0001',
        isAdminCopy: false,
      }),
    )
  })

  it('refuses a milestone with no invoice data', async () => {
    const repo = makeRepo({ loadInvoiceData: vi.fn().mockResolvedValue(null) })
    const { service } = makeService(repo)

    await expect(service.generateInvoice('ms-x')).rejects.toThrowError(/Cannot generate invoice/)
  })
})
