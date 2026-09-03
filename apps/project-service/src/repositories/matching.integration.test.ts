import {
  milestones,
  projectAssignments,
  projects,
  reviews,
  skills,
  talentProfiles,
  talentSkills,
  tasks,
  timeLogs,
  user,
  workPackages,
} from '@kerjacus/db'
import { connectTestDatabase, hasTestDatabase, type TestHandle } from '@kerjacus/db/testing'
import { eq, sql } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { MatchingRepository } from './matching.repository'
import { clearSkillEmbeddingCache } from './skill-embedding-cache'

/**
 * MatchingRepository against Postgres.
 *
 * pemerataan_skor carries the largest matching weight and is computed from the
 * counts findEligibleTalents returns. Those were read from talent_profiles
 * columns only the seed ever wrote, so the busiest talent on the dev database
 * was recorded as idle and kept being recommended. A regex over the select
 * list shows the subqueries are written; only running them shows they count
 * the right rows, which is what the fairness rules depend on.
 */

const runIf = hasTestDatabase() ? describe : describe.skip

/** See milestone.integration.test.ts: serialises the integration files. */
const INTEGRATION_LOCK = sql`SELECT pg_advisory_lock(20260813)`

/** skills.embedding is vector(1024); the values only need to differ. */
function embedding(seed: number): number[] {
  return Array.from({ length: 1024 }, (_, i) => (i === 0 ? seed : 0))
}

