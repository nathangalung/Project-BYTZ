// biome-ignore-all lint/style/noRestrictedImports: this is a test, and the
// tables are what the fixtures are made of.

import { getDb, outboxEvents, projectStatusLogs, projects, user } from '@kerjacus/db'
import { connectTestDatabase, hasTestDatabase, type TestHandle } from '@kerjacus/db/testing'
import { eq, sql } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ProjectRepository } from '../repositories/project.repository'
import { ProjectDecisionSweepService } from './project-decision-sweep'

/**
 * An approved PRD nobody acted on.
 *
 * This is the owner-late-payment case before escrow exists. The start sweep
 * only sees projects past matched, and a project only reaches matched after
 * escrow settles, so this one falls through every other watch there is.
 */

const runIf = hasTestDatabase() ? describe : describe.skip
const INTEGRATION_LOCK = sql`SELECT pg_advisory_lock(20260813)`

const NOW = new Date('2026-06-01T00:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000

runIf('project decision sweep', () => {
  let handle: TestHandle
  let ownerId: string

  beforeAll(async () => {
    handle = await connectTestDatabase()
    await handle.db.execute(INTEGRATION_LOCK)
    getDb(process.env.TEST_DATABASE_URL)
  }, 120_000)

  afterAll(async () => {
    await handle.close()
  })

  async function project(
    status: 'prd_approved' | 'matching' | 'prd_purchased' | 'cancelled',
    approvedAt: Date | null,
  ): Promise<string> {
    const id = uuidv7()
    await handle.db.insert(projects).values({
      id,
      ownerId,
      title: 'Approved and idle',
      description: 'PRD approved, owner never chose what to do next',
      category: 'web_app',
      budgetMin: 1_000_000,
      budgetMax: 10_000_000,
      estimatedTimelineDays: 60,
      status,
    })
    if (approvedAt) {
      await handle.db.insert(projectStatusLogs).values({
        id: uuidv7(),
        projectId: id,
        fromStatus: 'prd_generated',
        toStatus: 'prd_approved',
        changedBy: ownerId,
        createdAt: approvedAt,
      })
    }
    return id
  }

  function sweeper() {
    return new ProjectDecisionSweepService(new ProjectRepository(getDb()))
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
    ownerId = uuidv7()
    await handle.db.insert(user).values({
      id: ownerId,
      email: `${ownerId}@example.test`,
      name: 'Owner',
      emailVerified: false,
    })
  })

  it('reminds about a PRD approved past the deadline', async () => {
    const id = await project('prd_approved', new Date(NOW.getTime() - 15 * DAY))

    const result = await sweeper().sweep(NOW)

    expect(result).toEqual({ reminded: 1, failed: 0 })
    expect(await subjects()).toEqual(['project.decision_overdue'])
    const [row] = await handle.db
      .select({ decisionReminderAt: projects.decisionReminderAt })
      .from(projects)
      .where(eq(projects.id, id))
    expect(row?.decisionReminderAt?.toISOString()).toBe(NOW.toISOString())
  })

  it('leaves a project still inside the window alone', async () => {
    await project('prd_approved', new Date(NOW.getTime() - 5 * DAY))

    const result = await sweeper().sweep(NOW)

    expect(result).toEqual({ reminded: 0, failed: 0 })
    expect(await subjects()).toEqual([])
  })

  /** Both exits from prd_approved are decisions already made. */
  it('ignores a project the owner already decided about', async () => {
    await project('matching', new Date(NOW.getTime() - 60 * DAY))
    await project('prd_purchased', new Date(NOW.getTime() - 60 * DAY))
    await project('cancelled', new Date(NOW.getTime() - 60 * DAY))

    const result = await sweeper().sweep(NOW)

    expect(result).toEqual({ reminded: 0, failed: 0 })
  })

  /** Hourly, so without the marker the owner hears this every hour. */
  it('reminds once, however often it runs', async () => {
    await project('prd_approved', new Date(NOW.getTime() - 15 * DAY))

    await sweeper().sweep(NOW)
    const second = await sweeper().sweep(new Date(NOW.getTime() + 60 * 60 * 1000))

    expect(second).toEqual({ reminded: 0, failed: 0 })
    expect(await subjects()).toEqual(['project.decision_overdue'])
  })

  /**
   * Measured from the log entry, not from updated_at: any write to the row
   * touches updated_at, so an owner rereading and tweaking the project would
   * keep resetting their own deadline.
   */
  it('measures from the approval, not from the last edit', async () => {
    const id = await project('prd_approved', new Date(NOW.getTime() - 15 * DAY))
    await handle.db
      .update(projects)
      .set({ title: 'Renamed yesterday', updatedAt: new Date(NOW.getTime() - DAY) })
      .where(eq(projects.id, id))

    const result = await sweeper().sweep(NOW)

    expect(result).toEqual({ reminded: 1, failed: 0 })
  })

  it('ignores an approved project with no log entry to measure from', async () => {
    await project('prd_approved', null)

    const result = await sweeper().sweep(NOW)

    expect(result).toEqual({ reminded: 0, failed: 0 })
  })
})
