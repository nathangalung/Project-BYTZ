import { projectStatusLogs, projects, user } from '@kerjacus/db'
import { connectTestDatabase, hasTestDatabase, type TestHandle } from '@kerjacus/db/testing'
import { eq, sql } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ProjectRepository } from './project.repository'

/**
 * A status transition nobody performed.
 *
 * project_status_logs.changed_by is a foreign key to "user", and escrow
 * settlement passed the literal string 'system' through it. That is not a user
 * id, so the insert violated the constraint, the whole transition rolled back,
 * and the bare `catch {}` around it in payment-settlement.service.ts logged
 * nothing. The owner's money settled and the project stayed in prd_approved,
 * with no talent ever recommended and no trace of why.
 *
 * Null is the honest actor for a transition the platform made itself.
 */

const runIf = hasTestDatabase() ? describe : describe.skip
const INTEGRATION_LOCK = sql`SELECT pg_advisory_lock(20260813)`

runIf('transitionStatus with no user behind it', () => {
  let handle: TestHandle
  let repo: ProjectRepository
  let projectId: string
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
    await handle.db
      .insert(user)
      .values({ id: ownerId, email: `o-${ownerId}@example.test`, name: 'O', emailVerified: false })

    projectId = uuidv7()
    await handle.db.insert(projects).values({
      id: projectId,
      ownerId,
      title: 'Paid project',
      description: 'Escrow settled, waiting to be matched',
      category: 'web_app',
      budgetMin: 1_000_000,
      budgetMax: 5_000_000,
      estimatedTimelineDays: 30,
      status: 'prd_approved',
    })
  })

  it('moves the project when the actor is null', async () => {
    await repo.updateStatus(projectId, 'matching', null, 'Escrow payment completed')

    const [row] = await handle.db
      .select({ status: projects.status })
      .from(projects)
      .where(eq(projects.id, projectId))
    expect(row?.status).toBe('matching')
  })

  it('records the transition with no actor rather than skipping the log', async () => {
    await repo.updateStatus(projectId, 'matching', null, 'Escrow payment completed')

    const [log] = await handle.db
      .select()
      .from(projectStatusLogs)
      .where(eq(projectStatusLogs.projectId, projectId))

    expect(log?.changedBy).toBeNull()
    expect(log?.fromStatus).toBe('prd_approved')
    expect(log?.toStatus).toBe('matching')
    expect(log?.reason).toBe('Escrow payment completed')
  })

  /**
   * The exact shape that was failing. 'system' is not a row in "user", so the
   * foreign key rejects it and the transition never happens.
   */
  it('still refuses an actor that is not a real user', async () => {
    await expect(
      repo.updateStatus(projectId, 'matching', 'system', 'Escrow payment completed'),
    ).rejects.toThrow()

    const [row] = await handle.db
      .select({ status: projects.status })
      .from(projects)
      .where(eq(projects.id, projectId))
    expect(row?.status).toBe('prd_approved')
  })

  it('still records a real user when there is one', async () => {
    await repo.updateStatus(projectId, 'matching', ownerId, 'Owner moved it')

    const [log] = await handle.db
      .select({ changedBy: projectStatusLogs.changedBy })
      .from(projectStatusLogs)
      .where(eq(projectStatusLogs.projectId, projectId))

    expect(log?.changedBy).toBe(ownerId)
  })
})
