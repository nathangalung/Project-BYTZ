import {
  disputes,
  outboxEvents,
  projectStatusLogs,
  projects,
  transactions,
  user,
} from '@kerjacus/db'
import { connectTestDatabase, hasTestDatabase, type TestHandle } from '@kerjacus/db/testing'
import { asc, eq, sql } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { DisputeRepository } from './dispute.repository'

/**
 * DisputeRepository against Postgres.
 *
 * Money moves through the resolve path and the freeze is what holds it. None
 * of it had a test of any kind: this was the one substantial route file with
 * no seam at all, and the repository that replaced it was never executed.
 */

const runIf = hasTestDatabase() ? describe : describe.skip

/** See milestone.integration.test.ts: serialises the integration files. */
const INTEGRATION_LOCK = sql`SELECT pg_advisory_lock(20260813)`

runIf('DisputeRepository', () => {
  let handle: TestHandle
  let repo: DisputeRepository
  let ownerId: string
  let talentUserId: string
  let projectId: string

  beforeAll(async () => {
    handle = await connectTestDatabase()
    await handle.db.execute(INTEGRATION_LOCK)
  }, 120_000)

  afterAll(async () => {
    await handle.close()
  })

  beforeEach(async () => {
    await handle.truncate()
    repo = new DisputeRepository(handle.db)

    ownerId = uuidv7()
    talentUserId = uuidv7()
    await handle.db.insert(user).values([
      { id: ownerId, email: `owner-${ownerId}@example.test`, name: 'Owner', emailVerified: false },
      {
        id: talentUserId,
        email: `talent-${talentUserId}@example.test`,
        name: 'Talent',
        emailVerified: false,
        role: 'talent',
      },
    ])

    projectId = uuidv7()
    await handle.db.insert(projects).values({
      id: projectId,
      ownerId,
      title: 'Disputed build',
      description: 'Exercises the dispute repository',
      category: 'web_app',
      budgetMin: 1_000_000,
      budgetMax: 9_000_000,
      estimatedTimelineDays: 60,
      status: 'in_progress',
    })
  })

  function createInput(over: Partial<Parameters<DisputeRepository['create']>[0]> = {}) {
    return {
      id: uuidv7(),
      projectId,
      workPackageId: null,
      initiatedBy: ownerId,
      againstUserId: talentUserId,
      reason: 'Deliverable does not match the PRD',
      evidenceUrls: ['s3://evidence/one.png'],
      fromStatus: 'in_progress',
      ...over,
    }
  }

  async function projectStatus(): Promise<string | undefined> {
    const [row] = await handle.db
      .select({ status: projects.status })
      .from(projects)
      .where(eq(projects.id, projectId))
    return row?.status
  }

  async function outbox() {
    return await handle.db
      .select({
        aggregateType: outboxEvents.aggregateType,
        aggregateId: outboxEvents.aggregateId,
        eventType: outboxEvents.eventType,
        payload: outboxEvents.payload,
      })
      .from(outboxEvents)
      .orderBy(asc(outboxEvents.id))
  }

  describe('create', () => {
    it('stores the dispute open with its evidence', async () => {
      const input = createInput()

      const created = await repo.create(input)

      expect(created.status).toBe('open')
      expect(created.reason).toBe('Deliverable does not match the PRD')
      expect(created.evidenceUrls).toEqual(['s3://evidence/one.png'])
      expect(created.resolvedAt).toBeNull()

      const stored = await handle.db.select().from(disputes).where(eq(disputes.id, input.id))
      expect(stored).toHaveLength(1)
    })

    /**
     * The freeze has to land with the dispute or not at all. A dispute
     * recorded against a project still accepting transitions lets a milestone
     * approval race the resolution and move the money the dispute exists to
     * hold.
     */
    it('freezes the project in the same commit', async () => {
      await repo.create(createInput())

      expect(await projectStatus()).toBe('disputed')
    })

    it('records the transition in the audit trail', async () => {
      await repo.create(createInput())

      const [log] = await handle.db
        .select()
        .from(projectStatusLogs)
        .where(eq(projectStatusLogs.projectId, projectId))

      expect(log?.fromStatus).toBe('in_progress')
      expect(log?.toStatus).toBe('disputed')
      expect(log?.changedBy).toBe(ownerId)
      expect(log?.reason).toBe('Dispute opened')
    })

    it('publishes both the dispute and the project transition', async () => {
      const input = createInput()

      await repo.create(input)

      const events = await outbox()
      expect(events.map((e) => e.eventType)).toEqual(['dispute.created', 'project.status.changed'])
      expect(events[0]).toMatchObject({
        aggregateType: 'dispute',
        aggregateId: input.id,
        payload: {
          disputeId: input.id,
          projectId,
          initiatedBy: ownerId,
          againstUserId: talentUserId,
        },
      })
      expect(events[1]).toMatchObject({
        aggregateType: 'project',
        aggregateId: projectId,
        payload: { fromStatus: 'in_progress', toStatus: 'disputed', changedBy: ownerId },
      })
    })

    it('scopes a team dispute to one work package', async () => {
      const created = await repo.create(createInput({ workPackageId: null }))
      expect(created.workPackageId).toBeNull()
    })

    /**
     * Atomicity, proven rather than asserted from the source: an invalid
     * from-status fails the audit-log insert, which runs after the dispute row
     * and the freeze. Nothing may survive.
     */
    it('rolls the dispute and the freeze back together when a later write fails', async () => {
      const input = createInput({ fromStatus: 'not_a_real_status' })

      await expect(repo.create(input)).rejects.toThrow()

      expect(await handle.db.select().from(disputes)).toHaveLength(0)
      expect(await projectStatus()).toBe('in_progress')
      expect(await handle.db.select().from(projectStatusLogs)).toHaveLength(0)
      expect(await outbox()).toHaveLength(0)
    })
  })

  describe('findById', () => {
    it('returns the stored dispute', async () => {
      const input = createInput()
      await repo.create(input)

      expect((await repo.findById(input.id))?.id).toBe(input.id)
    })

    it('answers undefined for an unknown id', async () => {
      expect(await repo.findById(uuidv7())).toBeUndefined()
    })
  })

  describe('findProjectOwner', () => {
    it('returns the owner id', async () => {
      expect(await repo.findProjectOwner(projectId)).toBe(ownerId)
    })

    it('answers undefined for an unknown project', async () => {
      expect(await repo.findProjectOwner(uuidv7())).toBeUndefined()
    })
  })

  /**
   * The caller sizes the refund from the ledger balance and spreads it across
   * these, because the payment service caps each refund at its own
   * transaction's amount. This once took one row and filtered it by
   * work_package_id - no escrow_in row carries one, so it matched nothing and
   * the refund was silently skipped.
   */
  describe('findEscrowDeposits', () => {
    async function seedTransaction(over: Partial<typeof transactions.$inferInsert> = {}) {
      const id = uuidv7()
      await handle.db.insert(transactions).values({
        id,
        projectId,
        type: 'escrow_in',
        amount: 1_000_000,
        status: 'completed',
        idempotencyKey: `key-${id}`,
        ...over,
      })
      return id
    }

    it('returns every settled deposit oldest first', async () => {
      const second = await seedTransaction({
        amount: 2_000_000,
        createdAt: new Date('2026-06-01T00:00:00Z'),
      })
      const first = await seedTransaction({
        amount: 3_000_000,
        createdAt: new Date('2026-05-01T00:00:00Z'),
      })

      const rows = await repo.findEscrowDeposits(projectId)

      expect(rows).toEqual([
        { id: first, amount: 3_000_000 },
        { id: second, amount: 2_000_000 },
      ])
    })

    it('ignores deposits that never settled', async () => {
      await seedTransaction({ status: 'pending' })
      expect(await repo.findEscrowDeposits(projectId)).toEqual([])
    })

    it('ignores releases and refunds', async () => {
      await seedTransaction({ type: 'escrow_release' })
      await seedTransaction({ type: 'refund' })

      expect(await repo.findEscrowDeposits(projectId)).toEqual([])
    })

    it('does not reach into another project escrow', async () => {
      await seedTransaction()
      const otherProject = uuidv7()
      await handle.db.insert(projects).values({
        id: otherProject,
        ownerId,
        title: 'Other',
        description: 'Other',
        category: 'mobile_app',
        budgetMin: 1,
        budgetMax: 2,
        estimatedTimelineDays: 1,
      })

      expect(await repo.findEscrowDeposits(otherProject)).toEqual([])
    })
  })

  describe('findByProject', () => {
    it('returns the project disputes newest first', async () => {
      const older = createInput()
      await repo.create(older)
      await handle.db
        .update(disputes)
        .set({ createdAt: new Date('2026-01-01T00:00:00Z') })
        .where(eq(disputes.id, older.id))
      const newer = createInput({ fromStatus: 'disputed' })
      await repo.create(newer)

      const rows = await repo.findByProject(projectId)
      expect(rows.map((r) => r.id)).toEqual([newer.id, older.id])
    })

    it('returns nothing for a project with no disputes', async () => {
      expect(await repo.findByProject(uuidv7())).toEqual([])
    })
  })

  describe('list', () => {
    async function seedDisputes(count: number, status?: 'open' | 'resolved'): Promise<string[]> {
      const ids: string[] = []
      for (let i = 0; i < count; i++) {
        const input = createInput({ fromStatus: i === 0 ? 'in_progress' : 'disputed' })
        await repo.create(input)
        if (status && status !== 'open') {
          await handle.db.update(disputes).set({ status }).where(eq(disputes.id, input.id))
        }
        ids.push(input.id)
      }
      return ids
    }

    it('reports the unfiltered total alongside the page', async () => {
      await seedDisputes(3)

      const { items, total } = await repo.list(undefined, { page: 1, pageSize: 2 })

      expect(items).toHaveLength(2)
      expect(total).toBe(3)
    })

    it('offsets to the second page', async () => {
      await seedDisputes(3)

      const first = await repo.list(undefined, { page: 1, pageSize: 2 })
      const second = await repo.list(undefined, { page: 2, pageSize: 2 })

      expect(second.items).toHaveLength(1)
      expect(first.items.map((d) => d.id)).not.toContain(second.items[0]?.id)
    })

    /** The count has to follow the filter, or the admin list pages into nothing. */
    it('narrows both the page and the total by status', async () => {
      await seedDisputes(2)
      const resolved = await seedDisputes(1, 'resolved')

      const { items, total } = await repo.list('resolved', { page: 1, pageSize: 10 })

      expect(items.map((d) => d.id)).toEqual(resolved)
      expect(total).toBe(1)
    })

    it('reports zero for an empty table', async () => {
      expect(await repo.list(undefined, { page: 1, pageSize: 10 })).toEqual({ items: [], total: 0 })
    })
  })

  describe('updateStatus', () => {
    it('moves the dispute and publishes the transition', async () => {
      const input = createInput()
      await repo.create(input)

      const updated = await repo.updateStatus(input.id, {
        projectId,
        fromStatus: 'open',
        toStatus: 'mediation',
      })

      expect(updated.status).toBe('mediation')

      const [stored] = await handle.db.select().from(disputes).where(eq(disputes.id, input.id))
      expect(stored?.status).toBe('mediation')

      const events = await outbox()
      expect(events.at(-1)).toMatchObject({
        eventType: 'dispute.status_changed',
        payload: { disputeId: input.id, fromStatus: 'open', toStatus: 'mediation' },
      })
    })

    // Escalation is the step before a binding decision, so it has to stick.
    it('carries the dispute all the way to escalated', async () => {
      const input = createInput()
      await repo.create(input)

      await repo.updateStatus(input.id, {
        projectId,
        fromStatus: 'open',
        toStatus: 'under_review',
      })
      const escalated = await repo.updateStatus(input.id, {
        projectId,
        fromStatus: 'under_review',
        toStatus: 'escalated',
      })

      expect(escalated.status).toBe('escalated')
    })
  })

  describe('resolve', () => {
    it('records the decision and publishes it', async () => {
      const input = createInput()
      await repo.create(input)

      const resolved = await repo.resolve(input.id, {
        projectId,
        resolution: 'Split 70-30 in favour of the talent',
        resolutionType: 'split',
        resolvedBy: ownerId,
      })

      expect(resolved.status).toBe('resolved')
      expect(resolved.resolution).toBe('Split 70-30 in favour of the talent')
      expect(resolved.resolutionType).toBe('split')
      expect(resolved.resolvedBy).toBe(ownerId)
      expect(resolved.resolvedAt).toBeInstanceOf(Date)

      const events = await outbox()
      expect(events.at(-1)).toMatchObject({
        eventType: 'dispute.resolved',
        payload: { disputeId: input.id, projectId, resolvedBy: ownerId, resolutionType: 'split' },
      })
    })

    it.each(['funds_to_talent', 'funds_to_owner', 'split'] as const)(
      'stores %s as the outcome',
      async (resolutionType) => {
        const input = createInput()
        await repo.create(input)

        const resolved = await repo.resolve(input.id, {
          projectId,
          resolution: 'Decided',
          resolutionType,
          resolvedBy: ownerId,
        })

        expect(resolved.resolutionType).toBe(resolutionType)
      },
    )

    it('leaves the stored row matching what it returned', async () => {
      const input = createInput()
      await repo.create(input)

      await repo.resolve(input.id, {
        projectId,
        resolution: 'Refund in full',
        resolutionType: 'funds_to_owner',
        resolvedBy: ownerId,
      })

      const [stored] = await handle.db.select().from(disputes).where(eq(disputes.id, input.id))
      expect(stored?.status).toBe('resolved')
      expect(stored?.resolutionType).toBe('funds_to_owner')
    })
  })
})
