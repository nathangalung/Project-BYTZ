import {
  milestones,
  outboxEvents,
  projects,
  revisionRequests,
  talentProfiles,
  tasks,
  user,
} from '@kerjacus/db'
import { connectTestDatabase, hasTestDatabase, type TestHandle } from '@kerjacus/db/testing'
import { AppError } from '@kerjacus/shared'
import { and, asc, eq, sql } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { MilestoneRepository } from './milestone.repository'

/**
 * MilestoneRepository against Postgres.
 *
 * Everything here was pinned by regex over the source. A regex proves the
 * predicate is written; it cannot prove Postgres applies it, that the loser of
 * a race gets a conflict rather than a silent no-op, that the approval and its
 * invoice request land in one commit, or that the recipient join resolves to a
 * user id the notifications foreign key will accept.
 */

const runIf = hasTestDatabase() ? describe : describe.skip

/**
 * Integration files run in parallel forks and each truncates every table in
 * beforeEach, so two overlapping files delete each other's fixtures mid-test.
 * A session advisory lock serialises the integration files against each other
 * and leaves the unit tests parallel. Released when the connection closes.
 */
const INTEGRATION_LOCK = sql`SELECT pg_advisory_lock(20260813)`

runIf('MilestoneRepository', () => {
  let handle: TestHandle
  let repo: MilestoneRepository
  let ownerId: string
  let talentUserId: string
  let talentId: string
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
    repo = new MilestoneRepository(handle.db)

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

    talentId = uuidv7()
    await handle.db.insert(talentProfiles).values({ id: talentId, userId: talentUserId })

    projectId = uuidv7()
    await handle.db.insert(projects).values({
      id: projectId,
      ownerId,
      title: 'Integration project',
      description: 'Exercises the milestone repository',
      category: 'web_app',
      budgetMin: 1_000_000,
      budgetMax: 5_000_000,
      estimatedTimelineDays: 30,
    })
  })

  /** Insert directly so the test controls the starting status. */
  async function seedMilestone(
    over: Partial<typeof milestones.$inferInsert> = {},
  ): Promise<string> {
    const id = uuidv7()
    await handle.db.insert(milestones).values({
      id,
      projectId,
      assignedTalentId: talentId,
      title: 'Milestone under test',
      description: 'Seeded',
      orderIndex: 0,
      amount: 3_000_000,
      dueDate: new Date('2026-09-01T00:00:00Z'),
      ...over,
    })
    return id
  }

  async function outboxFor(aggregateId: string) {
    return await handle.db
      .select({ eventType: outboxEvents.eventType, payload: outboxEvents.payload })
      .from(outboxEvents)
      .where(eq(outboxEvents.aggregateId, aggregateId))
      .orderBy(asc(outboxEvents.id))
  }

  async function statusOf(id: string): Promise<string | undefined> {
    const [row] = await handle.db
      .select({ status: milestones.status })
      .from(milestones)
      .where(eq(milestones.id, id))
    return row?.status
  }

  describe('create', () => {
    it('returns the stored row', async () => {
      const created = await repo.create({
        projectId,
        assignedTalentId: talentId,
        title: 'Backend API',
        description: 'Ship the endpoints',
        orderIndex: 2,
        amount: 4_000_000,
        dueDate: new Date('2026-10-01T00:00:00Z'),
      })

      expect(created.title).toBe('Backend API')
      expect(created.status).toBe('pending')
      expect(created.revisionCount).toBe(0)

      const [stored] = await handle.db
        .select()
        .from(milestones)
        .where(eq(milestones.id, created.id))
      expect(stored?.amount).toBe(4_000_000)
    })

    /**
     * time_logs.task_id is a NOT NULL foreign key to tasks, so without this row
     * the timer can never log against the milestone and the Gantt chart stays
     * empty. The companion insert is the reason create() opens a transaction.
     */
    it('writes the companion task the timer and the Gantt chart need', async () => {
      const created = await repo.create({
        projectId,
        assignedTalentId: talentId,
        title: 'Design system',
        description: 'Tokens and components',
        orderIndex: 1,
        amount: 2_000_000,
        dueDate: new Date('2026-11-05T00:00:00Z'),
      })

      const [task] = await handle.db.select().from(tasks).where(eq(tasks.milestoneId, created.id))

      expect(task).toBeDefined()
      expect(task?.title).toBe('Design system')
      expect(task?.description).toBe('Tokens and components')
      expect(task?.orderIndex).toBe(1)
      expect(task?.status).toBe('pending')
      expect(task?.assignedTalentId).toBe(talentId)
      expect(task?.endDate?.toISOString()).toBe('2026-11-05T00:00:00.000Z')
    })

    // An integration milestone has no single assignee; the task must not invent one.
    it('leaves the companion task unassigned for an integration milestone', async () => {
      const created = await repo.create({
        projectId,
        title: 'Integration',
        description: 'Everyone submits',
        milestoneType: 'integration',
        orderIndex: 3,
        amount: 1_000_000,
        dueDate: new Date('2026-12-01T00:00:00Z'),
      })

      const [task] = await handle.db.select().from(tasks).where(eq(tasks.milestoneId, created.id))
      expect(task?.assignedTalentId).toBeNull()
    })
  })

  describe('reads', () => {
    it('orders a project milestones by order index, not insertion order', async () => {
      const third = await seedMilestone({ orderIndex: 3, title: 'Third' })
      const first = await seedMilestone({ orderIndex: 1, title: 'First' })
      const second = await seedMilestone({ orderIndex: 2, title: 'Second' })

      const rows = await repo.findByProjectId(projectId)
      expect(rows.map((r) => r.id)).toEqual([first, second, third])
    })

    it('scopes the list to one project', async () => {
      await seedMilestone()
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

      expect(await repo.findByProjectId(otherProject)).toHaveLength(0)
    })

    it('finds one by id and answers undefined for an unknown id', async () => {
      const id = await seedMilestone()
      expect((await repo.findById(id))?.id).toBe(id)
      expect(await repo.findById(uuidv7())).toBeUndefined()
    })
  })

  /**
   * The 14-day auto-release sweep reads this. submitted_at is rewritten on
   * every submission, so a milestone that came back from revision must be
   * measured from its latest submission.
   */
  describe('findOverdueSubmitted', () => {
    const cutoff = new Date('2026-08-01T00:00:00Z')

    it('returns only submitted milestones past the cutoff', async () => {
      const overdue = await seedMilestone({
        status: 'submitted',
        submittedAt: new Date('2026-07-01T00:00:00Z'),
      })
      await seedMilestone({ status: 'submitted', submittedAt: new Date('2026-08-20T00:00:00Z') })
      await seedMilestone({ status: 'approved', submittedAt: new Date('2026-07-01T00:00:00Z') })
      await seedMilestone({ status: 'submitted', submittedAt: null })

      const rows = await repo.findOverdueSubmitted(cutoff, 10)
      expect(rows.map((r) => r.id)).toEqual([overdue])
    })

    it('returns the oldest submissions first and honours the limit', async () => {
      const oldest = await seedMilestone({
        status: 'submitted',
        submittedAt: new Date('2026-05-01T00:00:00Z'),
      })
      const middle = await seedMilestone({
        status: 'submitted',
        submittedAt: new Date('2026-06-01T00:00:00Z'),
      })
      await seedMilestone({ status: 'submitted', submittedAt: new Date('2026-07-01T00:00:00Z') })

      expect((await repo.findOverdueSubmitted(cutoff, 2)).map((r) => r.id)).toEqual([
        oldest,
        middle,
      ])
    })
  })

  describe('updateStatus', () => {
    it('moves the row while it still holds the expected status', async () => {
      const id = await seedMilestone({ status: 'in_progress' })

      const updated = await repo.updateStatus(id, 'submitted', 'in_progress')

      expect(updated?.status).toBe('submitted')
      expect(await statusOf(id)).toBe('submitted')
    })

    it('stamps submittedAt on submission and completedAt on approval', async () => {
      const id = await seedMilestone({ status: 'in_progress' })

      const submitted = await repo.updateStatus(id, 'submitted', 'in_progress')
      expect(submitted?.submittedAt).toBeInstanceOf(Date)
      expect(submitted?.completedAt).toBeNull()

      const approved = await repo.updateStatus(id, 'approved', 'submitted')
      expect(approved?.completedAt).toBeInstanceOf(Date)
    })

    it('leaves both stamps alone on a rejection', async () => {
      const id = await seedMilestone({ status: 'submitted' })

      const rejected = await repo.updateStatus(id, 'rejected', 'submitted')
      expect(rejected?.submittedAt).toBeNull()
      expect(rejected?.completedAt).toBeNull()
    })

    /**
     * The write the guard exists to stop. An owner double-clicking Approve
     * races the auto-release sweep, which aims at exactly the milestones an
     * owner is looking at; the second caller read `submitted` and must lose.
     */
    it('refuses a write whose expected status is stale', async () => {
      const id = await seedMilestone({ status: 'submitted' })
      await repo.updateStatus(id, 'approved', 'submitted')

      await expect(repo.updateStatus(id, 'rejected', 'submitted')).rejects.toThrow(AppError)
      expect(await statusOf(id)).toBe('approved')
    })

    it('reports the stale write as a conflict naming the status it found', async () => {
      const id = await seedMilestone({ status: 'submitted' })
      await repo.updateStatus(id, 'approved', 'submitted')

      await expect(repo.updateStatus(id, 'rejected', 'submitted')).rejects.toMatchObject({
        code: 'CONFLICT',
        message: 'Milestone is already approved, not submitted',
      })
    })

    /** A missing row has to read differently from a lost race, or a conflict is a 404. */
    it('returns undefined when the row does not exist', async () => {
      await expect(repo.updateStatus(uuidv7(), 'approved', 'submitted')).resolves.toBeUndefined()
    })

    it('lets exactly one of two writers that both read submitted win', async () => {
      const id = await seedMilestone({ status: 'submitted' })

      const results = await Promise.allSettled([
        repo.updateStatus(id, 'approved', 'submitted'),
        repo.updateStatus(id, 'rejected', 'submitted'),
      ])

      expect(results.filter((r) => r.status === 'fulfilled' && r.value !== undefined)).toHaveLength(
        1,
      )
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1)
      expect(['approved', 'rejected']).toContain(await statusOf(id))
    })

    it('writes no event when it loses the race', async () => {
      const id = await seedMilestone({ status: 'submitted' })
      await repo.updateStatus(id, 'approved', 'submitted')
      const before = (await outboxFor(id)).length

      await expect(repo.updateStatus(id, 'rejected', 'submitted')).rejects.toThrow(AppError)

      expect(await outboxFor(id)).toHaveLength(before)
    })

    it.each([
      ['submitted', 'in_progress', 'milestone.submitted'],
      ['approved', 'submitted', 'milestone.approved'],
      ['rejected', 'submitted', 'milestone.rejected'],
      ['revision_requested', 'submitted', 'milestone.revision_requested'],
    ] as const)('publishes %s as %s', async (status, from, subject) => {
      const id = await seedMilestone({ status: from })

      await repo.updateStatus(id, status, from)

      const events = await outboxFor(id)
      expect(events.map((e) => e.eventType)).toContain(subject)
    })

    /**
     * notifications.user_id references user, not talent_profiles, and the
     * consumer drops any event whose talentId is empty - which is how every
     * milestone notification was silently discarded.
     */
    it('carries the recipient user id, not the talent profile id', async () => {
      const id = await seedMilestone({ status: 'submitted' })

      await repo.updateStatus(id, 'approved', 'submitted')

      const [event] = await outboxFor(id)
      expect(event?.payload).toMatchObject({
        milestoneId: id,
        projectId,
        talentId: talentUserId,
        status: 'approved',
        amount: 3_000_000,
      })
      const payload = event?.payload as { talentId: string } | undefined
      expect(payload?.talentId).not.toBe(talentId)
    })

    /** An integration milestone has no single assignee, so there is nobody to name. */
    it('carries a null recipient for an integration milestone', async () => {
      const id = await seedMilestone({
        status: 'submitted',
        milestoneType: 'integration',
        assignedTalentId: null,
      })

      await repo.updateStatus(id, 'approved', 'submitted')

      const [event] = await outboxFor(id)
      const payload = event?.payload as { talentId: string | null } | undefined
      expect(payload?.talentId).toBeNull()
    })

    /**
     * The approval and its three invoice copies have to commit together. This
     * was appended in the route with the bare pool one statement after the
     * transaction had committed, so a crash in the gap left the talent paid,
     * the milestone terminally approved, no invoice for anybody, and a
     * permanent hole in the per-project invoice_number sequence.
     */
    it('requests the invoice inside the approval commit', async () => {
      const id = await seedMilestone({ status: 'submitted' })

      await repo.updateStatus(id, 'approved', 'submitted')

      const events = await outboxFor(id)
      expect(events.map((e) => e.eventType)).toEqual([
        'milestone.approved',
        'milestone.invoice_requested',
      ])
      expect(events[1]?.payload).toEqual({ milestoneId: id, projectId })
    })

    it.each(['submitted', 'rejected', 'revision_requested'] as const)(
      'requests no invoice for %s',
      async (status) => {
        const id = await seedMilestone({
          status: status === 'submitted' ? 'in_progress' : 'submitted',
        })

        await repo.updateStatus(id, status, status === 'submitted' ? 'in_progress' : 'submitted')

        const events = await outboxFor(id)
        expect(events.map((e) => e.eventType)).not.toContain('milestone.invoice_requested')
      },
    )
  })

  describe('consumePaidRevisionCredit', () => {
    async function seedCredit(
      milestoneId: string,
      over: Partial<typeof revisionRequests.$inferInsert> = {},
    ): Promise<string> {
      const id = uuidv7()
      await handle.db.insert(revisionRequests).values({
        id,
        milestoneId,
        requestedBy: ownerId,
        description: 'Adjust the header',
        severity: 'minor',
        isPaid: true,
        status: 'pending',
        ...over,
      })
      return id
    }

    it('consumes a pending paid credit and marks it in progress', async () => {
      const milestoneId = await seedMilestone()
      const creditId = await seedCredit(milestoneId)

      expect(await repo.consumePaidRevisionCredit(milestoneId)).toBe(true)

      const [row] = await handle.db
        .select({ status: revisionRequests.status })
        .from(revisionRequests)
        .where(eq(revisionRequests.id, creditId))
      expect(row?.status).toBe('in_progress')
    })

    it('answers false when the milestone has no credit at all', async () => {
      const milestoneId = await seedMilestone()
      expect(await repo.consumePaidRevisionCredit(milestoneId)).toBe(false)
    })

    // A free revision is not a credit; charging must still happen.
    it('ignores an unpaid request', async () => {
      const milestoneId = await seedMilestone()
      await seedCredit(milestoneId, { isPaid: false })

      expect(await repo.consumePaidRevisionCredit(milestoneId)).toBe(false)
    })

    // A credit already in flight must not be spent twice.
    it('ignores a credit that is no longer pending', async () => {
      const milestoneId = await seedMilestone()
      await seedCredit(milestoneId, { status: 'in_progress' })

      expect(await repo.consumePaidRevisionCredit(milestoneId)).toBe(false)
    })

    it('spends only one credit per call', async () => {
      const milestoneId = await seedMilestone()
      await seedCredit(milestoneId)
      await seedCredit(milestoneId)

      expect(await repo.consumePaidRevisionCredit(milestoneId)).toBe(true)

      const remaining = await handle.db
        .select({ id: revisionRequests.id })
        .from(revisionRequests)
        .where(
          and(
            eq(revisionRequests.milestoneId, milestoneId),
            eq(revisionRequests.status, 'pending'),
          ),
        )
      expect(remaining).toHaveLength(1)
    })

    it('does not reach across milestones for a credit', async () => {
      const mine = await seedMilestone()
      const theirs = await seedMilestone()
      await seedCredit(theirs)

      expect(await repo.consumePaidRevisionCredit(mine)).toBe(false)
    })
  })

  describe('incrementRevisionCount', () => {
    it('raises the count and moves the row to revision_requested', async () => {
      const id = await seedMilestone({ status: 'submitted', revisionCount: 1 })

      const updated = await repo.incrementRevisionCount(id)

      expect(updated?.revisionCount).toBe(2)
      expect(updated?.status).toBe('revision_requested')
      expect(await statusOf(id)).toBe('revision_requested')
    })

    it('publishes the revision with the recipient user id', async () => {
      const id = await seedMilestone({ status: 'submitted' })

      await repo.incrementRevisionCount(id)

      const [event] = await outboxFor(id)
      expect(event?.eventType).toBe('milestone.revision_requested')
      expect(event?.payload).toMatchObject({ talentId: talentUserId, status: 'revision_requested' })
    })

    /** Same recipient resolution as updateStatus: nobody to name on an integration milestone. */
    it('carries a null recipient for an integration milestone', async () => {
      const id = await seedMilestone({
        status: 'submitted',
        milestoneType: 'integration',
        assignedTalentId: null,
      })

      await repo.incrementRevisionCount(id)

      const [event] = await outboxFor(id)
      const payload = event?.payload as { talentId: string | null } | undefined
      expect(payload?.talentId).toBeNull()
    })

    it('returns undefined and publishes nothing for an unknown id', async () => {
      const missing = uuidv7()

      expect(await repo.incrementRevisionCount(missing)).toBeUndefined()
      expect(await outboxFor(missing)).toHaveLength(0)
    })
  })
})
