import { S3Client } from '@aws-sdk/client-s3'
import { getDb, milestones, projectAssignments, projects, talentProfiles } from '@kerjacus/db'
import { AppError } from '@kerjacus/shared'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { env } from '../lib/env'
import { getAuthUser } from '../middleware/session'
import { InvoiceRepository } from '../repositories/invoice.repository'
import { InvoiceService } from '../services/invoice.service'

// Shared S3 client (MinIO via AWS SDK) — same config pattern as upload.ts.
function buildS3(): { client: S3Client | null; bucket: string; endpoint: string } {
  const endpoint = env.S3_ENDPOINT
  const bucket = env.S3_BUCKET
  // Allow disabling S3 in dev/test by setting S3_ENDPOINT=disabled.
  if (endpoint === 'disabled') return { client: null, bucket, endpoint }
  const client = new S3Client({
    endpoint,
    region: 'us-east-1',
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY,
      secretAccessKey: env.S3_SECRET_KEY,
    },
    forcePathStyle: true,
  })
  return { client, bucket, endpoint }
}

let cachedService: InvoiceService | null = null

export function getInvoiceService(): InvoiceService {
  if (cachedService) return cachedService
  const db = getDb()
  const repo = new InvoiceRepository(db)
  const { client, bucket, endpoint } = buildS3()
  cachedService = new InvoiceService(repo, client, bucket, endpoint)
  return cachedService
}

export const invoicesRoute = new Hono()

/**
 * Authorization helper:
 *   - admin role: full access
 *   - project owner: non-admin invoices
 *   - assigned talent (active assignment on the milestone's work package OR
 *     direct milestone.assigned_talent_id): non-admin invoices
 */
async function authorizeInvoiceAccess(
  userId: string,
  userRole: string,
  projectId: string,
  milestoneId: string,
  wantsAdminCopy: boolean,
): Promise<void> {
  const db = getDb()
  if (wantsAdminCopy && userRole !== 'admin') {
    throw new AppError('AUTH_FORBIDDEN', 'Admin copies are only accessible to admin users')
  }

  if (userRole === 'admin') return

  const [project] = await db
    .select({ ownerId: projects.ownerId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)
  if (!project) throw new AppError('NOT_FOUND', 'Project not found')
  if (project.ownerId === userId) return

  // Check if user is the assigned talent on this milestone
  const [ms] = await db
    .select({
      assignedTalentId: milestones.assignedTalentId,
      workPackageId: milestones.workPackageId,
    })
    .from(milestones)
    .where(and(eq(milestones.id, milestoneId), eq(milestones.projectId, projectId)))
    .limit(1)
  if (!ms) throw new AppError('NOT_FOUND', 'Milestone not found')

  if (ms.assignedTalentId) {
    const [profile] = await db
      .select({ userId: talentProfiles.userId })
      .from(talentProfiles)
      .where(eq(talentProfiles.id, ms.assignedTalentId))
      .limit(1)
    if (profile?.userId === userId) return
  }

  if (ms.workPackageId) {
    const rows = await db
      .select({ userId: talentProfiles.userId })
      .from(projectAssignments)
      .innerJoin(talentProfiles, eq(talentProfiles.id, projectAssignments.talentId))
      .where(
        and(
          eq(projectAssignments.workPackageId, ms.workPackageId),
          eq(projectAssignments.status, 'active'),
        ),
      )
    if (rows.some((r) => r.userId === userId)) return
  }

  throw new AppError('AUTH_FORBIDDEN', 'Not authorized to access this invoice')
}

/**
 * GET /api/v1/projects/:projectId/invoices/:filename
 *   filename pattern: <milestoneId>.pdf  or  <milestoneId>-admin.pdf
 *
 * Returns the PDF inline (application/pdf). Generates on first access if
 * not yet persisted.
 */
invoicesRoute.get('/projects/:projectId/invoices/:filename', async (c) => {
  const user = getAuthUser(c)
  const projectId = c.req.param('projectId')
  const filename = c.req.param('filename')

  if (!filename.endsWith('.pdf')) {
    throw new AppError('VALIDATION_ERROR', 'Invoice filename must end with .pdf')
  }

  const isAdminCopy = filename.endsWith('-admin.pdf')
  const milestoneId = filename.replace(/-admin\.pdf$|\.pdf$/, '')
  if (!milestoneId) {
    throw new AppError('VALIDATION_ERROR', 'Invalid invoice filename')
  }

  await authorizeInvoiceAccess(user.id, user.role, projectId, milestoneId, isAdminCopy)

  const service = getInvoiceService()
  const buffer = await service.streamPdf(milestoneId, isAdminCopy)
  const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)

  c.header('Content-Type', 'application/pdf')
  c.header('Content-Disposition', `inline; filename="${filename}"`)
  c.header('Cache-Control', 'private, max-age=3600')
  return c.body(bytes as unknown as ArrayBuffer)
})

/**
 * GET /api/v1/projects/:projectId/invoices
 *   List invoices for a project (for invoice history UI).
 *   Non-admins do not see admin copies.
 */
invoicesRoute.get('/projects/:projectId/invoices', async (c) => {
  const user = getAuthUser(c)
  const projectId = c.req.param('projectId')

  // Reuse access check: admins or owner or any assigned talent on the project
  const db = getDb()
  if (user.role !== 'admin') {
    const [project] = await db
      .select({ ownerId: projects.ownerId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1)
    if (!project) throw new AppError('NOT_FOUND', 'Project not found')
    if (project.ownerId !== user.id) {
      const rows = await db
        .select({ userId: talentProfiles.userId })
        .from(projectAssignments)
        .innerJoin(talentProfiles, eq(talentProfiles.id, projectAssignments.talentId))
        .where(eq(projectAssignments.projectId, projectId))
      if (!rows.some((r) => r.userId === user.id)) {
        throw new AppError('AUTH_FORBIDDEN', 'Not authorized to view invoices for this project')
      }
    }
  }

  const repo = new InvoiceRepository(db)
  const items = await repo.findByProject(projectId)
  const filtered = user.role === 'admin' ? items : items.filter((i) => !i.isAdminCopy)

  return c.json({
    success: true,
    data: filtered.map((i) => ({
      invoiceNumber: i.invoiceNumber,
      milestoneId: i.milestoneId,
      pdfUrl: i.pdfUrl,
      isAdminCopy: i.isAdminCopy,
      generatedAt: i.generatedAt,
    })),
  })
})
