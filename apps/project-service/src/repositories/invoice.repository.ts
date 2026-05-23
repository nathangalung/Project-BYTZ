import type { Database } from '@kerjacus/db'
import {
  milestones,
  projectAssignments,
  projectInvoices,
  projects,
  talentProfiles,
  transactions,
  user,
} from '@kerjacus/db'
import { AppError } from '@kerjacus/shared'
import { and, desc, eq, sql } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'

export type InvoiceRowSelect = typeof projectInvoices.$inferSelect

export type InvoiceSourceData = {
  owner: { id: string; name: string; email: string }
  talent: { id: string; name: string; email: string }
  project: { id: string; title: string; finalPrice: number | null; platformFee: number | null }
  milestone: { id: string; title: string; description: string; amount: number }
  transaction: { amount: number } | null
}

export class InvoiceRepository {
  constructor(private db: Database) {}

  /**
   * Load all data needed to render an invoice for a milestone.
   * Joins: milestones -> projects -> owner(user)
   *      milestones.assigned_talent_id -> talent_profiles -> user(talent)
   *      OR fallback via project_assignments + work_package_id
   *      latest transactions(type=escrow_release) for milestone
   */
  async loadInvoiceData(milestoneId: string): Promise<InvoiceSourceData | null> {
    const rows = await this.db
      .select({
        ownerId: user.id,
        ownerName: user.name,
        ownerEmail: user.email,
        projectId: projects.id,
        projectTitle: projects.title,
        projectFinalPrice: projects.finalPrice,
        projectPlatformFee: projects.platformFee,
        milestoneId: milestones.id,
        milestoneTitle: milestones.title,
        milestoneDescription: milestones.description,
        milestoneAmount: milestones.amount,
        milestoneWorkPackageId: milestones.workPackageId,
        milestoneAssignedTalentId: milestones.assignedTalentId,
      })
      .from(milestones)
      .innerJoin(projects, eq(projects.id, milestones.projectId))
      .innerJoin(user, eq(user.id, projects.ownerId))
      .where(eq(milestones.id, milestoneId))
      .limit(1)

    const row = rows[0]
    if (!row) return null

    // Resolve talent: either directly via milestone.assigned_talent_id,
    // or via project_assignments for the milestone's work package.
    let talentRow: { id: string; name: string; email: string } | null = null

    if (row.milestoneAssignedTalentId) {
      const [t] = await this.db
        .select({ id: talentProfiles.id, name: user.name, email: user.email })
        .from(talentProfiles)
        .innerJoin(user, eq(user.id, talentProfiles.userId))
        .where(eq(talentProfiles.id, row.milestoneAssignedTalentId))
        .limit(1)
      if (t) talentRow = t
    } else if (row.milestoneWorkPackageId) {
      const [t] = await this.db
        .select({ id: talentProfiles.id, name: user.name, email: user.email })
        .from(projectAssignments)
        .innerJoin(talentProfiles, eq(talentProfiles.id, projectAssignments.talentId))
        .innerJoin(user, eq(user.id, talentProfiles.userId))
        .where(
          and(
            eq(projectAssignments.workPackageId, row.milestoneWorkPackageId),
            eq(projectAssignments.status, 'active'),
          ),
        )
        .limit(1)
      if (t) talentRow = t
    }

    if (!talentRow) {
      // No assigned talent — cannot generate invoice
      return null
    }

    // Latest escrow_release transaction (optional)
    const [tx] = await this.db
      .select({ amount: transactions.amount })
      .from(transactions)
      .where(
        and(eq(transactions.milestoneId, milestoneId), eq(transactions.type, 'escrow_release')),
      )
      .orderBy(desc(transactions.createdAt))
      .limit(1)

    return {
      owner: { id: row.ownerId, name: row.ownerName, email: row.ownerEmail },
      talent: talentRow,
      project: {
        id: row.projectId,
        title: row.projectTitle,
        finalPrice: row.projectFinalPrice,
        platformFee: row.projectPlatformFee,
      },
      milestone: {
        id: row.milestoneId,
        title: row.milestoneTitle,
        description: row.milestoneDescription,
        amount: row.milestoneAmount,
      },
      transaction: tx ? { amount: tx.amount } : null,
    }
  }

  /**
   * Sequential invoice number per project: INV-{projectIdShort8}-{seq:04d}.
   * Race-safe via UNIQUE(invoice_number) — caller retries on conflict.
   */
  async nextInvoiceNumber(projectId: string): Promise<string> {
    const result = await this.db.execute<{ count: number }>(
      sql`SELECT COUNT(*)::int AS count FROM project_invoices WHERE project_id = ${projectId}`,
    )
    const row = (result as unknown as { count: number }[])[0]
    const count = row?.count ?? 0
    const seq = String(count + 1).padStart(4, '0')
    const shortId = projectId.slice(-8).toUpperCase()
    return `INV-${shortId}-${seq}`
  }

  async recordInvoice(input: {
    projectId: string
    milestoneId: string
    invoiceNumber: string
    pdfUrl: string
    isAdminCopy: boolean
  }): Promise<InvoiceRowSelect> {
    const [row] = await this.db
      .insert(projectInvoices)
      .values({
        id: uuidv7(),
        projectId: input.projectId,
        milestoneId: input.milestoneId,
        invoiceNumber: input.invoiceNumber,
        pdfUrl: input.pdfUrl,
        isAdminCopy: input.isAdminCopy,
      })
      .returning()

    if (!row) throw new AppError('INTERNAL_ERROR', 'Failed to record invoice')
    return row
  }

  async findByMilestone(
    milestoneId: string,
    isAdminCopy: boolean,
  ): Promise<InvoiceRowSelect | undefined> {
    const [row] = await this.db
      .select()
      .from(projectInvoices)
      .where(
        and(
          eq(projectInvoices.milestoneId, milestoneId),
          eq(projectInvoices.isAdminCopy, isAdminCopy),
        ),
      )
      .limit(1)
    return row
  }

  async findByProject(projectId: string): Promise<InvoiceRowSelect[]> {
    return await this.db
      .select()
      .from(projectInvoices)
      .where(eq(projectInvoices.projectId, projectId))
      .orderBy(desc(projectInvoices.generatedAt))
  }
}
