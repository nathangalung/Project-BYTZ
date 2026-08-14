import { milestones, projects, talentProfiles, tasks, user } from '@kerjacus/db'
import { connectTestDatabase, hasTestDatabase, type TestHandle } from '@kerjacus/db/testing'
import { sql } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { TimeLogRepository } from './time-log.repository'

/**
 * TimeLogRepository against Postgres.
 *
 * Every read here is a join across time_logs, tasks and milestones, and the
 * project summary adds two outer joins and a grouping. A join is exactly the
 * kind of thing a source-text assertion cannot check: the query either brings
 * back the right rows for the right project or it does not.
 */

const runIf = hasTestDatabase() ? describe : describe.skip

/** See milestone.integration.test.ts: serialises the integration files. */
const INTEGRATION_LOCK = sql`SELECT pg_advisory_lock(20260813)`

runIf('TimeLogRepository', () => {
  let handle: TestHandle
  let repo: TimeLogRepository
  let ownerId: string
  let talentId: string
  let projectId: string
  let milestoneId: string
  let taskId: string

  beforeAll(async () => {
    handle = await connectTestDatabase()
    await handle.db.execute(INTEGRATION_LOCK)
  }, 120_000)

  afterAll(async () => {
    await handle.close()
  })

  beforeEach(async () => {
    await handle.truncate()
    repo = new TimeLogRepository(handle.db)

    ownerId = uuidv7()
    await handle.db.insert(user).values({
      id: ownerId,
      email: `owner-${ownerId}@example.test`,
      name: 'Owner',
      emailVerified: false,
    })

    const talentUserId = uuidv7()
    await handle.db.insert(user).values({
      id: talentUserId,
      email: `talent-${talentUserId}@example.test`,
      name: 'Sari',
      emailVerified: false,
      role: 'talent',
    })
    talentId = uuidv7()
    await handle.db.insert(talentProfiles).values({ id: talentId, userId: talentUserId })

    projectId = uuidv7()
    await handle.db.insert(projects).values({
      id: projectId,
      ownerId,
      title: 'Tracked project',
      description: 'Exercises the time log repository',
      category: 'web_app',
      budgetMin: 1_000_000,
      budgetMax: 5_000_000,
      estimatedTimelineDays: 30,
    })

    milestoneId = await seedMilestone(projectId, 'Sprint one')
    taskId = await seedTask(milestoneId, 'Build the API')
  })

  async function seedMilestone(project: string, title: string): Promise<string> {
    const id = uuidv7()
    await handle.db.insert(milestones).values({
      id,
      projectId: project,
      title,
      description: 'Work',
      orderIndex: 0,
      amount: 1_000_000,
      dueDate: new Date('2026-09-01T00:00:00Z'),
    })
    return id
  }

  async function seedTask(milestone: string, title: string): Promise<string> {
    const id = uuidv7()
    await handle.db.insert(tasks).values({ id, milestoneId: milestone, title, orderIndex: 0 })
    return id
  }

  async function seedTalent(name: string): Promise<string> {
    const uid = uuidv7()
    await handle.db.insert(user).values({
      id: uid,
      email: `t-${uid}@example.test`,
      name,
      emailVerified: false,
      role: 'talent',
    })
    const id = uuidv7()
    await handle.db.insert(talentProfiles).values({ id, userId: uid })
    return id
  }

  describe('create', () => {
    it('opens a running timer with no end and no duration', async () => {
      const log = await repo.create({
        taskId,
        talentId,
        startedAt: new Date('2026-08-01T09:00:00Z'),
      })

      expect(log.endedAt).toBeNull()
      expect(log.durationMinutes).toBeNull()
      expect(log.description).toBeNull()
      expect((await repo.findById(log.id))?.taskId).toBe(taskId)
    })

    it('stores a completed manual entry as given', async () => {
      const log = await repo.create({
        taskId,
        talentId,
        startedAt: new Date('2026-08-01T09:00:00Z'),
        endedAt: new Date('2026-08-01T11:30:00Z'),
        durationMinutes: 150,
        description: 'Endpoint dan test',
      })

      expect(log.durationMinutes).toBe(150)
      expect(log.description).toBe('Endpoint dan test')
    })

    /**
     * time_logs_one_running_per_task. POST /time-logs had no dedupe, so two
     * clicks left two open rows and the hours were counted twice.
     */
    it('lets the database refuse a second running timer on the same task', async () => {
      await repo.create({ taskId, talentId, startedAt: new Date('2026-08-01T09:00:00Z') })

      await expect(
        repo.create({ taskId, talentId, startedAt: new Date('2026-08-01T10:00:00Z') }),
      ).rejects.toMatchObject({
        cause: { code: '23505', constraint_name: 'time_logs_one_running_per_task' },
      })
    })

    /** Finished logs are legitimately many, which is why that index is partial. */
    it('allows a new timer once the previous one stopped', async () => {
      const first = await repo.create({
        taskId,
        talentId,
        startedAt: new Date('2026-08-01T09:00:00Z'),
      })
      await repo.stopTimer(first.id, new Date('2026-08-01T10:00:00Z'), 60)

      const second = await repo.create({
        taskId,
        talentId,
        startedAt: new Date('2026-08-01T11:00:00Z'),
      })

      expect(second.id).not.toBe(first.id)
    })

    // The interval constraint is the backstop for anything not arriving over HTTP.
    it('refuses an entry that ended before it started', async () => {
      await expect(
        repo.create({
          taskId,
          talentId,
          startedAt: new Date('2026-08-01T11:00:00Z'),
          endedAt: new Date('2026-08-01T09:00:00Z'),
        }),
      ).rejects.toMatchObject({ cause: { constraint_name: 'time_logs_interval_ordered' } })
    })
  })

  describe('stopTimer', () => {
    it('closes the entry with its end and duration', async () => {
      const log = await repo.create({
        taskId,
        talentId,
        startedAt: new Date('2026-08-01T09:00:00Z'),
      })

      const stopped = await repo.stopTimer(log.id, new Date('2026-08-01T10:45:00Z'), 105)

      expect(stopped?.durationMinutes).toBe(105)
      expect(stopped?.endedAt?.toISOString()).toBe('2026-08-01T10:45:00.000Z')
      expect((await repo.findById(log.id))?.durationMinutes).toBe(105)
    })

    it('answers undefined for an unknown entry', async () => {
      expect(await repo.stopTimer(uuidv7(), new Date(), 10)).toBeUndefined()
    })
  })

  describe('findById', () => {
    it('answers undefined for an unknown entry', async () => {
      expect(await repo.findById(uuidv7())).toBeUndefined()
    })
  })

  describe('findByTaskId', () => {
    it('returns the task entries newest first', async () => {
      const older = await repo.create({
        taskId,
        talentId,
        startedAt: new Date('2026-08-01T09:00:00Z'),
        endedAt: new Date('2026-08-01T10:00:00Z'),
        durationMinutes: 60,
      })
      const newer = await repo.create({
        taskId,
        talentId,
        startedAt: new Date('2026-08-02T09:00:00Z'),
      })

      expect((await repo.findByTaskId(taskId)).map((l) => l.id)).toEqual([newer.id, older.id])
    })

    it('returns nothing for a task with no entries', async () => {
      expect(await repo.findByTaskId(await seedTask(milestoneId, 'Untouched'))).toEqual([])
    })
  })

  describe('findByTalentId', () => {
    it('returns only that talent entries, newest first', async () => {
      const other = await seedTalent('Dewi')
      const mine = await repo.create({
        taskId,
        talentId,
        startedAt: new Date('2026-08-01T09:00:00Z'),
      })
      await repo.create({ taskId, talentId: other, startedAt: new Date('2026-08-03T09:00:00Z') })

      expect((await repo.findByTalentId(talentId)).map((l) => l.id)).toEqual([mine.id])
    })
  })

  describe('findByProjectId', () => {
    it('joins the task title onto every entry', async () => {
      await repo.create({
        taskId,
        talentId,
        startedAt: new Date('2026-08-01T09:00:00Z'),
        endedAt: new Date('2026-08-01T10:00:00Z'),
        durationMinutes: 60,
        description: 'Skema database',
      })

      const rows = await repo.findByProjectId(projectId)

      expect(rows).toHaveLength(1)
      expect(rows[0]?.taskTitle).toBe('Build the API')
      expect(rows[0]?.description).toBe('Skema database')
    })

    it('returns entries from every milestone of the project, newest first', async () => {
      const second = await seedTask(await seedMilestone(projectId, 'Sprint two'), 'Ship the UI')
      const older = await repo.create({
        taskId,
        talentId,
        startedAt: new Date('2026-08-01T09:00:00Z'),
      })
      const newer = await repo.create({
        taskId: second,
        talentId,
        startedAt: new Date('2026-08-05T09:00:00Z'),
      })

      expect((await repo.findByProjectId(projectId)).map((l) => l.id)).toEqual([newer.id, older.id])
    })

    /** The join is the access boundary: another project's hours must not appear. */
    it('does not return another project entries', async () => {
      const otherProject = uuidv7()
      await handle.db.insert(projects).values({
        id: otherProject,
        ownerId,
        title: 'Other',
        description: 'Other',
        category: 'data_ai',
        budgetMin: 1,
        budgetMax: 2,
        estimatedTimelineDays: 1,
      })
      const otherTask = await seedTask(await seedMilestone(otherProject, 'Theirs'), 'Theirs')
      await repo.create({ taskId: otherTask, talentId, startedAt: new Date() })

      expect(await repo.findByProjectId(projectId)).toEqual([])
    })
  })

  describe('getProjectSummary', () => {
    it('totals the minutes and the entries per talent per milestone', async () => {
      await repo.create({
        taskId,
        talentId,
        startedAt: new Date('2026-08-01T09:00:00Z'),
        endedAt: new Date('2026-08-01T10:00:00Z'),
        durationMinutes: 60,
      })
      await repo.create({
        taskId,
        talentId,
        startedAt: new Date('2026-08-02T09:00:00Z'),
        endedAt: new Date('2026-08-02T10:30:00Z'),
        durationMinutes: 90,
      })

      const rows = await repo.getProjectSummary(projectId)

      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        talentId,
        talentName: 'Sari',
        milestoneId,
        milestoneTitle: 'Sprint one',
        totalMinutes: 150,
        entryCount: 2,
      })
    })

    it('reports the busiest row first', async () => {
      const other = await seedTalent('Dewi')
      await repo.create({
        taskId,
        talentId,
        startedAt: new Date('2026-08-01T09:00:00Z'),
        endedAt: new Date('2026-08-01T09:30:00Z'),
        durationMinutes: 30,
      })
      await repo.create({
        taskId,
        talentId: other,
        startedAt: new Date('2026-08-01T09:00:00Z'),
        endedAt: new Date('2026-08-01T13:00:00Z'),
        durationMinutes: 240,
      })

      expect((await repo.getProjectSummary(projectId)).map((r) => r.talentId)).toEqual([
        other,
        talentId,
      ])
    })

    it('splits the rows per milestone', async () => {
      const secondMilestone = await seedMilestone(projectId, 'Sprint two')
      const secondTask = await seedTask(secondMilestone, 'Ship the UI')
      await repo.create({
        taskId,
        talentId,
        startedAt: new Date('2026-08-01T09:00:00Z'),
        endedAt: new Date('2026-08-01T10:00:00Z'),
        durationMinutes: 60,
      })
      await repo.create({
        taskId: secondTask,
        talentId,
        startedAt: new Date('2026-08-02T09:00:00Z'),
        endedAt: new Date('2026-08-02T10:00:00Z'),
        durationMinutes: 60,
      })

      const rows = await repo.getProjectSummary(projectId)

      expect(rows).toHaveLength(2)
      expect(new Set(rows.map((r) => r.milestoneId))).toEqual(
        new Set([milestoneId, secondMilestone]),
      )
    })

    /** A still-running timer contributes an entry but no minutes yet. */
    it('counts a running timer as zero minutes rather than dropping it', async () => {
      await repo.create({ taskId, talentId, startedAt: new Date('2026-08-01T09:00:00Z') })

      const rows = await repo.getProjectSummary(projectId)

      expect(rows[0]).toMatchObject({ totalMinutes: 0, entryCount: 1 })
    })

    /**
     * The two outer joins onto talent_profiles and user cannot currently
     * produce a null name: time_logs.talent_id is a foreign key to
     * talent_profiles and talent_profiles.user_id one to user, so neither row
     * can be removed while an entry references it. There is no fixture that
     * reaches the null branch, so there is no test for it here.
     */
    it('returns nothing for a project with no logged time', async () => {
      expect(await repo.getProjectSummary(projectId)).toEqual([])
    })
  })
})
