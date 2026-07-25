import { S3Client } from '@aws-sdk/client-s3'
import { getDb, milestones, projectAssignments, projects, talentProfiles } from '@kerjacus/db'
import { AppError, type InvoiceAudience } from '@kerjacus/shared'
import { and, eq, inArray, or } from 'drizzle-orm'
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
 * Resolve which copy of an invoice a caller may read, throwing if none.
 *
 * The audience is derived from the caller's relationship to the project, not
 * from anything the caller sends: admin gets the fee breakdown, the owner
 * gets the gross it funded, the assigned talent gets its payout. Returning
 * the audience rather than void keeps authorization and rendering from
 * disagreeing about who is asking.
 */
async function resolveInvoiceAudience(
  userId: string,
  userRole: string,
  projectId: string,
  milestoneId: string,
): Promise<InvoiceAudience> {
  const db = getDb()
  if (userRole === 'admin') return 'admin'

  const [project] = await db
    .select({ ownerId: projects.ownerId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)
  if (!project) throw new AppError('NOT_FOUND', 'Project not found')
  if (project.ownerId === userId) return 'owner'

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
    if (profile?.userId === userId) return 'talent'
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
    if (rows.some((r) => r.userId === userId)) return 'talent'
  }

  throw new AppError('AUTH_FORBIDDEN', 'Not authorized to access this invoice')
}

/**
 * GET /api/v1/projects/:projectId/invoices/:filename
 *   filename pattern: <milestoneId>.pdf
 *
 * One URL per milestone; which copy it serves depends on who asks. Returns
 * the PDF inline (application/pdf), generating on first access.
 */
invoicesRoute.get('/projects/:projectId/invoices/:filename', async (c) => {
  const user = getAuthUser(c)
  const projectId = c.req.param('projectId')
  const filename = c.req.param('filename')

  if (!filename.endsWith('.pdf')) {
    throw new AppError('VALIDATION_ERROR', 'Invoice filename must end with .pdf')
  }

  const milestoneId = filename.slice(0, -'.pdf'.length)
  if (!milestoneId) {
    throw new AppError('VALIDATION_ERROR', 'Invalid invoice filename')
  }

  const audience = await resolveInvoiceAudience(user.id, user.role, projectId, milestoneId)

  const service = getInvoiceService()
  const buffer = await service.streamPdf(milestoneId, audience)
  const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)

  c.header('Content-Type', 'application/pdf')
  c.header('Content-Disposition', `inline; filename="${filename}"`)
  c.header('Cache-Control', 'private, max-age=3600')
  return c.body(bytes as unknown as ArrayBuffer)
})

/**
 * Milestones of a project a talent is actually working on, either assigned
 * directly or through an active work-package assignment.
 */
async function talentMilestoneIds(userId: string, projectId: string): Promise<string[]> {
  const db = getDb()
  const profiles = await db
    .select({ id: talentProfiles.id })
    .from(talentProfiles)
    .where(eq(talentProfiles.userId, userId))
  const profileIds = profiles.map((p) => p.id)
  if (profileIds.length === 0) return []

  const assignments = await db
    .select({ workPackageId: projectAssignments.workPackageId })
    .from(projectAssignments)
    .where(
      and(
        eq(projectAssignments.projectId, projectId),
        eq(projectAssignments.status, 'active'),
        inArray(projectAssignments.talentId, profileIds),
      ),
    )
  const workPackageIds = assignments
    .map((a) => a.workPackageId)
    .filter((id): id is string => id !== null)

  const rows = await db
    .select({ id: milestones.id })
    .from(milestones)
    .where(
      and(
        eq(milestones.projectId, projectId),
        or(
          inArray(milestones.assignedTalentId, profileIds),
          workPackageIds.length > 0 ? inArray(milestones.workPackageId, workPackageIds) : undefined,
        ),
      ),
    )
  return rows.map((r) => r.id)
}

/**
 * GET /api/v1/projects/:projectId/invoices
 *   List invoices for a project (for invoice history UI).
 *
 * Returns only the caller's own copy of each invoice, and for a talent only
 * the milestones they worked on — a project can carry several talents, and
 * one talent's payout is not another's business.
 */
invoicesRoute.get('/projects/:projectId/invoices', async (c) => {
  const user = getAuthUser(c)
  const projectId = c.req.param('projectId')

  const db = getDb()
  let audience: InvoiceAudience = 'admin'
  let visibleMilestoneIds: string[] | null = null

  if (user.role !== 'admin') {
    const [project] = await db
      .select({ ownerId: projects.ownerId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1)
    if (!project) throw new AppError('NOT_FOUND', 'Project not found')

    if (project.ownerId === user.id) {
      audience = 'owner'
    } else {
      audience = 'talent'
      visibleMilestoneIds = await talentMilestoneIds(user.id, projectId)
      if (visibleMilestoneIds.length === 0) {
        throw new AppError('AUTH_FORBIDDEN', 'Not authorized to view invoices for this project')
      }
    }
  }

  const repo = new InvoiceRepository(db)
  const items = await repo.findByProject(projectId, audience)
  const filtered = visibleMilestoneIds
    ? items.filter((i) => visibleMilestoneIds.includes(i.milestoneId))
    : items

  // The stored pdfUrl addresses object storage on an internal host behind a
  // private bucket, so a browser cannot open it. Hand back the authenticated
  // route instead, which is also what decides which copy the caller gets.
  return c.json({
    success: true,
    data: filtered.map((i) => ({
      invoiceNumber: i.invoiceNumber,
      milestoneId: i.milestoneId,
      downloadUrl: `/api/v1/projects/${projectId}/invoices/${i.milestoneId}.pdf`,
      audience: i.audience,
      generatedAt: i.generatedAt,
    })),
  })
})