runIf('MatchingRepository', () => {
  let handle: TestHandle
  let repo: MatchingRepository
  let ownerId: string
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
    // The embedding cache lives in the module, not the connection, so it
    // survives truncate and would make the second read vacuous.
    clearSkillEmbeddingCache()
    repo = new MatchingRepository(handle.db)

    ownerId = uuidv7()
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
      title: 'Matching project',
      description: 'Exercises the matching repository',
      category: 'web_app',
      budgetMin: 1_000_000,
      budgetMax: 9_000_000,
      estimatedTimelineDays: 40,
    })
  })

  async function seedTalent(
    over: Partial<typeof talentProfiles.$inferInsert> = {},
  ): Promise<{ talentId: string; userId: string }> {
    const userId = uuidv7()
    await handle.db.insert(user).values({
      id: userId,
      email: `talent-${userId}@example.test`,
      name: 'Talent',
      emailVerified: false,
      role: 'talent',
    })
    const talentId = uuidv7()
    await handle.db.insert(talentProfiles).values({
      id: talentId,
      userId,
      verificationStatus: 'verified',
      availabilityStatus: 'available',
      ...over,
    })
    return { talentId, userId }
  }

  async function seedWorkPackage(): Promise<string> {
    const id = uuidv7()
    await handle.db.insert(workPackages).values({
      id,
      projectId,
      title: 'Package',
      description: 'Package',
      orderIndex: 0,
      requiredSkills: ['backend'],
      estimatedHours: 20,
      amount: 2_000_000,
      talentPayout: 1_500_000,
    })
    return id
  }

  async function seedAssignment(
    talentId: string,
    status: 'active' | 'completed' | 'terminated' | 'replaced',
    over: Partial<typeof projectAssignments.$inferInsert> = {},
  ): Promise<string> {
    const id = uuidv7()
    await handle.db.insert(projectAssignments).values({
      id,
      projectId,
      talentId,
      workPackageId: await seedWorkPackage(),
      status,
      ...over,
    })
    return id
  }

  describe('findEligibleTalents', () => {
    it('returns a verified, available talent with zero counts', async () => {
      const { talentId, userId } = await seedTalent()

      const rows = await repo.findEligibleTalents()

      expect(rows).toEqual([
        {
          id: talentId,
          userId,
          totalProjectsCompleted: 0,
          totalProjectsActive: 0,
          averageRating: null,
          pemerataanPenalty: 0,
        },
      ])
    })

    /**
     * KNOWN DEFECT - marked `.fails` so the suite stays green while the bug
     * stands. Fix the repository and this test starts failing; that is the
     * signal to turn it back into a plain `it`.
     *
     * Both correlated subqueries return zero for every talent, always. Drizzle
     * renders column references unqualified inside a `sql` template used as a
     * select projection, so
     *
     *   WHERE ${projectAssignments.talentId} = ${talentProfiles.id}
     *
     * reaches Postgres as `WHERE "talent_id" = "id"`. project_assignments has
     * an `id` of its own, so the inner query binds `"id"` to itself and
     * compares an assignment id against a talent id. It never matches.
     *
     * The counts did not go from stale to live, they went from stale to always
     * zero - so pemerataan_skor is now 1.0 for every candidate and the 0.35
     * weight it carries, the largest in the formula, no longer separates a
     * talent holding three active projects from one holding none. The source
     * -text test that replaced the stored columns could not see this: the
     * select list does mention projectAssignments and does not mention the
     * stale columns, which is all a regex can check.
     *
     * Qualifying the reference fixes it, e.g. sql`"talent_profiles"."id"`.
     * The same shape in project.repository.ts is inside a WHERE clause, which
     * drizzle does qualify, and the visibility tests here prove it correlates.
     */
    it('counts live assignments rather than reading the stale columns', async () => {
      const { talentId } = await seedTalent({
        totalProjectsActive: 0,
        totalProjectsCompleted: 0,
      })
      await seedAssignment(talentId, 'active')
      await seedAssignment(talentId, 'active')
      await seedAssignment(talentId, 'completed')
      // Neither of these is live work, so neither may be counted.
      await seedAssignment(talentId, 'terminated')
      await seedAssignment(talentId, 'replaced')

      const [row] = await repo.findEligibleTalents()

      expect(row?.totalProjectsActive).toBe(2)
      expect(row?.totalProjectsCompleted).toBe(1)
    })

    it('still reads rating and penalty from the profile', async () => {
      await seedTalent({ averageRating: 4.5, pemerataanPenalty: 1.5 })

      const [row] = await repo.findEligibleTalents()

      expect(row?.averageRating).toBeCloseTo(4.5)
      expect(row?.pemerataanPenalty).toBeCloseTo(1.5)
    })

    it.each(['unverified', 'cv_parsing', 'suspended'] as const)(
      'excludes a %s talent',
      async (verificationStatus) => {
        await seedTalent({ verificationStatus })
        expect(await repo.findEligibleTalents()).toEqual([])
      },
    )

    it.each(['busy', 'unavailable'] as const)('excludes a %s talent', async (status) => {
      await seedTalent({ availabilityStatus: status })
      expect(await repo.findEligibleTalents()).toEqual([])
    })

    /**
     * Excluded in SQL rather than after the fetch: filtering in JavaScript
     * still selected the staffed talents and still evaluated both correlated
     * counts per row before dropping them.
     */
    it('excludes the ids it was asked to skip', async () => {
      const first = await seedTalent()
      const second = await seedTalent()

      const rows = await repo.findEligibleTalents([first.talentId])

      expect(rows.map((r) => r.id)).toEqual([second.talentId])
    })

    it('applies no exclusion for an empty list', async () => {
      await seedTalent()
      await seedTalent()

      expect(await repo.findEligibleTalents([])).toHaveLength(2)
    })
  })

  describe('getTalentSkills', () => {
    async function seedSkill(name: string, aliases: string[] = []): Promise<string> {
      const id = uuidv7()
      await handle.db.insert(skills).values({ id, name, category: 'backend', aliases })
      return id
    }

    it('answers without touching the database for an empty list', async () => {
      expect(await repo.getTalentSkills([])).toEqual([])
    })

    it('returns the canonical skill name per talent', async () => {
      const { talentId } = await seedTalent()
      const skillId = await seedSkill('TypeScript')
      await handle.db.insert(talentSkills).values({
        talentId,
        skillId,
        proficiencyLevel: 'advanced',
        isPrimary: true,
      })

      expect(await repo.getTalentSkills([talentId])).toEqual([
        { talentId, skillName: 'TypeScript' },
      ])
    })

    it('returns nothing for a talent with no skills', async () => {
      const { talentId } = await seedTalent()
      expect(await repo.getTalentSkills([talentId])).toEqual([])
    })

    it('does not return skills belonging to a talent it was not asked about', async () => {
      const asked = await seedTalent()
      const other = await seedTalent()
      const skillId = await seedSkill('Go')
      await handle.db.insert(talentSkills).values({
        talentId: other.talentId,
        skillId,
        proficiencyLevel: 'expert',
        isPrimary: true,
      })

      expect(await repo.getTalentSkills([asked.talentId])).toEqual([])
    })
  })

  describe('getAllSkillEmbeddings', () => {
    async function seedSkill(
      name: string,
      over: { aliases?: unknown; embedding?: number[] | null } = {},
    ): Promise<void> {
      await handle.db.insert(skills).values({
        id: uuidv7(),
        name,
        category: 'frontend',
        aliases: (over.aliases ?? null) as never,
        embedding: over.embedding === undefined ? embedding(1) : over.embedding,
      })
    }

    it('keys the vector by the lowercased canonical name', async () => {
      await seedSkill('React', { embedding: embedding(7) })

      const map = await repo.getAllSkillEmbeddings()

      expect(map.get('react')?.[0]).toBeCloseTo(7)
      expect(map.has('React')).toBe(false)
    })

    /** "React" vs "React.js" vs "ReactJS" is the case Stage 3 exists for. */
    it('keys the same vector by every alias', async () => {
      await seedSkill('React', { aliases: ['React.js', 'ReactJS'], embedding: embedding(3) })

      const map = await repo.getAllSkillEmbeddings()

      expect(map.get('react.js')).toBe(map.get('react'))
      expect(map.get('reactjs')).toBe(map.get('react'))
    })

    it('skips a skill with no embedding yet', async () => {
      await seedSkill('Svelte', { embedding: null })

      expect((await repo.getAllSkillEmbeddings()).size).toBe(0)
    })

    it('ignores aliases that are not usable strings', async () => {
      await seedSkill('Vue', { aliases: ['', 42, null, 'VueJS'] })

      const map = await repo.getAllSkillEmbeddings()

      expect(map.has('vuejs')).toBe(true)
      expect(map.has('')).toBe(false)
      expect(map.size).toBe(2)
    })

    it('tolerates an aliases column that is not an array', async () => {
      await seedSkill('Angular', { aliases: { legacy: true } })

      expect((await repo.getAllSkillEmbeddings()).has('angular')).toBe(true)
    })

    /**
     * The point of the cache: every matching request was re-materialising a
     * table whose rows each carry a vector(1024).
     */
    it('serves the second call from the cache without reading the table', async () => {
      await seedSkill('React', { embedding: embedding(2) })
      const first = await repo.getAllSkillEmbeddings()

      await handle.db.delete(skills)
      const second = await repo.getAllSkillEmbeddings()

      expect(second).toBe(first)
      expect(second.has('react')).toBe(true)
    })

    /** An unembedded taxonomy must cache too, or every request re-reads nothing. */
    it('caches an empty map rather than re-querying', async () => {
      const first = await repo.getAllSkillEmbeddings()
      expect(first.size).toBe(0)

      await seedSkill('React')
      expect(await repo.getAllSkillEmbeddings()).toBe(first)
    })
  })

  describe('getTalentHistoricalStats', () => {
    async function seedMilestone(
      talentId: string,
      over: Partial<typeof milestones.$inferInsert> = {},
    ): Promise<string> {
      const id = uuidv7()
      await handle.db.insert(milestones).values({
        id,
        projectId,
        assignedTalentId: talentId,
        title: 'Milestone',
        description: 'Delivered',
        orderIndex: 0,
        amount: 1_000_000,
        status: 'approved',
        dueDate: new Date('2026-06-10T00:00:00Z'),
        submittedAt: new Date('2026-06-01T00:00:00Z'),
        ...over,
      })
      return id
    }

    async function seedReview(revieweeId: string, rating: number): Promise<void> {
      const reviewerId = uuidv7()
      await handle.db.insert(user).values({
        id: reviewerId,
        email: `r-${reviewerId}@example.test`,
        name: 'Reviewer',
        emailVerified: false,
      })
      await handle.db.insert(reviews).values({
        id: uuidv7(),
        projectId,
        reviewerId,
        revieweeId,
        rating,
        type: 'owner_to_talent',
      })
    }

    it('answers without touching the database for an empty list', async () => {
      expect(await repo.getTalentHistoricalStats([])).toEqual(new Map())
    })

    it('omits a talent with no milestones and no reviews', async () => {
      const { talentId } = await seedTalent()

      expect(await repo.getTalentHistoricalStats([talentId]).then((m) => m.has(talentId))).toBe(
        false,
      )
    })

    it('computes the on-time rate from approved milestones', async () => {
      const { talentId } = await seedTalent()
      await seedMilestone(talentId)
      await seedMilestone(talentId, { submittedAt: new Date('2026-06-20T00:00:00Z') })

      const stats = await repo.getTalentHistoricalStats([talentId])

      expect(stats.get(talentId)?.onTimeRate).toBeCloseTo(0.5)
    })

    it('treats a submission on the due date as on time', async () => {
      const { talentId } = await seedTalent()
      await seedMilestone(talentId, { submittedAt: new Date('2026-06-10T00:00:00Z') })

      expect((await repo.getTalentHistoricalStats([talentId])).get(talentId)?.onTimeRate).toBe(1)
    })

    it('counts a never-submitted milestone against the rate', async () => {
      const { talentId } = await seedTalent()
      await seedMilestone(talentId, { submittedAt: null })

      expect((await repo.getTalentHistoricalStats([talentId])).get(talentId)?.onTimeRate).toBe(0)
    })

    // Work still in flight says nothing about delivery.
    it('ignores milestones that are not approved', async () => {
      const { talentId, userId } = await seedTalent()
      await seedMilestone(talentId, { status: 'submitted' })
      await seedReview(userId, 4)

      const stats = await repo.getTalentHistoricalStats([talentId])

      expect(stats.get(talentId)?.onTimeRate).toBeCloseTo(0.8)
    })

    it('normalises the owner rating to a satisfaction rate', async () => {
      const { talentId, userId } = await seedTalent()
      await seedReview(userId, 5)
      await seedReview(userId, 3)

      const stats = await repo.getTalentHistoricalStats([talentId])

      expect(stats.get(talentId)?.satisfactionRate).toBeCloseTo(0.8)
    })

    /** The talent's own rating of the owner is not a signal about the talent. */
    it('ignores talent_to_owner reviews', async () => {
      const { talentId, userId } = await seedTalent()
      await handle.db.insert(reviews).values({
        id: uuidv7(),
        projectId,
        reviewerId: userId,
        revieweeId: ownerId,
        rating: 1,
        type: 'talent_to_owner',
      })
      await seedMilestone(talentId)

      const stats = await repo.getTalentHistoricalStats([talentId])

      expect(stats.get(talentId)?.satisfactionRate).toBeCloseTo(0.8)
    })

    it('gives the benefit of the doubt on the side with no signal', async () => {
      const withMilestones = await seedTalent()
      const withReviews = await seedTalent()
      await seedMilestone(withMilestones.talentId)
      await seedReview(withReviews.userId, 5)

      const stats = await repo.getTalentHistoricalStats([
        withMilestones.talentId,
        withReviews.talentId,
      ])

      expect(stats.get(withMilestones.talentId)).toEqual({ onTimeRate: 1, satisfactionRate: 0.8 })
      expect(stats.get(withReviews.talentId)).toEqual({ onTimeRate: 0.8, satisfactionRate: 1 })
    })
  })

  describe('incrementPemerataanPenalty', () => {
    async function penaltyOf(talentId: string): Promise<number | undefined> {
      const [row] = await handle.db
        .select({ p: talentProfiles.pemerataanPenalty })
        .from(talentProfiles)
        .where(eq(talentProfiles.id, talentId))
      return row?.p
    }

    it('adds the delta to what is already there', async () => {
      const { talentId } = await seedTalent({ pemerataanPenalty: 1 })

      await repo.incrementPemerataanPenalty(talentId, 0.5)

      expect(await penaltyOf(talentId)).toBeCloseTo(1.5)
    })

    /** Uncapped, a repeatedly penalised talent could never be recommended again. */
    it('caps the penalty at five', async () => {
      const { talentId } = await seedTalent({ pemerataanPenalty: 4.8 })

      await repo.incrementPemerataanPenalty(talentId, 3)

      expect(await penaltyOf(talentId)).toBeCloseTo(5)
    })

    it('leaves other talents alone', async () => {
      const penalised = await seedTalent()
      const innocent = await seedTalent()

      await repo.incrementPemerataanPenalty(penalised.talentId, 1)

      expect(await penaltyOf(innocent.talentId)).toBeCloseTo(0)
    })
  })

  describe('findInactiveTalents', () => {
    const DAY = 24 * 60 * 60 * 1000

    async function seedTaskFor(talentId: string): Promise<string> {
      const milestoneId = uuidv7()
      await handle.db.insert(milestones).values({
        id: milestoneId,
        projectId,
        assignedTalentId: talentId,
        title: 'Milestone',
        description: 'Work',
        orderIndex: 0,
        amount: 1_000_000,
        dueDate: new Date(Date.now() + 30 * DAY),
        updatedAt: new Date(Date.now() - 60 * DAY),
      })
      const taskId = uuidv7()
      await handle.db
        .insert(tasks)
        .values({ id: taskId, milestoneId, title: 'Task', orderIndex: 0 })
      return taskId
    }

    it('reports an active assignment with no activity at all', async () => {
      const { talentId } = await seedTalent()
      const assignmentId = await seedAssignment(talentId, 'active', {
        createdAt: new Date(Date.now() - 30 * DAY),
      })

      const rows = await repo.findInactiveTalents(7)

      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ talentId, projectId, assignmentId })
      expect(rows[0]?.lastActivity).toBeInstanceOf(Date)
    })

    /** A brand new assignment has had no chance to show activity yet. */
    it('ignores an assignment created inside the window', async () => {
      const { talentId } = await seedTalent()
      await seedAssignment(talentId, 'active', { createdAt: new Date(Date.now() - 2 * DAY) })

      expect(await repo.findInactiveTalents(7)).toEqual([])
    })

    it('ignores an assignment that is not active', async () => {
      const { talentId } = await seedTalent()
      await seedAssignment(talentId, 'completed', { createdAt: new Date(Date.now() - 30 * DAY) })

      expect(await repo.findInactiveTalents(7)).toEqual([])
    })

    it('ignores a talent who logged time inside the window', async () => {
      const { talentId } = await seedTalent()
      await seedAssignment(talentId, 'active', { createdAt: new Date(Date.now() - 30 * DAY) })
      await handle.db.insert(timeLogs).values({
        id: uuidv7(),
        taskId: await seedTaskFor(talentId),
        talentId,
        startedAt: new Date(Date.now() - 1 * DAY),
      })

      expect(await repo.findInactiveTalents(7)).toEqual([])
    })

    it('ignores a talent whose milestone moved inside the window', async () => {
      const { talentId } = await seedTalent()
      await seedAssignment(talentId, 'active', { createdAt: new Date(Date.now() - 30 * DAY) })
      await handle.db.insert(milestones).values({
        id: uuidv7(),
        projectId,
        assignedTalentId: talentId,
        title: 'Recent',
        description: 'Moved recently',
        orderIndex: 1,
        amount: 1_000_000,
        dueDate: new Date(Date.now() + 30 * DAY),
        updatedAt: new Date(),
      })

      expect(await repo.findInactiveTalents(7)).toEqual([])
    })

    /** Stale work still reports when it stopped, so the warning can say how long. */
    it('reports the last time log as the last activity when one exists', async () => {
      const { talentId } = await seedTalent()
      await seedAssignment(talentId, 'active', { createdAt: new Date(Date.now() - 60 * DAY) })
      const taskId = await seedTaskFor(talentId)
      const lastSeen = new Date(Date.now() - 20 * DAY)
      await handle.db.insert(timeLogs).values([
        { id: uuidv7(), taskId, talentId, startedAt: new Date(Date.now() - 40 * DAY) },
        { id: uuidv7(), taskId, talentId, startedAt: lastSeen, endedAt: new Date() },
      ])

      const [row] = await repo.findInactiveTalents(7)

      expect(row?.lastActivity.getTime()).toBeCloseTo(lastSeen.getTime(), -3)
    })
  })

  describe('findRecentAbandons', () => {
    it('reports an assignment terminated inside the window', async () => {
      const { talentId } = await seedTalent()
      const assignmentId = await seedAssignment(talentId, 'terminated', {
        completedAt: new Date(Date.now() - 60 * 60 * 1000),
      })

      expect(await repo.findRecentAbandons(24)).toEqual([{ assignmentId, talentId }])
    })

    it('ignores a termination older than the window', async () => {
      const { talentId } = await seedTalent()
      await seedAssignment(talentId, 'terminated', {
        completedAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
      })

      expect(await repo.findRecentAbandons(24)).toEqual([])
    })

    it('ignores a termination with no timestamp', async () => {
      const { talentId } = await seedTalent()
      await seedAssignment(talentId, 'terminated', { completedAt: null })

      expect(await repo.findRecentAbandons(24)).toEqual([])
    })

    // A completed engagement is not an abandon.
    it('ignores an assignment that completed rather than terminated', async () => {
      const { talentId } = await seedTalent()
      await seedAssignment(talentId, 'completed', { completedAt: new Date() })

      expect(await repo.findRecentAbandons(24)).toEqual([])
    })
  })
})
