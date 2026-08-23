import { Buffer } from 'node:buffer'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GetObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3'
import { AppError, type InvoiceAudience } from '@kerjacus/shared'
import { computeMilestoneFee } from '../lib/settle-milestone'
import type { InvoiceRepository, InvoiceSourceData } from '../repositories/invoice.repository'

type GenerateInvoiceOptions = {
  audience?: InvoiceAudience
}

type GeneratedInvoice = {
  url: string
  invoiceNumber: string
}

/**
 * Compute the talent payout (subtotal) and platform fee for an invoice.
 *
 * The gross base is the escrow_release amount when one exists (falling back
 * to the milestone amount pre-release). That gross already CONTAINS the
 * platform fee, so the invoice splits it with the same computeMilestoneFee
 * ratio the release used: subtotal is the talent net, the fee is the
 * platform's slice, and the total equals the gross the owner funded.
 */
async function computeAmounts(data: InvoiceSourceData) {
  const gross = data.transaction?.amount ?? data.milestone.amount
  const platformFee = await computeMilestoneFee({
    amount: gross,
    workPackageId: data.milestone.workPackageId,
    projectId: data.project.id,
  })
  return {
    subtotal: gross - platformFee,
    platformFee,
    total: gross,
    currency: 'IDR' as const,
  }
}

export class InvoiceService {
  constructor(
    private invoiceRepo: InvoiceRepository,
    private s3: S3Client | null,
    private bucket: string,
    private endpoint: string,
  ) {}

  /**
   * Generate one audience's copy of a milestone invoice. Idempotent per
   * (milestoneId, audience); all three copies share one invoice number.
   */
  async generateInvoice(
    milestoneId: string,
    options: GenerateInvoiceOptions = {},
  ): Promise<GeneratedInvoice> {
    const audience = options.audience ?? 'owner'

    const existing = await this.invoiceRepo.findByMilestone(milestoneId, audience)
    if (existing) {
      return { url: existing.pdfUrl, invoiceNumber: existing.invoiceNumber }
    }

    const data = await this.invoiceRepo.loadInvoiceData(milestoneId)
    if (!data) {
      throw new AppError(
        'NOT_FOUND',
        'Cannot generate invoice: milestone has no assigned talent or project',
      )
    }

    const invoiceNumber = await this.invoiceRepo.invoiceNumberForMilestone(
      data.project.id,
      milestoneId,
    )
    const amounts = await computeAmounts(data)
    const buffer = await this.renderPdf({
      invoiceNumber,
      issuedAt: new Date(),
      audience,
      owner: data.owner,
      talent: data.talent,
      project: data.project,
      milestone: data.milestone,
      amounts,
    })

    // Keyed by milestone, not by invoice number. The number comes from a
    // COUNT(DISTINCT milestone_id) that two settlements of the same project can
    // both read before either writes, so two milestones can carry the same
    // number, and the unique that would have caught it was dropped in migration
    // 0019 in favour of (milestone_id, audience). Keying on the number let the
    // second PDF overwrite the first while both rows kept pointing at it, and
    // the owner downloaded one milestone and got another one's amounts. This
    // key matches the row's own uniqueness rule.
    const key = `invoices/${data.project.id}/${milestoneId}-${audience}.pdf`
    const url = await this.uploadPdf(key, buffer)

    await this.invoiceRepo.recordInvoice({
      projectId: data.project.id,
      milestoneId,
      invoiceNumber,
      pdfUrl: url,
      audience,
    })

    return { url, invoiceNumber }
  }

  /**
   * Fetch the raw PDF bytes for an existing invoice (or generate if missing).
   */
  async streamPdf(milestoneId: string, audience: InvoiceAudience): Promise<Buffer> {
    let row = await this.invoiceRepo.findByMilestone(milestoneId, audience)
    if (!row) {
      await this.generateInvoice(milestoneId, { audience })
      row = await this.invoiceRepo.findByMilestone(milestoneId, audience)
      if (!row) throw new AppError('INTERNAL_ERROR', 'Invoice generation succeeded but row missing')
    }

    return await this.fetchPdf(row.pdfUrl)
  }

  /**
   * Render the React PDF template to a Buffer.
   * Lazy-imports @react-pdf/renderer + React so import failures only affect
   * this code path (not the entire service start-up).
   */
  private async renderPdf(
    data: import('../templates/InvoiceTemplate').InvoiceData,
  ): Promise<Buffer> {
    const [{ renderToBuffer }, React, { InvoiceTemplate }] = await Promise.all([
      import('@react-pdf/renderer'),
      import('react'),
      import('../templates/InvoiceTemplate'),
    ])
    const element = React.createElement(InvoiceTemplate, { data })
    // @react-pdf/renderer's renderToBuffer types expect a DocumentElement,
    // but our InvoiceTemplate returns one. Cast through unknown is safe here.
    const buf = (await renderToBuffer(
      element as unknown as Parameters<typeof renderToBuffer>[0],
    )) as unknown as Buffer
    return buf
  }

  private async uploadPdf(key: string, buffer: Buffer): Promise<string> {
    if (!this.s3) {
      // Dev fallback: write to OS temp dir
      const dir = join(tmpdir(), 'kerjacus-invoices')
      await mkdir(dir, { recursive: true })
      const path = join(dir, key.replace(/[/\\]/g, '_'))
      await writeFile(path, buffer)
      return `file://${path}`
    }
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: 'application/pdf',
      }),
    )
    return `${this.endpoint.replace(/\/+$/, '')}/${this.bucket}/${key}`
  }

  private async fetchPdf(pdfUrl: string): Promise<Buffer> {
    if (pdfUrl.startsWith('file://')) {
      const { readFile } = await import('node:fs/promises')
      const path = pdfUrl.slice('file://'.length)
      return await readFile(path)
    }
    if (!this.s3) {
      throw new AppError('INTERNAL_ERROR', 'S3 client unavailable but invoice stored remotely')
    }
    // Extract key from URL: {endpoint}/{bucket}/{key}
    const prefix = `${this.endpoint.replace(/\/+$/, '')}/${this.bucket}/`
    const key = pdfUrl.startsWith(prefix)
      ? pdfUrl.slice(prefix.length)
      : pdfUrl.split('/').slice(-3).join('/')
    const obj = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }))
    if (!obj.Body) throw new AppError('INTERNAL_ERROR', 'PDF object has no body')
    const bytes = await obj.Body.transformToByteArray()
    return Buffer.from(bytes)
  }
}
