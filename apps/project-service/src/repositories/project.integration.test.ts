import {
  milestones,
  outboxEvents,
  projectAssignments,
  projectStatusLogs,
  projects,
  talentProfiles,
  taskDependencies,
  tasks,
  user,
  workPackages,
} from '@kerjacus/db'
import { connectTestDatabase, hasTestDatabase, type TestHandle } from '@kerjacus/db/testing'
import { asc, eq, sql } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ProjectRepository } from './project.repository'

/**
 * ProjectRepository against Postgres.
 *
 * Two properties here were pinned by reading the source and are the reason
 * this file exists: that list() returns a named column set rather than
 * whatever `projects` happens to hold today, and that a completed project
 * publishes the dedicated project.completed subject the notification service
 * listens for. Both are now checked against rows the database returned.
 */

const runIf = hasTestDatabase() ? describe : describe.skip

/** See milestone.integration.test.ts: serialises the integration files. */
const INTEGRATION_LOCK = sql`SELECT pg_advisory_lock(20260813)`

/**
 * The exact shape GET /projects ships. Any signed-in user may call that route,
 * and applyProjectVisibility strips the owner-only columns per viewer - but
 * only the ones someone thought to name. `projects` gains columns over time,
 * so a bare select would ship each new one to every signed-in user until
 * somebody noticed. Asserting the key set makes exposing a new column a
 * decision: adding one to the table without adding it here leaves this passing,
 * and adding it here fails this test until it is deliberate.
 */
const EXPECTED_LIST_COLUMNS = [
  'budgetMax',
  'budgetMin',
  'category',
  'companyName',
  'companyRole',
  'completenessScore',
  'createdAt',
  'description',
  'documentFileUrl',
  'documentType',
  'estimatedTimelineDays',
  'finalPrice',
  'id',
  'ownerId',
  'platformFee',
  'preferences',
  'progress',
  'projectType',
  'status',
  'talentPayout',
  'teamSize',
  'title',
  'updatedAt',
  'visibility',
]

