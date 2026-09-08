// biome-ignore-all lint/style/noRestrictedImports: this is a test, and the
// tables are what the fixtures are made of.

import { getDb, outboxEvents, projectStatusLogs, projects, user } from '@kerjacus/db'
import { connectTestDatabase, hasTestDatabase, type TestHandle } from '@kerjacus/db/testing'
import { eq, sql } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ProjectRepository } from '../repositories/project.repository'
import { ProjectStartSweepService } from './project-start-sweep'

/**
 * A paid project that never started.
 *
 * Escrow is funded before matching, so the owner's money is already held here.
 * The platform promises cancellation and a refund after 30 days and nothing
 * did that, so the money sat there with no reminder to anyone.
 */

const runIf = hasTestDatabase() ? describe : describe.skip
const INTEGRATION_LOCK = sql`SELECT pg_advisory_lock(20260813)`

const NOW = new Date('2026-06-01T00:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000

runIf('project start sweep', () => {
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
    status: 'matched' | 'in_progress' | 'cancelled',
    matchedAt: Date | null,
  ): Promise<string> {
    const id = uuidv7()
    await handle.db.insert(projects).values({
      id,
      ownerId,
      title: 'Funded and idle',
      description: 'Escrow paid, work never started',
      category: 'web_app',
      budgetMin: 1_000_000,
      budgetMax: 10_000_000,
      estimatedTimelineDays: 60,
      status,
    })
    if (matchedAt) {
      await handle.db.insert(projectStatusLogs).values({
        id: uuidv7(),
        projectId: id,
        fromStatus: 'team_forming',
        toStatus: 'matched',
        changedBy: ownerId,
        createdAt: matchedAt,
      })
    }
    return id
  }

  function sweeper() {
    return new ProjectStartSweepService(new ProjectRepository(getDb()))
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

  it('warns about a project that sat in matched past the deadline', async () => {
    const id = await project('matched', new Date(NOW.getTime() - 31 * DAY))

    const result = await sweeper().sweep(NOW)

    expect(result).toEqual({ warned: 1, failed: 0 })
    expect(await subjects()).toEqual(['project.start_overdue'])
    const [row] = await handle.db
      .select({ startReminderAt: projects.startReminderAt })
      .from(projects)
      .where(eq(projects.id, id))
    expect(row?.startReminderAt?.toISOString()).toBe(NOW.toISOString())
  })

  it('leaves a project still inside the window alone', async () => {
    await project('matched', new Date(NOW.getTime() - 10 * DAY))

    const result = await sweeper().sweep(NOW)

    expect(result).toEqual({ warned: 0, failed: 0 })
    expect(await subjects()).toEqual([])
  })

  /** Work started; the deadline was about starting, not about finishing. */
  it('ignores a project that has moved on', async () => {
    await project('in_progress', new Date(NOW.getTime() - 60 * DAY))
    await project('cancelled', new Date(NOW.getTime() - 60 * DAY))

    const result = await sweeper().sweep(NOW)

    expect(result).toEqual({ warned: 0, failed: 0 })
  })

  /**
   * Hourly. Without the marker the owner would be told their project is stalled
   * every hour until somebody acts on it.
   */
  it('warns once, however often it runs', async () => {
    await project('matched', new Date(NOW.getTime() - 31 * DAY))

    await sweeper().sweep(NOW)
    const second = await sweeper().sweep(new Date(NOW.getTime() + 60 * 60 * 1000))

    expect(second).toEqual({ warned: 0, failed: 0 })
    expect(await subjects()).toEqual(['project.start_overdue'])
  })

  /**
   * Measured from the log entry, not from updated_at: any write to the row
   * touches updated_at, so a project the owner keeps editing would keep
   * resetting its own deadline.
   */
  it('measures from when the project reached matched, not from its last edit', async () => {
    const id = await project('matched', new Date(NOW.getTime() - 31 * DAY))
    await handle.db
      .update(projects)
      .set({ title: 'Renamed yesterday', updatedAt: new Date(NOW.getTime() - DAY) })
      .where(eq(projects.id, id))

    const result = await sweeper().sweep(NOW)

    expect(result).toEqual({ warned: 1, failed: 0 })
  })

  it('ignores a matched project with no log entry to measure from', async () => {
    await project('matched', null)

    const result = await sweeper().sweep(NOW)

    expect(result).toEqual({ warned: 0, failed: 0 })
  })
})
