import { describe, expect, it, vi } from 'vitest'
import { computeMilestoneFee } from '../lib/settle-milestone'
import type { InvoiceRepository, InvoiceSourceData } from '../repositories/invoice.repository'
import { InvoiceService } from './invoice.service'

vi.mock('../lib/settle-milestone', () => ({ computeMilestoneFee: vi.fn().mockResolvedValue(0) }))

/**
 * Revenue-facing logic that had zero behavioral coverage: the idempotency
 * guard, the gross source (released escrow vs milestone amount), and the
 * fee split that lands on every invoice PDF - the invoice total must equal
 * the gross the owner funded, never gross plus fee.
 */

const feeMock = computeMilestoneFee as unknown as ReturnType<typeof vi.fn>

function makeData(over: Partial<InvoiceSourceData> = {}): InvoiceSourceData {
  return {
    owner: { id: 'u-owner', name: 'Owner', email: 'owner@x.id' },
    talent: { id: 'u-talent', name: 'Talent', email: 'talent@x.id' },
    project: { id: 'proj-1', title: 'Toko Online', finalPrice: 12_000_000, platformFee: 2_000_000 },
    milestone: {
      id: 'ms-1',
      title: 'Backend',
      description: 'API',
      amount: 4_000_000,
      workPackageId: 'wp-1',
    },
    transaction: { amount: 5_000_000 },
    ...over,
  }
}

function makeRepo(over: Partial<Record<keyof InvoiceRepository, unknown>> = {}) {
  return {
    findByMilestone: vi.fn().mockResolvedValue(null),
    loadInvoiceData: vi.fn().mockResolvedValue(makeData()),
    invoiceNumberForMilestone: vi.fn().mockResolvedValue('INV-PROJ0001-0001'),
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
    expect(repo.invoiceNumberForMilestone).not.toHaveBeenCalled()
    expect(repo.recordInvoice).not.toHaveBeenCalled()
  })

  /**
   * Three copies of one settlement, one number. The old code allocated per
   * row, so the owner's copy and the admin's copy of the same milestone
   * quoted different invoice numbers and the sequence jumped by three.
   */
  it('numbers every audience copy of a milestone alike', async () => {
    const repo = makeRepo()
    const { service } = makeService(repo)

    for (const audience of ['owner', 'talent', 'admin'] as const) {
      const result = await service.generateInvoice('ms-1', { audience })
      expect(result.invoiceNumber).toBe('INV-PROJ0001-0001')
    }
    expect(repo.invoiceNumberForMilestone).toHaveBeenCalledTimes(3)
    expect(repo.invoiceNumberForMilestone).toHaveBeenCalledWith('proj-1', 'ms-1')
  })

  it('records the audience it rendered for', async () => {
    const repo = makeRepo()
    const { service } = makeService(repo)

    await service.generateInvoice('ms-1', { audience: 'talent' })
    expect(repo.recordInvoice).toHaveBeenCalledWith(expect.objectContaining({ audience: 'talent' }))
    expect(repo.findByMilestone).toHaveBeenCalledWith('ms-1', 'talent')
  })

  it('splits the released gross into talent net plus fee, total equals gross', async () => {
    feeMock.mockResolvedValueOnce(2_425_000)
    const repo = makeRepo()
    const { service, rendered } = makeService(repo)

    await service.generateInvoice('ms-1')
    // Gross 5M released; fee 2.425M -> talent subtotal 2.575M, total = gross.
    expect(rendered[0].amounts).toEqual({
      subtotal: 2_575_000,
      platformFee: 2_425_000,
      total: 5_000_000,
      currency: 'IDR',
    })
    expect(feeMock).toHaveBeenCalledWith({
      amount: 5_000_000,
      workPackageId: 'wp-1',
      projectId: 'proj-1',
    })
  })

  it('falls back to the milestone amount before escrow release', async () => {
    feeMock.mockResolvedValueOnce(1_940_000)
    const repo = makeRepo({
      loadInvoiceData: vi.fn().mockResolvedValue(makeData({ transaction: null })),
    })
    const { service, rendered } = makeService(repo)

    await service.generateInvoice('ms-1')
    expect(rendered[0].amounts.subtotal).toBe(4_000_000 - 1_940_000)
    expect(rendered[0].amounts.total).toBe(4_000_000)
  })

  it('invoices the full gross to the talent when no fee applies', async () => {
    feeMock.mockResolvedValueOnce(0)
    const repo = makeRepo()
    const { service, rendered } = makeService(repo)

    await service.generateInvoice('ms-1')
    expect(rendered[0].amounts.subtotal).toBe(5_000_000)
    expect(rendered[0].amounts.platformFee).toBe(0)
    expect(rendered[0].amounts.total).toBe(5_000_000)
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
        audience: 'owner',
      }),
    )
  })

  it('refuses a milestone with no invoice data', async () => {
    const repo = makeRepo({ loadInvoiceData: vi.fn().mockResolvedValue(null) })
    const { service } = makeService(repo)

    await expect(service.generateInvoice('ms-x')).rejects.toThrowError(/Cannot generate invoice/)
  })
})
