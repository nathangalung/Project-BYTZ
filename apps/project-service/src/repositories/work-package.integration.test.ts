import { projects, user, workPackages } from '@kerjacus/db'
import { connectTestDatabase, hasTestDatabase, type TestHandle } from '@kerjacus/db/testing'
import { AppError } from '@kerjacus/shared'
import { eq } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { WorkPackageRepository } from './work-package.repository'

/**
 * The same guard work-package-lost-update.test.ts pins by reading the source,
 * executed instead.
 *
 * A regex over the file proves the predicate is written. It cannot prove
 * Postgres applies it, that zero matched rows is distinguishable from a missing
 * row, or that the loser of a real race gets a conflict rather than a silent
 * no-op. Those need a database, which is why this half of the suite did not
 * exist.
 */

const runIf = hasTestDatabase() ? describe : describe.skip

runIf('WorkPackageRepository.updateStatus against Postgres', () => {
  let handle: TestHandle
  let repo: WorkPackageRepository
  let projectId: string
  let packageId: string

  beforeAll(async () => {
    handle = await connectTestDatabase()
  })

  afterAll(async () => {
    await handle.close()
  })

  beforeEach(async () => {
    await handle.truncate()
    repo = new WorkPackageRepository(handle.db)

    const ownerId = uuidv7()
    await handle.db.insert(user).values({
      id: ownerId,
      email: `owner-${ownerId}@example.test`,
      name: 'Owner',
      emailVerified: false,
    })

    projectId = uuidv7()
    await handle.db.insert(projects).values({
      id: projectId,
      ownerId,
      title: 'Integration project',
      description: 'Exercises the work package status guard',
      category: 'web_app',
      budgetMin: 1_000_000,
      budgetMax: 5_000_000,
      estimatedTimelineDays: 30,
    })

    packageId = uuidv7()
    await handle.db.insert(workPackages).values({
      id: packageId,
      projectId,
      title: 'Backend API',
      description: 'Work package under test',
      orderIndex: 0,
      requiredSkills: ['backend'],
      estimatedHours: 40,
      amount: 3_000_000,
      talentPayout: 2_145_000,
      status: 'unassigned',
    })
  })

  async function currentStatus(): Promise<string | undefined> {
    const [row] = await handle.db
      .select({ status: workPackages.status })
      .from(workPackages)
      .where(eq(workPackages.id, packageId))
    return row?.status
  }

  it('moves the row when it still holds the expected status', async () => {
    const updated = await repo.updateStatus(packageId, 'assigned', 'unassigned')

    expect(updated?.status).toBe('assigned')
    expect(await currentStatus()).toBe('assigned')
  })

  /**
   * The write the guard exists to stop. A talent acceptance has already moved
   * the package to assigned; this caller read unassigned and must lose.
   */
  it('refuses a write whose expected status is stale', async () => {
    await repo.updateStatus(packageId, 'assigned', 'unassigned')

    await expect(repo.updateStatus(packageId, 'in_progress', 'unassigned')).rejects.toThrow(
      AppError,
    )
    expect(await currentStatus()).toBe('assigned')
  })

  it('reports the stale write as a conflict, not a missing row', async () => {
    await repo.updateStatus(packageId, 'assigned', 'unassigned')

    await expect(repo.updateStatus(packageId, 'in_progress', 'unassigned')).rejects.toMatchObject({
      code: 'CONFLICT',
    })
  })

  /** Zero rows because the id is gone reads differently from a lost race. */
  it('returns undefined when the row does not exist', async () => {
    await expect(repo.updateStatus(uuidv7(), 'assigned', 'unassigned')).resolves.toBeUndefined()
  })

  /**
   * Two callers that both read `unassigned`. Exactly one may commit, which is
   * the property the regex cannot check.
   */
  it('lets exactly one of two concurrent writers win', async () => {
    const results = await Promise.allSettled([
      repo.updateStatus(packageId, 'assigned', 'unassigned'),
      repo.updateStatus(packageId, 'in_progress', 'unassigned'),
    ])

    const won = results.filter((r) => r.status === 'fulfilled' && r.value !== undefined)
    const lost = results.filter((r) => r.status === 'rejected')

    expect(won).toHaveLength(1)
    expect(lost).toHaveLength(1)
    expect(['assigned', 'in_progress']).toContain(await currentStatus())
  })
})
