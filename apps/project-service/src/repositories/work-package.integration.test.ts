import { projects, user, workPackages } from '@kerjacus/db'
import { connectTestDatabase, hasTestDatabase, type TestHandle } from '@kerjacus/db/testing'
import { AppError } from '@kerjacus/shared'
import { eq, sql } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { type CreateWorkPackageInput, WorkPackageRepository } from './work-package.repository'

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

/**
 * Integration files run in parallel forks and each truncates every table in
 * beforeEach, so two overlapping files delete each other's fixtures mid-test.
 * A session advisory lock serialises the integration files against each other
 * and leaves the unit tests parallel. Released when the connection closes.
 */
const INTEGRATION_LOCK = sql`SELECT pg_advisory_lock(20260813)`

runIf('WorkPackageRepository.updateStatus against Postgres', () => {
  let handle: TestHandle
  let repo: WorkPackageRepository
  let projectId: string
  let packageId: string

  beforeAll(async () => {
    handle = await connectTestDatabase()
    await handle.db.execute(INTEGRATION_LOCK)
  }, 120_000)

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

  function input(over: Partial<CreateWorkPackageInput> = {}): CreateWorkPackageInput {
    return {
      projectId,
      title: 'Frontend',
      description: 'Screens and state',
      requiredSkills: ['react'],
      estimatedHours: 24,
      amount: 2_000_000,
      talentPayout: 1_430_000,
      orderIndex: 1,
      ...over,
    }
  }

  describe('reads', () => {
    it('returns a project packages in order index', async () => {
      const second = await repo.create(input({ orderIndex: 5, title: 'Second' }))
      const first = await repo.create(input({ orderIndex: 2, title: 'First' }))

      const rows = await repo.findByProjectId(projectId)

      // packageId, seeded at order index 0, leads.
      expect(rows.map((r) => r.id)).toEqual([packageId, first.id, second.id])
    })

    it('does not return another project packages', async () => {
      const other = uuidv7()
      await handle.db.insert(projects).values({
        id: other,
        ownerId: (await handle.db.select({ id: user.id }).from(user))[0]?.id as string,
        title: 'Other',
        description: 'Other project',
        category: 'mobile_app',
        budgetMin: 1,
        budgetMax: 2,
        estimatedTimelineDays: 1,
      })

      expect(await repo.findByProjectId(other)).toEqual([])
    })

    it('finds one by id and answers undefined for an unknown id', async () => {
      expect((await repo.findById(packageId))?.id).toBe(packageId)
      expect(await repo.findById(uuidv7())).toBeUndefined()
    })
  })

  describe('create', () => {
    it('stores the package unassigned', async () => {
      const created = await repo.create(input())

      expect(created.status).toBe('unassigned')
      expect(created.requiredSkills).toEqual(['react'])
      expect(created.amount).toBe(2_000_000)
      expect((await repo.findById(created.id))?.title).toBe('Frontend')
    })

    /**
     * work_packages_payout_within_amount. The payout is the talent's share of
     * the package price, so a payout above it would mean the platform paying
     * out more than the owner was charged.
     */
    it('refuses a payout larger than the package amount', async () => {
      await expect(
        repo.create(input({ amount: 1_000_000, talentPayout: 1_000_001 })),
      ).rejects.toMatchObject({
        cause: { constraint_name: 'work_packages_payout_within_amount' },
      })
    })

    it('refuses a package priced at zero', async () => {
      await expect(repo.create(input({ amount: 0, talentPayout: 0 }))).rejects.toMatchObject({
        cause: { constraint_name: 'work_packages_amount_positive' },
      })
    })
  })

  describe('createMany', () => {
    it('answers without touching the database for an empty list', async () => {
      expect(await repo.createMany([])).toEqual([])
    })

    it('returns every row it inserted', async () => {
      const created = await repo.createMany([
        input({ title: 'One', orderIndex: 1 }),
        input({ title: 'Two', orderIndex: 2 }),
      ])

      expect(created.map((r) => r.title)).toEqual(['One', 'Two'])
      expect(await repo.findByProjectId(projectId)).toHaveLength(3)
    })

    /**
     * The transaction parameter exists because the project price and the
     * package payouts shift together when a package is added. Passing the pool
     * instead compiles and silently degrades that to separate autocommits, so
     * the rollback is the property worth proving.
     */
    it('joins the caller transaction and rolls back with it', async () => {
      await expect(
        handle.db.transaction(async (tx) => {
          await repo.createMany([input({ title: 'Doomed' })], tx)
          throw new Error('project repricing failed')
        }),
      ).rejects.toThrow('project repricing failed')

      expect(await repo.findByProjectId(projectId)).toHaveLength(1)
    })
  })

  describe('updatePayout', () => {
    it('writes the new payout', async () => {
      const updated = await repo.updatePayout(packageId, 1_800_000)

      expect(updated?.talentPayout).toBe(1_800_000)
      expect((await repo.findById(packageId))?.talentPayout).toBe(1_800_000)
    })

    it('answers undefined for an unknown package', async () => {
      expect(await repo.updatePayout(uuidv7(), 1)).toBeUndefined()
    })

    it('joins the caller transaction and rolls back with it', async () => {
      await expect(
        handle.db.transaction(async (tx) => {
          await repo.updatePayout(packageId, 1, tx)
          throw new Error('project repricing failed')
        }),
      ).rejects.toThrow('project repricing failed')

      expect((await repo.findById(packageId))?.talentPayout).toBe(2_145_000)
    })
  })

  describe('dependencies', () => {
    it('stores an edge defaulting to finish to start', async () => {
      const frontend = await repo.create(input())

      const edge = await repo.createDependency({
        workPackageId: frontend.id,
        dependsOnWorkPackageId: packageId,
      })

      expect(edge.type).toBe('finish_to_start')
      expect(await repo.getDependencies(frontend.id)).toHaveLength(1)
    })

    it('stores the type it was given', async () => {
      const frontend = await repo.create(input())

      const edge = await repo.createDependency({
        workPackageId: frontend.id,
        dependsOnWorkPackageId: packageId,
        type: 'start_to_start',
      })

      expect(edge.type).toBe('start_to_start')
    })

    it('returns no edges for a package that depends on nothing', async () => {
      expect(await repo.getDependencies(packageId)).toEqual([])
    })

    /** The unique index is what stops the same edge being added twice. */
    it('lets the database refuse the same edge twice', async () => {
      const frontend = await repo.create(input())
      await repo.createDependency({
        workPackageId: frontend.id,
        dependsOnWorkPackageId: packageId,
      })

      await expect(
        repo.createDependency({
          workPackageId: frontend.id,
          dependsOnWorkPackageId: packageId,
        }),
      ).rejects.toMatchObject({
        cause: { code: '23505', constraint_name: 'work_package_dependencies_unique' },
      })
    })

    it('collects every edge in the project for the critical path', async () => {
      const frontend = await repo.create(input({ title: 'Frontend', orderIndex: 1 }))
      const qa = await repo.create(input({ title: 'QA', orderIndex: 2 }))
      await repo.createDependency({
        workPackageId: frontend.id,
        dependsOnWorkPackageId: packageId,
      })
      await repo.createDependency({ workPackageId: qa.id, dependsOnWorkPackageId: frontend.id })

      expect(await repo.getDependenciesByProject(projectId)).toHaveLength(2)
    })

    it('returns nothing for a project with no packages at all', async () => {
      const empty = uuidv7()
      await handle.db.insert(projects).values({
        id: empty,
        ownerId: (await handle.db.select({ id: user.id }).from(user))[0]?.id as string,
        title: 'Empty',
        description: 'No packages',
        category: 'data_ai',
        budgetMin: 1,
        budgetMax: 2,
        estimatedTimelineDays: 1,
      })

      expect(await repo.getDependenciesByProject(empty)).toEqual([])
    })

    it('does not return another project edges', async () => {
      const frontend = await repo.create(input())
      await repo.createDependency({
        workPackageId: frontend.id,
        dependsOnWorkPackageId: packageId,
      })

      const other = uuidv7()
      await handle.db.insert(projects).values({
        id: other,
        ownerId: (await handle.db.select({ id: user.id }).from(user))[0]?.id as string,
        title: 'Other',
        description: 'Other project',
        category: 'data_ai',
        budgetMin: 1,
        budgetMax: 2,
        estimatedTimelineDays: 1,
      })
      await repo.create(input({ projectId: other }))

      expect(await repo.getDependenciesByProject(other)).toEqual([])
    })
  })

  /**
   * Adding an edge is read-all-edges, check for a cycle in JavaScript, insert.
   * Two concurrent adds each validate against a graph missing the other's
   * edge, so together they can commit a cycle neither would have allowed - and
   * a cyclic graph has no topological order, so the critical path has nothing
   * to compute. The unique index only stops the same edge twice.
   *
   * Proving the lock serialises needs two connections. The suite handle opens
   * with max: 1, so two calls on it queue behind each other in the driver and
   * would pass whether or not Postgres blocked anything.
   */
  describe('withDependencyLock', () => {
    let second: TestHandle

    beforeAll(async () => {
      second = await connectTestDatabase()
    }, 120_000)

    afterAll(async () => {
      await second.close()
    })

    it('returns what the critical section returned', async () => {
      expect(await repo.withDependencyLock(projectId, async () => 'computed')).toBe('computed')
    })

    it('releases the lock when the critical section throws', async () => {
      await expect(
        repo.withDependencyLock(projectId, async () => {
          throw new Error('cycle detected')
        }),
      ).rejects.toThrow('cycle detected')

      // A second holder would block forever if the first had not released.
      await expect(repo.withDependencyLock(projectId, async () => 'after')).resolves.toBe('after')
    })

    it('holds a second writer out until the first commits', async () => {
      const order: string[] = []
      let releaseFirst: () => void = () => {}
      let firstIsInside: () => void = () => {}
      const entered = new Promise<void>((resolve) => {
        firstIsInside = resolve
      })

      const first = repo.withDependencyLock(projectId, async () => {
        order.push('first-enter')
        firstIsInside()
        await new Promise<void>((resolve) => {
          releaseFirst = resolve
        })
        order.push('first-exit')
      })
      await entered

      const secondRepo = new WorkPackageRepository(second.db)
      const blocked = secondRepo.withDependencyLock(projectId, async () => {
        order.push('second-enter')
      })

      // Long enough that a second writer holding no lock would have run by now.
      await new Promise((resolve) => setTimeout(resolve, 400))
      expect(order).toEqual(['first-enter'])

      releaseFirst()
      await first
      await blocked

      // The second body cannot start until the first transaction commits, and
      // the first pushes its exit before committing. Only the marker ordering
      // between the two promises settling would be nondeterministic, so it is
      // not recorded.
      expect(order).toEqual(['first-enter', 'first-exit', 'second-enter'])
    }, 20_000)
  })
})
