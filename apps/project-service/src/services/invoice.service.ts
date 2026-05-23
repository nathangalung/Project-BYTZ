import { Buffer } from 'node:buffer'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GetObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3'
import { AppError } from '@kerjacus/shared'
import type { InvoiceRepository, InvoiceSourceData } from '../repositories/invoice.repository'

export type GenerateInvoiceOptions = {
  isAdminCopy?: boolean
}

export type GeneratedInvoice = {
  url: string
  invoiceNumber: string
}

/**
 * Compute the talent payout (subtotal) and platform fee for an invoice.
 *
 * Priority:
 *   1. If a transactions(escrow_release) row exists, use its amount as subtotal.
 *   2. Otherwise fall back to milestones.amount (escrow not yet released).
 *
 * Platform fee derivation: project-level (finalPrice − talentPayout) prorated
 * by the share this milestone represents of the project's payout. If those
 * project numbers are not yet set, default fee to 0.
 */
function computeAmounts(data: InvoiceSourceData) {
  const subtotal = data.transaction?.amount ?? data.milestone.amount
  let platformFee = 0
  if (data.project.finalPrice != null && data.project.platformFee != null) {
    const projectPayout = data.project.finalPrice - data.project.platformFee
    if (projectPayout > 0) {
      const share = subtotal / projectPayout
      platformFee = Math.round(data.project.platformFee * share)
    }
  }
  return {
    subtotal,
    platformFee,
    total: subtotal + platformFee,
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
   * Generate an invoice PDF. Idempotent: if an invoice for the
   * (milestoneId, isAdminCopy) pair already exists, returns it.
   */
  async generateInvoice(
    milestoneId: string,
    options: GenerateInvoiceOptions = {},
  ): Promise<GeneratedInvoice> {
    const isAdminCopy = options.isAdminCopy ?? false

    const existing = await this.invoiceRepo.findByMilestone(milestoneId, isAdminCopy)
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

    const invoiceNumber = await this.invoiceRepo.nextInvoiceNumber(data.project.id)
    const amounts = computeAmounts(data)
    const buffer = await this.renderPdf({
      invoiceNumber,
      issuedAt: new Date(),
      isAdminCopy,
      owner: data.owner,
      talent: data.talent,
      project: data.project,
      milestone: data.milestone,
      amounts,
    })

    const key = `invoices/${data.project.id}/${invoiceNumber}${isAdminCopy ? '-admin' : ''}.pdf`
    const url = await this.uploadPdf(key, buffer)

    await this.invoiceRepo.recordInvoice({
      projectId: data.project.id,
      milestoneId,
      invoiceNumber,
      pdfUrl: url,
      isAdminCopy,
    })

    return { url, invoiceNumber }
  }

  /**
   * Fetch the raw PDF bytes for an existing invoice (or generate if missing).
   */
  async streamPdf(milestoneId: string, isAdminCopy: boolean): Promise<Buffer> {
    let row = await this.invoiceRepo.findByMilestone(milestoneId, isAdminCopy)
    if (!row) {
      await this.generateInvoice(milestoneId, { isAdminCopy })
      row = await this.invoiceRepo.findByMilestone(milestoneId, isAdminCopy)
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
