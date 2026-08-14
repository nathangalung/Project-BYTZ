import { projects, talentPlacementRequests, talentProfiles, user } from '@kerjacus/db'
import { connectTestDatabase, hasTestDatabase, type TestHandle } from '@kerjacus/db/testing'
import { eq, sql } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { TalentPlacementRepository } from './talent-placement.repository'

/**
 * TalentPlacementRepository against Postgres.
 *
 * Placement is the release valve that keeps a direct hire on the platform
 * instead of happening quietly outside it, and the conversion fee is real
 * money. None of it had ever been executed.
 */

const runIf = hasTestDatabase() ? describe : describe.skip

/** See milestone.integration.test.ts: serialises the integration files. */
const INTEGRATION_LOCK = sql`SELECT pg_advisory_lock(20260813)`

runIf('TalentPlacementRepository', () => {
  let handle: TestHandle
  let repo: TalentPlacementRepository
  let ownerId: string
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
    repo = new TalentPlacementRepository(handle.db)

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
      name: 'Talent',
      emailVerified: false,
      role: 'talent',
    })
    talentId = uuidv7()
    await handle.db.insert(talentProfiles).values({ id: talentId, userId: talentUserId })

    projectId = uuidv7()
    await handle.db.insert(projects).values({
      id: projectId,
      ownerId,
      title: 'Placement project',
      description: 'Exercises the placement repository',
      category: 'web_app',
      budgetMin: 1_000_000,
      budgetMax: 5_000_000,
      estimatedTimelineDays: 30,
      status: 'completed',
    })
  })

  async function newProject(): Promise<string> {
    const id = uuidv7()
    await handle.db.insert(projects).values({
      id,
      ownerId,
      title: 'Another',
      description: 'Another engagement',
      category: 'mobile_app',
      budgetMin: 1,
      budgetMax: 2,
      estimatedTimelineDays: 1,
    })
    return id
  }

  describe('create', () => {
    it('opens the request in the requested state', async () => {
      const created = await repo.create({ projectId, ownerId, talentId })

      expect(created.status).toBe('requested')
      expect(created.estimatedAnnualSalary).toBeNull()
      expect(created.conversionFeeAmount).toBeNull()

      const stored = await handle.db
        .select()
        .from(talentPlacementRequests)
        .where(eq(talentPlacementRequests.id, created.id))
      expect(stored).toHaveLength(1)
    })

    it('records the salary estimate when the owner supplies one', async () => {
      const created = await repo.create({
        projectId,
        ownerId,
        talentId,
        estimatedAnnualSalary: 180_000_000,
      })

      expect(created.estimatedAnnualSalary).toBe(180_000_000)
    })

    /**
     * talent_placement_live_unique keeps one live request per pair, so an
     * owner cannot open a second approach while the first is still open.
     */
    it('lets the database refuse a second live request for the same pair', async () => {
      await repo.create({ projectId, ownerId, talentId })

      await expect(repo.create({ projectId, ownerId, talentId })).rejects.toMatchObject({
        cause: { code: '23505', constraint_name: 'talent_placement_live_unique' },
      })
    })

    /** Declined is excluded from that index: a talent who said no can be asked again. */
    it('allows a fresh approach once the previous one was declined', async () => {
      const first = await repo.create({ projectId, ownerId, talentId })
      await repo.updateStatus(first.id, 'declined')

      const second = await repo.create({ projectId, ownerId, talentId })

      expect(second.status).toBe('requested')
    })
  })

  describe('findById', () => {
    it('returns the request', async () => {
      const created = await repo.create({ projectId, ownerId, talentId })
      expect((await repo.findById(created.id))?.id).toBe(created.id)
    })

    it('answers undefined for an unknown id', async () => {
      expect(await repo.findById(uuidv7())).toBeUndefined()
    })
  })

  describe('findByOwner', () => {
    it('returns the owner requests newest first with a total', async () => {
      const older = await repo.create({ projectId, ownerId, talentId })
      await handle.db
        .update(talentPlacementRequests)
        .set({ createdAt: new Date('2026-01-01T00:00:00Z') })
        .where(eq(talentPlacementRequests.id, older.id))
      const newer = await repo.create({ projectId: await newProject(), ownerId, talentId })

      const { items, total } = await repo.findByOwner(ownerId, { page: 1, pageSize: 10 })

      expect(items.map((r) => r.id)).toEqual([newer.id, older.id])
      expect(total).toBe(2)
    })

    it('pages without changing the total', async () => {
      await repo.create({ projectId, ownerId, talentId })
      await repo.create({ projectId: await newProject(), ownerId, talentId })
      await repo.create({ projectId: await newProject(), ownerId, talentId })

      const { items, total } = await repo.findByOwner(ownerId, { page: 2, pageSize: 2 })

      expect(items).toHaveLength(1)
      expect(total).toBe(3)
    })

    it('does not return another owner requests', async () => {
      await repo.create({ projectId, ownerId, talentId })
      const stranger = uuidv7()
      await handle.db.insert(user).values({
        id: stranger,
        email: `s-${stranger}@example.test`,
        name: 'Stranger',
        emailVerified: false,
      })

      expect(await repo.findByOwner(stranger, { page: 1, pageSize: 10 })).toEqual({
        items: [],
        total: 0,
      })
    })
  })

  describe('findByTalent', () => {
    it('returns the talent requests with a total', async () => {
      const created = await repo.create({ projectId, ownerId, talentId })

      const { items, total } = await repo.findByTalent(talentId, { page: 1, pageSize: 10 })

      expect(items.map((r) => r.id)).toEqual([created.id])
      expect(total).toBe(1)
    })

    it('pages without changing the total', async () => {
      await repo.create({ projectId, ownerId, talentId })
      await repo.create({ projectId: await newProject(), ownerId, talentId })

      const { items, total } = await repo.findByTalent(talentId, { page: 2, pageSize: 1 })

      expect(items).toHaveLength(1)
      expect(total).toBe(2)
    })

    it('does not return another talent requests', async () => {
      await repo.create({ projectId, ownerId, talentId })

      expect(await repo.findByTalent(uuidv7(), { page: 1, pageSize: 10 })).toEqual({
        items: [],
        total: 0,
      })
    })
  })

  describe('updateStatus', () => {
    it.each(['in_discussion', 'accepted', 'declined', 'completed'] as const)(
      'moves the request to %s',
      async (status) => {
        const created = await repo.create({ projectId, ownerId, talentId })

        const updated = await repo.updateStatus(created.id, status)

        expect(updated?.status).toBe(status)
        expect((await repo.findById(created.id))?.status).toBe(status)
      },
    )

    it('stores the note when one is given', async () => {
      const created = await repo.create({ projectId, ownerId, talentId })

      const updated = await repo.updateStatus(created.id, 'declined', 'Talent is not moving')

      expect(updated?.notes).toBe('Talent is not moving')
    })

    /** An absent note must not blank the one already recorded. */
    it('leaves an existing note alone when none is given', async () => {
      const created = await repo.create({ projectId, ownerId, talentId })
      await repo.updateStatus(created.id, 'in_discussion', 'Owner opened talks')

      const updated = await repo.updateStatus(created.id, 'accepted')

      expect(updated?.notes).toBe('Owner opened talks')
    })

    it('answers undefined for an unknown id', async () => {
      expect(await repo.updateStatus(uuidv7(), 'accepted')).toBeUndefined()
    })
  })

  describe('updateFee', () => {
    it('records the percentage and the amount', async () => {
      const created = await repo.create({ projectId, ownerId, talentId })

      const updated = await repo.updateFee(created.id, 13.5, 24_300_000)

      expect(updated?.conversionFeePercentage).toBeCloseTo(13.5)
      expect(updated?.conversionFeeAmount).toBe(24_300_000)
    })

    it('revises the salary estimate when a new one is given', async () => {
      const created = await repo.create({
        projectId,
        ownerId,
        talentId,
        estimatedAnnualSalary: 100_000_000,
      })

      const updated = await repo.updateFee(created.id, 12, 21_600_000, 180_000_000)

      expect(updated?.estimatedAnnualSalary).toBe(180_000_000)
    })

    it('leaves the salary estimate alone when none is given', async () => {
      const created = await repo.create({
        projectId,
        ownerId,
        talentId,
        estimatedAnnualSalary: 100_000_000,
      })

      const updated = await repo.updateFee(created.id, 12, 12_000_000)

      expect(updated?.estimatedAnnualSalary).toBe(100_000_000)
    })

    it('answers undefined for an unknown id', async () => {
      expect(await repo.updateFee(uuidv7(), 10, 1_000_000)).toBeUndefined()
    })
  })
})
