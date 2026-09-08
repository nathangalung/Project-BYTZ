// biome-ignore-all lint/style/noRestrictedImports: this is a test, and the
// tables are what the fixtures are made of.

import {
  getDb,
  milestones,
  outboxEvents,
  projects,
  talentProfiles,
  user,
  workPackages,
} from '@kerjacus/db'
import { connectTestDatabase, hasTestDatabase, type TestHandle } from '@kerjacus/db/testing'
import { eq, sql } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { MilestoneRepository } from '../repositories/milestone.repository'
import { MilestoneDeadlineSweepService } from './milestone-deadline-sweep'

/**
 * Late milestones, which nothing was watching.
 *
 * milestone.overdue and milestone.due_soon had a consumer, notification
 * templates and a catalog row, and no publisher. due_date was written and then
 * read only to score a talent's on-time rate after the fact.
 */

const runIf = hasTestDatabase() ? describe : describe.skip
const INTEGRATION_LOCK = sql`SELECT pg_advisory_lock(20260813)`

const NOW = new Date('2026-06-01T00:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000

runIf('milestone deadline sweep', () => {
  let handle: TestHandle
  let ownerId: string
  let talentUserId: string
  let talentId: string
  let projectId: string
  let workPackageId: string

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

  async function milestone(
    dueDate: Date,
    status: 'pending' | 'in_progress' | 'submitted' | 'approved' = 'in_progress',
    metadata: Record<string, unknown> | null = null,
  ): Promise<string> {
    const id = uuidv7()
    await handle.db.insert(milestones).values({
      id,
      projectId,
      workPackageId,
      assignedTalentId: talentId,
      title: 'Deliver',
      description: 'Some work',
      milestoneType: 'individual',
      orderIndex: 0,
      amount: 5_000_000,
      status,
      dueDate,
      metadata,
    })
    return id
  }

  function sweeper() {
    return new MilestoneDeadlineSweepService(new MilestoneRepository(getDb()))
  }

  async function subjects(): Promise<string[]> {
    const rows = await handle.db
      .select({ eventType: outboxEvents.eventType })
      .from(outboxEvents)
      .orderBy(outboxEvents.createdAt)
    return rows.map((r) => r.eventType)
  }

  beforeEach(async () => {
    await handle.truncate()

    ownerId = await makeUser('owner')
    talentUserId = await makeUser('talent')
    talentId = uuidv7()
    await handle.db
      .insert(talentProfiles)
      .values({ id: talentId, userId: talentUserId, verificationStatus: 'verified' })

    projectId = uuidv7()
    await handle.db.insert(projects).values({
      id: projectId,
      ownerId,
      title: 'Late project',
      description: 'Has deadlines',
      category: 'web_app',
      budgetMin: 1_000_000,
      budgetMax: 10_000_000,
      estimatedTimelineDays: 60,
      status: 'in_progress',
    })
    workPackageId = uuidv7()
    await handle.db.insert(workPackages).values({
      id: workPackageId,
      projectId,
      title: 'Backend API',
      description: 'Package',
      orderIndex: 0,
      requiredSkills: ['backend'],
      estimatedHours: 40,
      amount: 5_000_000,
      talentPayout: 3_575_000,
      status: 'in_progress',
    })
  })

  it('publishes overdue for a milestone past its due date', async () => {
    const id = await milestone(new Date(NOW.getTime() - DAY))

    const result = await sweeper().sweep(NOW)

    expect(result).toEqual({ overdue: 1, dueSoon: 0, failed: 0 })
    expect(await subjects()).toEqual(['milestone.overdue'])
    const [row] = await handle.db
      .select({ metadata: milestones.metadata })
      .from(milestones)
      .where(eq(milestones.id, id))
    const marked = row?.metadata as Record<string, unknown> | undefined
    expect(marked?.overdueNotifiedAt).toBe(NOW.toISOString())
  })

  it('publishes due_soon inside the seven-day horizon and nothing beyond it', async () => {
    await milestone(new Date(NOW.getTime() + 3 * DAY))
    await milestone(new Date(NOW.getTime() + 30 * DAY))

    const result = await sweeper().sweep(NOW)

    expect(result).toEqual({ overdue: 0, dueSoon: 1, failed: 0 })
    expect(await subjects()).toEqual(['milestone.due_soon'])
  })

  /**
   * The sweep runs hourly. Without a marker on the row it would tell the talent
   * they are late every hour for the rest of the project, and the notification
   * service's idempotency store degrades to a no-op when Valkey is unreachable,
   * so it cannot be the guard.
   */
  it('warns once, however often it runs', async () => {
    await milestone(new Date(NOW.getTime() - DAY))

    await sweeper().sweep(NOW)
    const second = await sweeper().sweep(new Date(NOW.getTime() + 60 * 60 * 1000))

    expect(second).toEqual({ overdue: 0, dueSoon: 0, failed: 0 })
    expect(await subjects()).toEqual(['milestone.overdue'])
  })

  it('leaves the deliverable checklist intact when it marks the row', async () => {
    const id = await milestone(new Date(NOW.getTime() - DAY), 'in_progress', {
      deliverables: [{ title: 'API docs', type: 'document', status: 'pending' }],
    })

    await sweeper().sweep(NOW)

    const [row] = await handle.db
      .select({ metadata: milestones.metadata })
      .from(milestones)
      .where(eq(milestones.id, id))
    const metadata = row?.metadata as Record<string, unknown> | undefined
    expect(metadata?.deliverables).toHaveLength(1)
    expect(metadata?.overdueNotifiedAt).toBe(NOW.toISOString())
  })

  /** Submitted is the owner's turn and approved is finished; neither is late. */
  it('ignores milestones that have already been delivered', async () => {
    await milestone(new Date(NOW.getTime() - DAY), 'submitted')
    await milestone(new Date(NOW.getTime() - DAY), 'approved')

    const result = await sweeper().sweep(NOW)

    expect(result).toEqual({ overdue: 0, dueSoon: 0, failed: 0 })
    expect(await subjects()).toEqual([])
  })

  it('warns about a milestone twice over its life, once per window', async () => {
    await milestone(new Date(NOW.getTime() + 3 * DAY))

    await sweeper().sweep(NOW)
    await sweeper().sweep(new Date(NOW.getTime() + 5 * DAY))

    expect(await subjects()).toEqual(['milestone.due_soon', 'milestone.overdue'])
  })
})
