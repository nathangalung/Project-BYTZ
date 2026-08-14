// biome-ignore-all lint/style/noRestrictedImports: the rule keeps route HANDLERS
// off Drizzle. This is a test, and the tables are what the fixtures are made of.

import {
  getDb,
  milestones,
  projectAssignments,
  projectInvoices,
  projects,
  talentProfiles,
  user,
  workPackages,
} from '@kerjacus/db'
import { connectTestDatabase, hasTestDatabase, type TestHandle } from '@kerjacus/db/testing'
import { eq, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { errorHandler } from '../middleware/error-handler'
import type { SessionUser } from '../middleware/session'
import { invoicesRoute } from './invoices'

/**
 * One invoice number, three copies, and who gets which.
 *
 * The owner's copy carries the gross they paid; the talent's carries the
 * payout; the fee is the difference, so a single copy must never carry both.
 * That makes the audience an access-control decision, and it is derived from
 * the caller's relationship to the project rather than from the URL - which is
 * the property worth executing, because the URL is the same for all three.
 *
 * On a team project it is narrower still: a talent may read only the
 * milestones they worked, because one talent's payout is not another's
 * business.
 */
vi.hoisted(() => {
  // env validates at import time, so storage has to be switched off first.
  process.env.S3_ENDPOINT = 'disabled'
})

const runIf = hasTestDatabase() ? describe : describe.skip
const INTEGRATION_LOCK = sql`SELECT pg_advisory_lock(20260813)`

function session(id: string, role = 'talent'): SessionUser {
  return { id, email: `${id}@example.test`, name: 'Caller', role }
}

function appAs(caller: SessionUser) {
  const app = new Hono()
  app.onError(errorHandler)
  app.use('*', async (c, next) => {
    c.set('user' as never, caller as never)
    await next()
  })
  app.route('/', invoicesRoute)
  return app
}

type ErrorBody = { success: false; error: { code: string; message: string } }
type ListBody = { data: { invoiceNumber: string; milestoneId: string; audience: string }[] }

runIf('invoice routes against Postgres', () => {
  let handle: TestHandle

  let ownerId: string
  let talentUserId: string
  let talentId: string
  let otherTalentUserId: string
  let otherTalentId: string
  let strangerId: string
  let adminId: string

  let projectId: string
  let packageId: string
  let otherPackageId: string
  let milestoneId: string
  let otherMilestoneId: string

  beforeAll(async () => {
    handle = await connectTestDatabase()
    await handle.db.execute(INTEGRATION_LOCK)
    getDb(process.env.TEST_DATABASE_URL)
  }, 120_000)

  afterAll(async () => {
    await handle.close()
  })

  async function makeUser(name: string): Promise<string> {
    const id = uuidv7()
    await handle.db
      .insert(user)
      .values({ id, email: `${name}-${id}@example.test`, name, emailVerified: false })
    return id
  }

  async function makeTalent(userId: string): Promise<string> {
    const id = uuidv7()
    await handle.db.insert(talentProfiles).values({ id, userId, verificationStatus: 'verified' })
    return id
  }

  async function makePackage(title: string, order: number): Promise<string> {
    const id = uuidv7()
    await handle.db.insert(workPackages).values({
      id,
      projectId,
      title,
      description: 'Package',
      orderIndex: order,
      requiredSkills: ['backend'],
      estimatedHours: 40,
      amount: 5_000_000,
      talentPayout: 3_575_000,
      status: 'in_progress',
    })
    return id
  }

  async function makeMilestone(wp: string, talent: string, title: string): Promise<string> {
    const id = uuidv7()
    await handle.db.insert(milestones).values({
      id,
      projectId,
      workPackageId: wp,
      assignedTalentId: talent,
      title,
      description: 'Delivered',
      orderIndex: 0,
      amount: 5_000_000,
      status: 'approved',
      dueDate: new Date(Date.now() + 86_400_000),
    })
    return id
  }

  beforeEach(async () => {
    await handle.truncate()

    ownerId = await makeUser('owner')
    talentUserId = await makeUser('talent')
    talentId = await makeTalent(talentUserId)
    otherTalentUserId = await makeUser('other-talent')
    otherTalentId = await makeTalent(otherTalentUserId)
    strangerId = await makeUser('stranger')
    adminId = await makeUser('admin')

    projectId = uuidv7()
    await handle.db.insert(projects).values({
      id: projectId,
      ownerId,
      title: 'Invoiced project',
      description: 'Exercises invoice audience rules',
      category: 'web_app',
      budgetMin: 1_000_000,
      budgetMax: 20_000_000,
      estimatedTimelineDays: 60,
      status: 'in_progress',
      teamSize: 2,
      finalPrice: 10_000_000,
      talentPayout: 7_150_000,
      platformFee: 2_850_000,
    })

    packageId = await makePackage('Backend API', 0)
    otherPackageId = await makePackage('Frontend', 1)

    await handle.db.insert(projectAssignments).values({
      id: uuidv7(),
      projectId,
      talentId,
      workPackageId: packageId,
      acceptanceStatus: 'accepted',
      status: 'active',
    })
    await handle.db.insert(projectAssignments).values({
      id: uuidv7(),
      projectId,
      talentId: otherTalentId,
      workPackageId: otherPackageId,
      acceptanceStatus: 'accepted',
      status: 'active',
    })

    milestoneId = await makeMilestone(packageId, talentId, 'Backend milestone')
    otherMilestoneId = await makeMilestone(otherPackageId, otherTalentId, 'Frontend milestone')
  })

  async function recordInvoices(milestone: string, number: string) {
    for (const audience of ['owner', 'talent', 'admin'] as const) {
      await handle.db.insert(projectInvoices).values({
        id: uuidv7(),
        projectId,
        milestoneId: milestone,
        invoiceNumber: number,
        pdfUrl: `file:///tmp/${number}-${audience}.pdf`,
        audience,
      })
    }
  }

  describe('GET /projects/:projectId/invoices/:filename', () => {
    /**
     * The URL is identical for all three parties, so the copy served is chosen
     * by who is asking. A caller who could name their own audience would be
     * choosing whether to see the platform fee.
     */
    it('serves the owner copy to the owner', async () => {
      const res = await appAs(session(ownerId, 'owner')).request(
        `/projects/${projectId}/invoices/${milestoneId}.pdf`,
      )

      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Type')).toBe('application/pdf')
      const [row] = await handle.db
        .select({ audience: projectInvoices.audience })
        .from(projectInvoices)
        .where(eq(projectInvoices.milestoneId, milestoneId))
      expect(row?.audience).toBe('owner')
    })

    it('serves the talent copy to the assigned talent', async () => {
      const res = await appAs(session(talentUserId)).request(
        `/projects/${projectId}/invoices/${milestoneId}.pdf`,
      )

      expect(res.status).toBe(200)
      const rows = await handle.db
        .select({ audience: projectInvoices.audience })
        .from(projectInvoices)
        .where(eq(projectInvoices.milestoneId, milestoneId))
      expect(rows.map((r) => r.audience)).toEqual(['talent'])
    })

    it('serves the admin copy, the only one carrying the fee, to an admin', async () => {
      const res = await appAs(session(adminId, 'admin')).request(
        `/projects/${projectId}/invoices/${milestoneId}.pdf`,
      )

      expect(res.status).toBe(200)
      const rows = await handle.db
        .select({ audience: projectInvoices.audience })
        .from(projectInvoices)
        .where(eq(projectInvoices.milestoneId, milestoneId))
      expect(rows.map((r) => r.audience)).toEqual(['admin'])
    })

    /** A teammate's payout is not this talent's business. */
    it("refuses a talent the invoice for a teammate's milestone", async () => {
      const res = await appAs(session(talentUserId)).request(
        `/projects/${projectId}/invoices/${otherMilestoneId}.pdf`,
      )

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.code).toBe('AUTH_FORBIDDEN')
    })

    it('refuses a signed-in stranger', async () => {
      const res = await appAs(session(strangerId)).request(
        `/projects/${projectId}/invoices/${milestoneId}.pdf`,
      )

      expect(res.status).toBe(403)
    })

    it('rejects a filename that is not a PDF', async () => {
      const res = await appAs(session(ownerId, 'owner')).request(
        `/projects/${projectId}/invoices/${milestoneId}.txt`,
      )

      expect(res.status).toBe(400)
      expect(((await res.json()) as ErrorBody).error.code).toBe('VALIDATION_ERROR')
    })

    it('rejects an empty milestone id', async () => {
      const res = await appAs(session(ownerId, 'owner')).request(
        `/projects/${projectId}/invoices/.pdf`,
      )

      expect(res.status).toBe(400)
    })

    it('reports an unknown project as not found', async () => {
      const res = await appAs(session(ownerId, 'owner')).request(
        `/projects/${uuidv7()}/invoices/${milestoneId}.pdf`,
      )

      expect(res.status).toBe(404)
    })

    it('reports a milestone that is not on this project as not found', async () => {
      const res = await appAs(session(ownerId, 'owner')).request(
        `/projects/${projectId}/invoices/${uuidv7()}.pdf`,
      )

      expect(res.status).toBe(404)
    })

    /** A replaced talent must not keep reading the payouts of whoever took over. */
    it('refuses a talent whose assignment was terminated', async () => {
      await handle.db
        .update(milestones)
        .set({ assignedTalentId: null })
        .where(eq(milestones.id, milestoneId))
      await handle.db
        .update(projectAssignments)
        .set({ status: 'terminated' })
        .where(eq(projectAssignments.workPackageId, packageId))

      const res = await appAs(session(talentUserId)).request(
        `/projects/${projectId}/invoices/${milestoneId}.pdf`,
      )

      expect(res.status).toBe(403)
    })
  })

  describe('GET /projects/:projectId/invoices', () => {
    beforeEach(async () => {
      await recordInvoices(milestoneId, 'INV-0001')
      await recordInvoices(otherMilestoneId, 'INV-0002')
    })

    it('lists every milestone to the owner, as owner copies', async () => {
      const res = await appAs(session(ownerId, 'owner')).request(`/projects/${projectId}/invoices`)

      expect(res.status).toBe(200)
      const body = (await res.json()) as ListBody
      expect(body.data).toHaveLength(2)
      expect(new Set(body.data.map((i) => i.audience))).toEqual(new Set(['owner']))
    })

    /** The allowlist is applied in SQL rather than filtered after loading. */
    it('lists only the milestones a talent worked, as talent copies', async () => {
      const res = await appAs(session(talentUserId)).request(`/projects/${projectId}/invoices`)

      const body = (await res.json()) as ListBody
      expect(body.data).toHaveLength(1)
      expect(body.data[0]?.milestoneId).toBe(milestoneId)
      expect(body.data[0]?.audience).toBe('talent')
    })

    it('lists the admin copies to an admin', async () => {
      const res = await appAs(session(adminId, 'admin')).request(`/projects/${projectId}/invoices`)

      const body = (await res.json()) as ListBody
      expect(body.data).toHaveLength(2)
      expect(new Set(body.data.map((i) => i.audience))).toEqual(new Set(['admin']))
    })

    it('refuses a talent with no standing on the project', async () => {
      const outsiderUser = await makeUser('outsider')
      await makeTalent(outsiderUser)

      const res = await appAs(session(outsiderUser)).request(`/projects/${projectId}/invoices`)

      expect(res.status).toBe(403)
      expect(((await res.json()) as ErrorBody).error.code).toBe('AUTH_FORBIDDEN')
    })

    it('refuses a caller with no talent profile at all', async () => {
      const res = await appAs(session(strangerId)).request(`/projects/${projectId}/invoices`)

      expect(res.status).toBe(403)
    })

    /**
     * An empty list is not the same answer as a refusal: a talent assigned but
     * with nothing invoiced yet is authorized and simply has no rows.
     */
    it('returns an empty list to an assigned talent with nothing invoiced', async () => {
      await handle.db.delete(projectInvoices)

      const res = await appAs(session(talentUserId)).request(`/projects/${projectId}/invoices`)

      expect(res.status).toBe(200)
      expect(((await res.json()) as ListBody).data).toEqual([])
    })

    /** The stored URL points at a private bucket on an internal host. */
    it('hands back the authenticated route rather than the storage URL', async () => {
      const res = await appAs(session(ownerId, 'owner')).request(`/projects/${projectId}/invoices`)

      const body = (await res.json()) as { data: { downloadUrl: string }[] }
      expect(body.data[0]?.downloadUrl).toBe(
        `/api/v1/projects/${projectId}/invoices/${body.data[0]?.milestoneId}.pdf`,
      )
      expect(JSON.stringify(body)).not.toContain('file://')
    })

    it('reports an unknown project as not found', async () => {
      const res = await appAs(session(ownerId, 'owner')).request(`/projects/${uuidv7()}/invoices`)

      expect(res.status).toBe(404)
    })
  })
})
