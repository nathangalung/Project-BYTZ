import type { S3Client } from '@aws-sdk/client-s3'
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

/**
 * Where the PDF actually lives.
 *
 * Every test above runs the dev fallback, which writes to a temp file because
 * S3_ENDPOINT is disabled. Production runs the other half of both branches -
 * the object store - and that half owns the two rules that decide whether an
 * invoice can be served back: the URL an upload returns, and the key
 * fetchPdf recovers from that URL. Get either wrong and the invoice exists
 * but 404s at download time, which is discovered by an owner rather than by
 * us.
 */
describe('invoice storage', () => {
  const ENDPOINT = 'http://minio:9000'
  const BUCKET = 'kerjacus-uploads'

  type Sent = { input: Record<string, unknown>; name: string }

  /** Minimal S3Client: records what it was asked to do, answers with `body`. */
  function fakeS3(body: unknown = { transformToByteArray: async () => new Uint8Array([1, 2, 3]) }) {
    const sent: Sent[] = []
    const client = {
      send: vi.fn(async (command: { input: Record<string, unknown> }) => {
        sent.push({ input: command.input, name: command.constructor.name })
        return { Body: body }
      }),
    }
    return { client: client as unknown as S3Client, sent }
  }

  function serviceWithS3(s3: S3Client | null, repo = makeRepo()) {
    const service = new InvoiceService(repo, s3, BUCKET, `${ENDPOINT}/`)
    vi.spyOn(service as never, 'renderPdf' as never).mockImplementation(async () =>
      Buffer.from('pdf'),
    )
    return { service, repo }
  }

  /**
   * The trailing slash on the endpoint is stripped, so the URL has exactly one
   * separator. Two would make the key recovered below wrong by an empty
   * segment, and the object would never be found again.
   */
  it('uploads to the bucket and returns a single-slash URL', async () => {
    const { client, sent } = fakeS3()
    const { service } = serviceWithS3(client)

    const { url } = await service.generateInvoice('ms-1', { audience: 'talent' })

    expect(url).toBe(`${ENDPOINT}/${BUCKET}/invoices/proj-1/ms-1-talent.pdf`)
    expect(sent).toHaveLength(1)
    expect(sent[0]?.input).toMatchObject({
      Bucket: BUCKET,
      Key: 'invoices/proj-1/ms-1-talent.pdf',
      ContentType: 'application/pdf',
    })
  })

  /**
   * Two milestones of one project can carry the same invoice number.
   * invoiceNumberForMilestone derives its sequence from a
   * COUNT(DISTINCT milestone_id) that both settlements can read before either
   * writes, and the unique that would have rejected the collision was dropped in
   * migration 0019 in favour of (milestone_id, audience). So the key cannot come
   * from the number: the second upload would land on the first one's object
   * while both rows kept pointing at it, and the owner would open one milestone
   * and read another one's amounts.
   */
  it('keys by milestone, so a shared invoice number cannot overwrite', async () => {
    const { client, sent } = fakeS3()
    const { service } = serviceWithS3(client)

    await service.generateInvoice('ms-a', { audience: 'owner' })
    await service.generateInvoice('ms-b', { audience: 'owner' })

    const keys = sent.map((s) => s.input.Key)
    expect(keys).toEqual(['invoices/proj-1/ms-a-owner.pdf', 'invoices/proj-1/ms-b-owner.pdf'])
  })

  it('reads the object back using the key recovered from its own URL', async () => {
    const { client, sent } = fakeS3()
    const pdfUrl = `${ENDPOINT}/${BUCKET}/invoices/proj-1/INV-PROJ0001-0001-owner.pdf`
    const repo = makeRepo({
      findByMilestone: vi.fn().mockResolvedValue({ pdfUrl, invoiceNumber: 'INV-PROJ0001-0001' }),
    })
    const { service } = serviceWithS3(client, repo)

    const buf = await service.streamPdf('ms-1', 'owner')

    expect([...buf]).toEqual([1, 2, 3])
    expect(sent[0]?.input).toMatchObject({
      Bucket: BUCKET,
      Key: 'invoices/proj-1/INV-PROJ0001-0001-owner.pdf',
    })
  })

  /**
   * A row written when the endpoint was configured differently still has to
   * resolve. The last three segments are the key shape this service writes,
   * so they are what it falls back to.
   */
  it('recovers the key from the last segments when the URL predates this endpoint', async () => {
    const { client, sent } = fakeS3()
    const repo = makeRepo({
      findByMilestone: vi.fn().mockResolvedValue({
        pdfUrl: 'https://old-host.example/other-bucket/invoices/proj-1/INV-A-0001-admin.pdf',
        invoiceNumber: 'INV-A-0001',
      }),
    })
    const { service } = serviceWithS3(client, repo)

    await service.streamPdf('ms-1', 'admin')

    expect(sent[0]?.input).toMatchObject({ Key: 'invoices/proj-1/INV-A-0001-admin.pdf' })
  })

  it('refuses to serve a remote invoice with no S3 client configured', async () => {
    const repo = makeRepo({
      findByMilestone: vi
        .fn()
        .mockResolvedValue({ pdfUrl: `${ENDPOINT}/${BUCKET}/x.pdf`, invoiceNumber: 'INV-A-0001' }),
    })
    const { service } = serviceWithS3(null, repo)

    await expect(service.streamPdf('ms-1', 'owner')).rejects.toThrowError(/S3 client unavailable/)
  })

  it('refuses an object that came back with no body', async () => {
    // Not `undefined`: that reaches the default parameter and hands back a
    // working body, which is a test that passes by not running.
    const { client } = fakeS3(null)
    const repo = makeRepo({
      findByMilestone: vi
        .fn()
        .mockResolvedValue({ pdfUrl: `${ENDPOINT}/${BUCKET}/x.pdf`, invoiceNumber: 'INV-A-0001' }),
    })
    const { service } = serviceWithS3(client, repo)

    await expect(service.streamPdf('ms-1', 'owner')).rejects.toThrowError(/no body/)
  })

  /**
   * streamPdf generates on demand when the copy is missing. If the row is
   * still absent afterwards the generation silently did nothing, and returning
   * an empty buffer would ship a blank invoice rather than raise.
   */
  it('raises when generation reports success but leaves no row', async () => {
    const { client } = fakeS3()
    const repo = makeRepo({ findByMilestone: vi.fn().mockResolvedValue(null) })
    const { service } = serviceWithS3(client, repo)

    await expect(service.streamPdf('ms-1', 'owner')).rejects.toThrowError(
      /generation succeeded but row missing/,
    )
  })
})

/**
 * Two milestones of one project can carry the same invoice number.
 * invoiceNumberForMilestone derives the sequence from a
 * COUNT(DISTINCT milestone_id) that both settlements can read before either
 * writes, and the unique that would have rejected the collision was dropped in
 * migration 0019 for (milestone_id, audience). So the object key cannot be built
 * from the number: the second PDF would overwrite the first while both rows kept
 * pointing at it, and the owner would download one milestone and get another
 * one's amounts.
 */