runIf('ProjectRepository', () => {
  let handle: TestHandle
  let repo: ProjectRepository
  let ownerId: string

  beforeAll(async () => {
    handle = await connectTestDatabase()
    await handle.db.execute(INTEGRATION_LOCK)
  }, 120_000)

  afterAll(async () => {
    await handle.close()
  })

  beforeEach(async () => {
    await handle.truncate()
    repo = new ProjectRepository(handle.db)

    ownerId = uuidv7()
    await handle.db.insert(user).values({
      id: ownerId,
      email: `owner-${ownerId}@example.test`,
      name: 'Owner',
      emailVerified: false,
    })
  })

  async function seedProject(over: Partial<typeof projects.$inferInsert> = {}): Promise<string> {
    const id = uuidv7()
    await handle.db.insert(projects).values({
      id,
      ownerId,
      title: 'Seeded project',
      description: 'Seeded',
      category: 'web_app',
      budgetMin: 1_000_000,
      budgetMax: 5_000_000,
      estimatedTimelineDays: 30,
      ...over,
    })
    return id
  }

  async function newUser(role = 'talent'): Promise<string> {
    const id = uuidv7()
    await handle.db.insert(user).values({
      id,
      email: `u-${id}@example.test`,
      name: 'Someone',
      emailVerified: false,
      role,
    })
    return id
  }

  describe('create', () => {
    it('returns the stored row with its defaults applied', async () => {
      const created = await repo.create({
        ownerId,
        title: 'New build',
        description: 'From the wizard',
        category: 'mobile_app',
        budgetMin: 2_000_000,
        budgetMax: 4_000_000,
        estimatedTimelineDays: 21,
      })

      expect(created.status).toBe('draft')
      expect(created.teamSize).toBe(1)
      expect(created.visibility).toBe('public_summary')
      expect(created.progress).toBe(0)

      const stored = await handle.db.select().from(projects).where(eq(projects.id, created.id))
      expect(stored).toHaveLength(1)
    })
  })

  describe('findById', () => {
    it('returns the project', async () => {
      const id = await seedProject()
      expect((await repo.findById(id))?.id).toBe(id)
    })

    it('answers undefined for an unknown id', async () => {
      expect(await repo.findById(uuidv7())).toBeUndefined()
    })

    /** Soft delete is a delete as far as every read path is concerned. */
    it('hides a soft-deleted project', async () => {
      const id = await seedProject({ deletedAt: new Date() })
      expect(await repo.findById(id)).toBeUndefined()
    })
  })

  describe('findByOwnerId', () => {
    it('returns the owner projects newest first with a total', async () => {
      const older = await seedProject({ createdAt: new Date('2026-01-01T00:00:00Z') })
      const newer = await seedProject({ createdAt: new Date('2026-05-01T00:00:00Z') })

      const { items, total } = await repo.findByOwnerId(ownerId, { page: 1, pageSize: 10 })

      expect(items.map((p) => p.id)).toEqual([newer, older])
      expect(total).toBe(2)
    })

    it('pages without changing the total', async () => {
      await seedProject()
      await seedProject()
      await seedProject()

      const { items, total } = await repo.findByOwnerId(ownerId, { page: 2, pageSize: 2 })

      expect(items).toHaveLength(1)
      expect(total).toBe(3)
    })

    it('excludes soft-deleted projects from both the page and the total', async () => {
      await seedProject()
      await seedProject({ deletedAt: new Date() })

      const { items, total } = await repo.findByOwnerId(ownerId, { page: 1, pageSize: 10 })

      expect(items).toHaveLength(1)
      expect(total).toBe(1)
    })

    it('does not return another owner projects', async () => {
      await seedProject()
      const stranger = await newUser('owner')

      expect(await repo.findByOwnerId(stranger, { page: 1, pageSize: 10 })).toEqual({
        items: [],
        total: 0,
      })
    })

    it('ships exactly the named column set', async () => {
      await seedProject()

      const { items } = await repo.findByOwnerId(ownerId, { page: 1, pageSize: 10 })

      expect(Object.keys(items[0] ?? {}).sort()).toEqual(EXPECTED_LIST_COLUMNS)
    })
  })

  describe('list', () => {
    it('ships exactly the named column set, never the soft-delete marker', async () => {
      await seedProject()

      const { items } = await repo.list({}, { page: 1, pageSize: 10 })

      expect(Object.keys(items[0] ?? {}).sort()).toEqual(EXPECTED_LIST_COLUMNS)
      expect(items[0]).not.toHaveProperty('deletedAt')
    })

    /**
     * The owner branch of applyProjectVisibility returns the row as stored and
     * the owner dashboard calls this route filtered to its own projects, so
     * the money columns have to be selected here for the gate to hand back.
     */
    it('still selects what the owner is entitled to see', async () => {
      await seedProject({ finalPrice: 10_000_000, talentPayout: 7_150_000, platformFee: 2_850_000 })

      const { items } = await repo.list({}, { page: 1, pageSize: 10 })

      expect(items[0]).toMatchObject({
        finalPrice: 10_000_000,
        talentPayout: 7_150_000,
        platformFee: 2_850_000,
      })
    })

    it('filters by status', async () => {
      const matching = await seedProject({ status: 'matching' })
      await seedProject({ status: 'draft' })

      const { items, total } = await repo.list({ status: 'matching' }, { page: 1, pageSize: 10 })

      expect(items.map((p) => p.id)).toEqual([matching])
      expect(total).toBe(1)
    })

    it('filters by category', async () => {
      const mobile = await seedProject({ category: 'mobile_app' })
      await seedProject({ category: 'web_app' })

      const { items } = await repo.list({ category: 'mobile_app' }, { page: 1, pageSize: 10 })

      expect(items.map((p) => p.id)).toEqual([mobile])
    })

    it('filters by owner', async () => {
      const mine = await seedProject()
      const stranger = await newUser('owner')
      const theirs = uuidv7()
      await handle.db.insert(projects).values({
        id: theirs,
        ownerId: stranger,
        title: 'Theirs',
        description: 'Theirs',
        category: 'web_app',
        budgetMin: 1,
        budgetMax: 2,
        estimatedTimelineDays: 1,
      })

      const { items } = await repo.list({ ownerId }, { page: 1, pageSize: 10 })

      expect(items.map((p) => p.id)).toEqual([mine])
    })

    it('excludes soft-deleted projects', async () => {
      await seedProject({ deletedAt: new Date() })

      expect(await repo.list({}, { page: 1, pageSize: 10 })).toEqual({ items: [], total: 0 })
    })

    it('skips the visibility gate entirely when no viewer is given', async () => {
      await seedProject({ visibility: 'private' })

      const { total } = await repo.list({}, { page: 1, pageSize: 10 })

      expect(total).toBe(1)
    })

    /**
     * Filtered in SQL rather than after the fetch, which is what keeps `total`
     * honest - a gate applied in JavaScript pages the viewer into blank pages.
     */
    describe('visibility gate', () => {
      it('hides a private project from a stranger, in the page and the total', async () => {
        await seedProject({ visibility: 'private' })
        await seedProject({ visibility: 'public_summary' })
        const stranger = await newUser()

        const { items, total } = await repo.list({ viewerId: stranger }, { page: 1, pageSize: 10 })

        expect(items).toHaveLength(1)
        expect(total).toBe(1)
      })

      it('shows the owner their own private project', async () => {
        const priv = await seedProject({ visibility: 'private' })

        const { items } = await repo.list({ viewerId: ownerId }, { page: 1, pageSize: 10 })

        expect(items.map((p) => p.id)).toEqual([priv])
      })

      /** An assigned talent is a participant, so their private project stays listed. */
      it('shows an assigned talent the private project they work on', async () => {
        const priv = await seedProject({ visibility: 'private' })
        const talentUserId = await newUser()
        const talentId = uuidv7()
        await handle.db.insert(talentProfiles).values({ id: talentId, userId: talentUserId })
        const workPackageId = uuidv7()
        await handle.db.insert(workPackages).values({
          id: workPackageId,
          projectId: priv,
          title: 'Backend',
          description: 'API',
          orderIndex: 0,
          requiredSkills: ['backend'],
          estimatedHours: 10,
          amount: 1_000_000,
          talentPayout: 800_000,
        })
        await handle.db.insert(projectAssignments).values({
          id: uuidv7(),
          projectId: priv,
          talentId,
          workPackageId,
          status: 'active',
        })

        const { items } = await repo.list({ viewerId: talentUserId }, { page: 1, pageSize: 10 })

        expect(items.map((p) => p.id)).toEqual([priv])
      })

      it('does not show an unrelated talent someone else private project', async () => {
        await seedProject({ visibility: 'private' })
        const otherUserId = await newUser()
        await handle.db.insert(talentProfiles).values({ id: uuidv7(), userId: otherUserId })

        const { items } = await repo.list({ viewerId: otherUserId }, { page: 1, pageSize: 10 })

        expect(items).toEqual([])
      })
    })
  })

  describe('updateStatus', () => {
    it('moves the project and returns the new row', async () => {
      const id = await seedProject({ status: 'draft' })

      const updated = await repo.updateStatus(id, 'scoping', ownerId)

      expect(updated?.status).toBe('scoping')
      expect((await repo.findById(id))?.status).toBe('scoping')
    })

    it('records the transition it came from', async () => {
      const id = await seedProject({ status: 'brd_approved' })

      await repo.updateStatus(id, 'prd_generated', ownerId, 'PRD generated by AI')

      const [log] = await handle.db
        .select()
        .from(projectStatusLogs)
        .where(eq(projectStatusLogs.projectId, id))
      expect(log).toMatchObject({
        fromStatus: 'brd_approved',
        toStatus: 'prd_generated',
        changedBy: ownerId,
        reason: 'PRD generated by AI',
      })
    })

    it('stores a null reason when none is given', async () => {
      const id = await seedProject()

      await repo.updateStatus(id, 'scoping', ownerId)

      const [log] = await handle.db
        .select()
        .from(projectStatusLogs)
        .where(eq(projectStatusLogs.projectId, id))
      expect(log?.reason).toBeNull()
    })

    it('publishes the transition', async () => {
      const id = await seedProject({ status: 'draft' })

      await repo.updateStatus(id, 'scoping', ownerId, 'Owner started scoping')

      const events = await handle.db
        .select({ eventType: outboxEvents.eventType, payload: outboxEvents.payload })
        .from(outboxEvents)
        .where(eq(outboxEvents.aggregateId, id))
        .orderBy(asc(outboxEvents.id))
      expect(events.map((e) => e.eventType)).toEqual(['project.status.changed'])
      expect(events[0]?.payload).toMatchObject({
        projectId: id,
        fromStatus: 'draft',
        toStatus: 'scoping',
        changedBy: ownerId,
        reason: 'Owner started scoping',
      })
    })

    /**
     * handleProjectCompleted in the notification service reads payload.ownerId
     * from this dedicated subject. Only project.status.changed was ever
     * appended, so the completion notification and its email handler were dead.
     */
    it('publishes the dedicated completion subject naming the owner', async () => {
      const id = await seedProject({ status: 'review' })

      await repo.updateStatus(id, 'completed', ownerId)

      const events = await handle.db
        .select({ eventType: outboxEvents.eventType, payload: outboxEvents.payload })
        .from(outboxEvents)
        .where(eq(outboxEvents.aggregateId, id))
        .orderBy(asc(outboxEvents.id))
      expect(events.map((e) => e.eventType)).toEqual([
        'project.status.changed',
        'project.completed',
      ])
      expect(events[1]?.payload).toEqual({ projectId: id, ownerId })
    })

    it('publishes no completion subject for any other transition', async () => {
      const id = await seedProject({ status: 'in_progress' })

      await repo.updateStatus(id, 'review', ownerId)

      const events = await handle.db
        .select({ eventType: outboxEvents.eventType })
        .from(outboxEvents)
        .where(eq(outboxEvents.aggregateId, id))
      expect(events.map((e) => e.eventType)).not.toContain('project.completed')
    })

    it('returns undefined and writes nothing for an unknown project', async () => {
      const missing = uuidv7()

      expect(await repo.updateStatus(missing, 'scoping', ownerId)).toBeUndefined()
      expect(await handle.db.select().from(projectStatusLogs)).toHaveLength(0)
      expect(await handle.db.select().from(outboxEvents)).toHaveLength(0)
    })

    it('refuses to move a soft-deleted project', async () => {
      const id = await seedProject({ deletedAt: new Date() })

      expect(await repo.updateStatus(id, 'scoping', ownerId)).toBeUndefined()
    })
  })

  describe('update', () => {
    it('writes only the fields it was given', async () => {
      const id = await seedProject({ title: 'Before', description: 'Untouched' })

      const updated = await repo.update(id, { title: 'After' })

      expect(updated?.title).toBe('After')
      expect(updated?.description).toBe('Untouched')
    })

    it('writes the priced columns together', async () => {
      const id = await seedProject()

      const updated = await repo.update(id, {
        finalPrice: 20_000_000,
        talentPayout: 12_300_000,
        platformFee: 7_700_000,
        teamSize: 3,
      })

      expect(updated).toMatchObject({
        finalPrice: 20_000_000,
        talentPayout: 12_300_000,
        platformFee: 7_700_000,
        teamSize: 3,
      })
    })

    it('answers undefined for an unknown or soft-deleted project', async () => {
      const deleted = await seedProject({ deletedAt: new Date() })

      expect(await repo.update(uuidv7(), { title: 'x' })).toBeUndefined()
      expect(await repo.update(deleted, { title: 'x' })).toBeUndefined()
    })

    /**
     * The transaction parameter exists so the project price and the package
     * payouts are one operation. Passing the pool instead compiles and
     * silently degrades the pair to two autocommits, so the rollback is the
     * property worth proving.
     */
    it('joins the caller transaction and rolls back with it', async () => {
      const id = await seedProject({ title: 'Before' })

      await expect(
        handle.db.transaction(async (tx) => {
          await repo.update(id, { title: 'Written inside the transaction' }, tx)
          throw new Error('work package write failed')
        }),
      ).rejects.toThrow('work package write failed')

      expect((await repo.findById(id))?.title).toBe('Before')
    })

    it('commits when the caller transaction commits', async () => {
      const id = await seedProject({ title: 'Before' })

      await handle.db.transaction(async (tx) => {
        await repo.update(id, { title: 'Committed' }, tx)
      })

      expect((await repo.findById(id))?.title).toBe('Committed')
    })
  })

  describe('getStatusLogs', () => {
    it('returns the audit trail newest first', async () => {
      const id = await seedProject({ status: 'draft' })
      await repo.updateStatus(id, 'scoping', ownerId)
      await repo.updateStatus(id, 'brd_generated', ownerId)

      const logs = await repo.getStatusLogs(id)

      expect(logs.map((l) => l.toStatus)).toEqual(['brd_generated', 'scoping'])
    })

    it('returns nothing for a project that never moved', async () => {
      expect(await repo.getStatusLogs(await seedProject())).toEqual([])
    })
  })

  describe('getProjectTasksWithDependencies', () => {
    async function seedTask(milestoneId: string, orderIndex: number): Promise<string> {
      const id = uuidv7()
      await handle.db.insert(tasks).values({
        id,
        milestoneId,
        title: `Task ${orderIndex}`,
        orderIndex,
      })
      return id
    }

    async function seedMilestone(projectId: string): Promise<string> {
      const id = uuidv7()
      await handle.db.insert(milestones).values({
        id,
        projectId,
        title: 'Milestone',
        description: 'For the chart',
        orderIndex: 0,
        amount: 1_000_000,
        dueDate: new Date('2026-09-01T00:00:00Z'),
      })
      return id
    }

    /** No tasks means no dependency query at all, not an empty IN list. */
    it('returns two empty lists for a project with no tasks', async () => {
      const id = await seedProject()

      expect(await repo.getProjectTasksWithDependencies(id)).toEqual({
        tasks: [],
        dependencies: [],
      })
    })

    it('returns the project tasks ordered for the chart', async () => {
      const id = await seedProject()
      const milestoneId = await seedMilestone(id)
      const second = await seedTask(milestoneId, 2)
      const first = await seedTask(milestoneId, 1)

      const { tasks: rows } = await repo.getProjectTasksWithDependencies(id)

      expect(rows.map((t) => t.id)).toEqual([first, second])
    })

    it('returns the edges between those tasks', async () => {
      const id = await seedProject()
      const milestoneId = await seedMilestone(id)
      const backend = await seedTask(milestoneId, 1)
      const frontend = await seedTask(milestoneId, 2)
      await handle.db.insert(taskDependencies).values({
        id: uuidv7(),
        taskId: frontend,
        dependsOnTaskId: backend,
        type: 'finish_to_start',
      })

      const { dependencies } = await repo.getProjectTasksWithDependencies(id)

      expect(dependencies).toHaveLength(1)
      expect(dependencies[0]).toMatchObject({
        taskId: frontend,
        dependsOnTaskId: backend,
        type: 'finish_to_start',
      })
    })

    it('does not return another project tasks', async () => {
      const mine = await seedProject()
      const theirs = await seedProject()
      await seedTask(await seedMilestone(theirs), 1)

      expect((await repo.getProjectTasksWithDependencies(mine)).tasks).toEqual([])
    })
  })
})
