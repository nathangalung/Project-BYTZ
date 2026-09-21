// biome-ignore-all lint/style/noRestrictedImports: this is a test, and the
// tables are what the fixtures are made of.

import { getDb, outboxEvents, prdDocuments, projects, user } from '@kerjacus/db'
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
 * only sees projects whose team is complete, and a team only completes after
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

  /**
   * `prd` null means no PRD was ever generated: prd_review spans generated,
   * approved and purchased, so the status alone no longer says whether the
   * owner approved anything. The sweep joins the document to find out.
   */
  async function project(
    status: 'prd_review' | 'matching' | 'in_progress' | 'cancelled',
    prd: { approvedAt: Date | null } | null,
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
    if (prd) {
      await handle.db.insert(prdDocuments).values({
        id: uuidv7(),
        projectId: id,
        content: { summary: 'Scope the owner signed off on' },
        price: 2_000_000,
        status: prd.approvedAt ? 'approved' : 'draft',
        approvedAt: prd.approvedAt,
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
    const id = await project('prd_review', { approvedAt: new Date(NOW.getTime() - 15 * DAY) })

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
    await project('prd_review', { approvedAt: new Date(NOW.getTime() - 5 * DAY) })

    const result = await sweeper().sweep(NOW)

    expect(result).toEqual({ reminded: 0, failed: 0 })
    expect(await subjects()).toEqual([])
  })

  /**
   * Every exit from prd_review is a decision already made, and the approval
   * stamp outlives the status, so only the status can rule these out.
   */
  it('ignores a project the owner already decided about', async () => {
    const stale = { approvedAt: new Date(NOW.getTime() - 60 * DAY) }
    await project('matching', stale)
    await project('in_progress', stale)
    await project('cancelled', stale)

    const result = await sweeper().sweep(NOW)

    expect(result).toEqual({ reminded: 0, failed: 0 })
  })

  /** Hourly, so without the marker the owner hears this every hour. */
  it('reminds once, however often it runs', async () => {
    await project('prd_review', { approvedAt: new Date(NOW.getTime() - 15 * DAY) })

    await sweeper().sweep(NOW)
    const second = await sweeper().sweep(new Date(NOW.getTime() + 60 * 60 * 1000))

    expect(second).toEqual({ reminded: 0, failed: 0 })
    expect(await subjects()).toEqual(['project.decision_overdue'])
  })

  /**
   * Measured from prd_documents.approved_at, not from updated_at: any write to
   * either row touches updated_at, so an owner rereading and tweaking the
   * project - or revising the PRD - would keep resetting their own deadline.
   */
  it('measures from the approval, not from the last edit', async () => {
    const id = await project('prd_review', { approvedAt: new Date(NOW.getTime() - 15 * DAY) })
    await handle.db
      .update(projects)
      .set({ title: 'Renamed yesterday', updatedAt: new Date(NOW.getTime() - DAY) })
      .where(eq(projects.id, id))

    const result = await sweeper().sweep(NOW)

    expect(result).toEqual({ reminded: 1, failed: 0 })
  })

  /** Generated but never approved: the owner has not been handed a decision yet. */
  it('ignores a project whose PRD is unapproved', async () => {
    await project('prd_review', { approvedAt: null })

    const result = await sweeper().sweep(NOW)

    expect(result).toEqual({ reminded: 0, failed: 0 })
  })

  /**
   * prd_review is reachable before generation finishes, and the sweep joins
   * the document rather than reading the status, so there is nothing to
   * measure from and the owner must not be chased.
   */
  it('ignores a project with no PRD at all', async () => {
    await project('prd_review', null)

    const result = await sweeper().sweep(NOW)

    expect(result).toEqual({ reminded: 0, failed: 0 })
  })
})
