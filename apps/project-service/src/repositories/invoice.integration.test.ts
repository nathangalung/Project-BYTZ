import {
  milestones,
  projectAssignments,
  projectInvoices,
  projects,
  talentProfiles,
  transactions,
  user,
  workPackages,
} from '@kerjacus/db'
import { connectTestDatabase, hasTestDatabase, type TestHandle } from '@kerjacus/db/testing'
import { eq, sql } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { InvoiceRepository } from './invoice.repository'

/**
 * InvoiceRepository against Postgres.
 *
 * The previous suite handed this class a hand-written stub whose `select`
 * ignored its own arguments, so every join, every filter and the unique index
 * that stops a duplicate copy were all unexercised - the assertions only ever
 * measured the stub. Invoice numbers are what an owner quotes to their
 * accountant, so the properties are worth executing.
 */

const runIf = hasTestDatabase() ? describe : describe.skip

/** See milestone.integration.test.ts: serialises the integration files. */
const INTEGRATION_LOCK = sql`SELECT pg_advisory_lock(20260813)`

runIf('InvoiceRepository', () => {
  let handle: TestHandle
  let repo: InvoiceRepository
  let ownerId: string
  let talentUserId: string
  let talentId: string
  let projectId: string
  let workPackageId: string

  beforeAll(async () => {
    handle = await connectTestDatabase()
    await handle.db.execute(INTEGRATION_LOCK)
  }, 120_000)

  afterAll(async () => {
    await handle.close()
  })

  beforeEach(async () => {
    await handle.truncate()
    repo = new InvoiceRepository(handle.db)

    ownerId = uuidv7()
    talentUserId = uuidv7()
    await handle.db.insert(user).values([
      { id: ownerId, email: `owner-${ownerId}@example.test`, name: 'Ayu', emailVerified: false },
      {
        id: talentUserId,
        email: `talent-${talentUserId}@example.test`,
        name: 'Budi',
        emailVerified: false,
        role: 'talent',
      },
    ])

    talentId = uuidv7()
    await handle.db.insert(talentProfiles).values({ id: talentId, userId: talentUserId })

    projectId = uuidv7()
    await handle.db.insert(projects).values({
      id: projectId,
      ownerId,
      title: 'Marketplace revamp',
      description: 'Exercises the invoice repository',
      category: 'web_app',
      budgetMin: 5_000_000,
      budgetMax: 12_000_000,
      estimatedTimelineDays: 45,
      // final_price = talent_payout + platform_fee is a CHECK constraint.
      finalPrice: 10_000_000,
      talentPayout: 7_150_000,
      platformFee: 2_850_000,
    })

    workPackageId = uuidv7()
    await handle.db.insert(workPackages).values({
      id: workPackageId,
      projectId,
      title: 'Backend API',
      description: 'Endpoints and schema',
      orderIndex: 0,
      requiredSkills: ['backend'],
      estimatedHours: 80,
      amount: 10_000_000,
      talentPayout: 7_150_000,
    })
  })

  async function seedMilestone(
    over: Partial<typeof milestones.$inferInsert> = {},
  ): Promise<string> {
    const id = uuidv7()
    await handle.db.insert(milestones).values({
      id,
      projectId,
      assignedTalentId: talentId,
      title: 'Sprint one',
      description: 'First delivery',
      orderIndex: 0,
      amount: 4_000_000,
      dueDate: new Date('2026-09-01T00:00:00Z'),
      ...over,
    })
    return id
  }

  describe('loadInvoiceData', () => {
    it('resolves owner, talent, project and milestone for a directly assigned milestone', async () => {
      const milestoneId = await seedMilestone()

      const data = await repo.loadInvoiceData(milestoneId)

      expect(data).not.toBeNull()
      expect(data?.owner).toEqual({
        id: ownerId,
        name: 'Ayu',
        email: `owner-${ownerId}@example.test`,
      })
      expect(data?.talent).toEqual({
        id: talentId,
        name: 'Budi',
        email: `talent-${talentUserId}@example.test`,
      })
      expect(data?.project).toEqual({
        id: projectId,
        title: 'Marketplace revamp',
        finalPrice: 10_000_000,
        platformFee: 2_850_000,
      })
      expect(data?.milestone).toEqual({
        id: milestoneId,
        title: 'Sprint one',
        description: 'First delivery',
        amount: 4_000_000,
        workPackageId: null,
      })
    })

    /**
     * An integration milestone carries no assignee, so the talent has to come
     * from the live assignment on its work package.
     */
    it('falls back to the active assignment on the work package', async () => {
      const milestoneId = await seedMilestone({ assignedTalentId: null, workPackageId })
      await handle.db.insert(projectAssignments).values({
        id: uuidv7(),
        projectId,
        talentId,
        workPackageId,
        status: 'active',
      })

      const data = await repo.loadInvoiceData(milestoneId)

      expect(data?.talent.id).toBe(talentId)
      expect(data?.milestone.workPackageId).toBe(workPackageId)
    })

    // A replaced talent must not be billed for work they no longer hold.
    it('ignores an assignment that is no longer active', async () => {
      const milestoneId = await seedMilestone({ assignedTalentId: null, workPackageId })
      await handle.db.insert(projectAssignments).values({
        id: uuidv7(),
        projectId,
        talentId,
        workPackageId,
        status: 'terminated',
      })

      expect(await repo.loadInvoiceData(milestoneId)).toBeNull()
    })

    it('answers null when the milestone does not exist', async () => {
      expect(await repo.loadInvoiceData(uuidv7())).toBeNull()
    })

    it('answers null when no talent can be resolved at all', async () => {
      const milestoneId = await seedMilestone({ assignedTalentId: null })
      expect(await repo.loadInvoiceData(milestoneId)).toBeNull()
    })

    it('reports no transaction before the escrow release', async () => {
      const milestoneId = await seedMilestone()
      expect((await repo.loadInvoiceData(milestoneId))?.transaction).toBeNull()
    })

    /** Two releases mean a correction; the invoice quotes the latest. */
    it('takes the most recent escrow release and ignores other types', async () => {
      const milestoneId = await seedMilestone()
      await handle.db.insert(transactions).values([
        {
          id: uuidv7(),
          projectId,
          milestoneId,
          type: 'escrow_release',
          amount: 2_000_000,
          idempotencyKey: `release-old-${milestoneId}`,
          createdAt: new Date('2026-08-01T00:00:00Z'),
        },
        {
          id: uuidv7(),
          projectId,
          milestoneId,
          type: 'escrow_release',
          amount: 2_860_000,
          idempotencyKey: `release-new-${milestoneId}`,
          createdAt: new Date('2026-08-09T00:00:00Z'),
        },
        {
          id: uuidv7(),
          projectId,
          milestoneId,
          type: 'escrow_in',
          amount: 9_999_999,
          idempotencyKey: `deposit-${milestoneId}`,
          createdAt: new Date('2026-08-10T00:00:00Z'),
        },
      ])

      expect((await repo.loadInvoiceData(milestoneId))?.transaction).toEqual({ amount: 2_860_000 })
    })
  })

  /**
   * A milestone settles once, so its owner, talent and admin copies are three
   * renderings of one invoice and share one number. The sequence counts
   * milestones invoiced, not rows written.
   */
  describe('invoiceNumberForMilestone', () => {
    it('opens a project at 0001 and takes the last eight of the project id', async () => {
      const milestoneId = await seedMilestone()
      const expected = `INV-${projectId.slice(-8).toUpperCase()}-0001`

      expect(await repo.invoiceNumberForMilestone(projectId, milestoneId)).toBe(expected)
    })

    it('reuses the number a sibling copy already holds', async () => {
      const milestoneId = await seedMilestone()
      await repo.recordInvoice({
        projectId,
        milestoneId,
        invoiceNumber: 'INV-FIXED-0004',
        pdfUrl: 's3://invoices/owner.pdf',
        audience: 'owner',
      })

      expect(await repo.invoiceNumberForMilestone(projectId, milestoneId)).toBe('INV-FIXED-0004')
    })

    /**
     * The bug the DISTINCT exists for: three copies of one settlement are one
     * invoice, so the next milestone is 0002 rather than 0004.
     */
    it('advances once per milestone invoiced, not once per copy written', async () => {
      const first = await seedMilestone()
      const number = await repo.invoiceNumberForMilestone(projectId, first)
      for (const audience of ['owner', 'talent', 'admin'] as const) {
        await repo.recordInvoice({
          projectId,
          milestoneId: first,
          invoiceNumber: number,
          pdfUrl: `s3://invoices/${audience}.pdf`,
          audience,
        })
      }

      const second = await seedMilestone({ orderIndex: 1 })

      expect(await repo.invoiceNumberForMilestone(projectId, second)).toBe(
        `INV-${projectId.slice(-8).toUpperCase()}-0002`,
      )
    })

    it('pads the sequence to four digits', async () => {
      for (let i = 0; i < 41; i++) {
        const id = await seedMilestone({ orderIndex: i })
        await repo.recordInvoice({
          projectId,
          milestoneId: id,
          invoiceNumber: `INV-SEED-${i}`,
          pdfUrl: 's3://invoices/seed.pdf',
          audience: 'owner',
        })
      }

      const next = await seedMilestone({ orderIndex: 99 })
      expect(await repo.invoiceNumberForMilestone(projectId, next)).toBe(
        `INV-${projectId.slice(-8).toUpperCase()}-0042`,
      )
    })

    // Another project's invoices must not push this project's sequence along.
    it('counts only the project it was asked about', async () => {
      const otherProject = uuidv7()
      await handle.db.insert(projects).values({
        id: otherProject,
        ownerId,
        title: 'Other',
        description: 'Other project',
        category: 'mobile_app',
        budgetMin: 1,
        budgetMax: 2,
        estimatedTimelineDays: 1,
      })
      const otherMilestone = uuidv7()
      await handle.db.insert(milestones).values({
        id: otherMilestone,
        projectId: otherProject,
        title: 'Theirs',
        description: 'Theirs',
        orderIndex: 0,
        amount: 1_000,
        dueDate: new Date('2026-09-01T00:00:00Z'),
      })
      await repo.recordInvoice({
        projectId: otherProject,
        milestoneId: otherMilestone,
        invoiceNumber: 'INV-OTHER-0001',
        pdfUrl: 's3://invoices/other.pdf',
        audience: 'owner',
      })

      const mine = await seedMilestone()
      expect(await repo.invoiceNumberForMilestone(projectId, mine)).toBe(
        `INV-${projectId.slice(-8).toUpperCase()}-0001`,
      )
    })
  })

  describe('recordInvoice', () => {
    it('returns the stored row', async () => {
      const milestoneId = await seedMilestone()

      const row = await repo.recordInvoice({
        projectId,
        milestoneId,
        invoiceNumber: 'INV-AAAA-0001',
        pdfUrl: 's3://invoices/owner.pdf',
        audience: 'owner',
      })

      expect(row.audience).toBe('owner')
      expect(row.invoiceNumber).toBe('INV-AAAA-0001')
      expect(row.generatedAt).toBeInstanceOf(Date)

      const stored = await handle.db
        .select()
        .from(projectInvoices)
        .where(eq(projectInvoices.id, row.id))
      expect(stored).toHaveLength(1)
    })

    it('stores the three audiences of one settlement under one number', async () => {
      const milestoneId = await seedMilestone()
      for (const audience of ['owner', 'talent', 'admin'] as const) {
        await repo.recordInvoice({
          projectId,
          milestoneId,
          invoiceNumber: 'INV-AAAA-0001',
          pdfUrl: `s3://invoices/${audience}.pdf`,
          audience,
        })
      }

      const rows = await handle.db
        .select()
        .from(projectInvoices)
        .where(eq(projectInvoices.milestoneId, milestoneId))
      expect(rows).toHaveLength(3)
      expect(new Set(rows.map((r) => r.invoiceNumber))).toEqual(new Set(['INV-AAAA-0001']))
    })

    /**
     * uq_project_invoices_milestone_audience is what stops a redelivered
     * invoice event from writing an owner a second copy. The consumer checks
     * first, but two concurrent consumers both pass that check.
     */
    it('lets the database reject a second copy for the same audience', async () => {
      const milestoneId = await seedMilestone()
      await repo.recordInvoice({
        projectId,
        milestoneId,
        invoiceNumber: 'INV-AAAA-0001',
        pdfUrl: 's3://invoices/owner.pdf',
        audience: 'owner',
      })

      // Named rather than matched on the message: drizzle wraps the failure and
      // reports the query, so only the cause says which rule refused it.
      await expect(
        repo.recordInvoice({
          projectId,
          milestoneId,
          invoiceNumber: 'INV-AAAA-0001',
          pdfUrl: 's3://invoices/owner-again.pdf',
          audience: 'owner',
        }),
      ).rejects.toMatchObject({
        cause: { code: '23505', constraint_name: 'uq_project_invoices_milestone_audience' },
      })

      const rows = await handle.db
        .select()
        .from(projectInvoices)
        .where(eq(projectInvoices.milestoneId, milestoneId))
      expect(rows).toHaveLength(1)
      expect(rows[0]?.pdfUrl).toBe('s3://invoices/owner.pdf')
    })
  })

  describe('findByMilestone', () => {
    it('returns the copy for the audience asked for', async () => {
      const milestoneId = await seedMilestone()
      for (const audience of ['owner', 'talent'] as const) {
        await repo.recordInvoice({
          projectId,
          milestoneId,
          invoiceNumber: 'INV-AAAA-0001',
          pdfUrl: `s3://invoices/${audience}.pdf`,
          audience,
        })
      }

      expect((await repo.findByMilestone(milestoneId, 'talent'))?.pdfUrl).toBe(
        's3://invoices/talent.pdf',
      )
    })

    it('answers undefined for an audience with no copy', async () => {
      const milestoneId = await seedMilestone()
      await repo.recordInvoice({
        projectId,
        milestoneId,
        invoiceNumber: 'INV-AAAA-0001',
        pdfUrl: 's3://invoices/owner.pdf',
        audience: 'owner',
      })

      expect(await repo.findByMilestone(milestoneId, 'admin')).toBeUndefined()
    })
  })

  describe('findByProject', () => {
    async function seedCopies(count: number): Promise<string[]> {
      const ids: string[] = []
      for (let i = 0; i < count; i++) {
        const milestoneId = await seedMilestone({ orderIndex: i })
        ids.push(milestoneId)
        for (const audience of ['owner', 'talent'] as const) {
          await repo.recordInvoice({
            projectId,
            milestoneId,
            invoiceNumber: `INV-AAAA-000${i + 1}`,
            pdfUrl: `s3://invoices/${i}-${audience}.pdf`,
            audience,
          })
        }
      }
      return ids
    }

    it('returns only the audience asked for', async () => {
      await seedCopies(2)

      const rows = await repo.findByProject(projectId, 'owner')
      expect(rows).toHaveLength(2)
      expect(rows.every((r) => r.audience === 'owner')).toBe(true)
    })

    it('orders newest first', async () => {
      const ids = await seedCopies(3)
      await handle.db
        .update(projectInvoices)
        .set({ generatedAt: new Date('2026-01-01T00:00:00Z') })
        .where(eq(projectInvoices.milestoneId, ids[0] as string))
      await handle.db
        .update(projectInvoices)
        .set({ generatedAt: new Date('2026-06-01T00:00:00Z') })
        .where(eq(projectInvoices.milestoneId, ids[2] as string))

      const rows = await repo.findByProject(projectId, 'owner')
      expect(rows[rows.length - 1]?.milestoneId).toBe(ids[0])
    })

    /**
     * A talent may only see invoices for milestones they hold. That was
     * filtered in the route after loading every invoice for the project, so
     * the query scope did not match the access scope.
     */
    it('narrows to the milestones the caller is allowed to see', async () => {
      const ids = await seedCopies(3)

      const rows = await repo.findByProject(projectId, 'talent', [ids[1] as string])

      expect(rows).toHaveLength(1)
      expect(rows[0]?.milestoneId).toBe(ids[1])
    })

    /** An empty allowlist means nothing is visible, not everything. */
    it('returns nothing for an empty allowlist', async () => {
      await seedCopies(2)

      expect(await repo.findByProject(projectId, 'owner', [])).toEqual([])
    })

    it('does not leak another project invoices', async () => {
      await seedCopies(1)
      const otherProject = uuidv7()
      await handle.db.insert(projects).values({
        id: otherProject,
        ownerId,
        title: 'Other',
        description: 'Other project',
        category: 'data_ai',
        budgetMin: 1,
        budgetMax: 2,
        estimatedTimelineDays: 1,
      })

      expect(await repo.findByProject(otherProject, 'owner')).toEqual([])
    })
  })
})
