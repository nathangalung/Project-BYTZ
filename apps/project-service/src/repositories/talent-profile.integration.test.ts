import { outboxEvents, skills, talentProfiles, talentSkills, user } from '@kerjacus/db'
import { connectTestDatabase, hasTestDatabase, type TestHandle } from '@kerjacus/db/testing'
import { eq, sql } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { TalentProfileRepository } from './talent-profile.repository'

/**
 * TalentProfileRepository against Postgres.
 *
 * Skills were replaced by deleting every row and re-inserting them one at a
 * time, outside any transaction. Skills are what findEligibleTalents filters
 * on, so a failure partway left a talent who had quietly stopped being
 * matchable for work they can do, with nothing to say it had happened. What
 * survives that failure is the property, and it needs a real transaction to
 * mean anything.
 */

const runIf = hasTestDatabase() ? describe : describe.skip

/** See milestone.integration.test.ts: serialises the integration files. */
const INTEGRATION_LOCK = sql`SELECT pg_advisory_lock(20260813)`

runIf('TalentProfileRepository', () => {
  let handle: TestHandle
  let repo: TalentProfileRepository
  let userId: string
  let reactId: string
  let goId: string

  beforeAll(async () => {
    handle = await connectTestDatabase()
    await handle.db.execute(INTEGRATION_LOCK)
  }, 120_000)

  afterAll(async () => {
    await handle.close()
  })

  beforeEach(async () => {
    await handle.truncate()
    repo = new TalentProfileRepository(handle.db)

    userId = uuidv7()
    await handle.db.insert(user).values({
      id: userId,
      email: `talent-${userId}@example.test`,
      name: 'Talent',
      emailVerified: false,
      role: 'talent',
    })

    reactId = uuidv7()
    goId = uuidv7()
    await handle.db.insert(skills).values([
      { id: reactId, name: 'React', category: 'frontend' },
      { id: goId, name: 'Go', category: 'backend' },
    ])
  })

  async function storedSkills(talentId: string) {
    return await handle.db
      .select({ skillId: talentSkills.skillId, isPrimary: talentSkills.isPrimary })
      .from(talentSkills)
      .where(eq(talentSkills.talentId, talentId))
  }

  async function profile(talentId: string) {
    const [row] = await handle.db
      .select()
      .from(talentProfiles)
      .where(eq(talentProfiles.id, talentId))
    return row
  }

  describe('findByUserId', () => {
    it('answers undefined before a profile exists', async () => {
      expect(await repo.findByUserId(userId)).toBeUndefined()
    })

    it('returns the profile id once it does', async () => {
      const talentId = await repo.save({ userId }, undefined, undefined)

      expect(await repo.findByUserId(userId)).toEqual({ id: talentId })
    })
  })

  describe('save, creating', () => {
    it('stores the profile and returns its new id', async () => {
      const talentId = await repo.save(
        { userId, bio: 'Fullstack, five years', location: 'Bandung', yearsOfExperience: 5 },
        undefined,
        undefined,
      )

      const row = await profile(talentId)
      expect(row?.bio).toBe('Fullstack, five years')
      expect(row?.location).toBe('Bandung')
      expect(row?.yearsOfExperience).toBe(5)
    })

    /** A new profile has not been vetted yet; CV parsing is what verifies it. */
    it('opens the profile unverified', async () => {
      const talentId = await repo.save({ userId }, undefined, undefined)

      expect((await profile(talentId))?.verificationStatus).toBe('unverified')
    })

    it('stores the skills it was given', async () => {
      const talentId = await repo.save({ userId }, undefined, [
        { skillId: reactId, proficiencyLevel: 'advanced', isPrimary: true },
        { skillId: goId, proficiencyLevel: 'intermediate', isPrimary: false },
      ])

      expect(await storedSkills(talentId)).toHaveLength(2)
    })

    it('publishes the registration', async () => {
      const talentId = await repo.save({ userId }, undefined, undefined)

      const events = await handle.db
        .select({ eventType: outboxEvents.eventType, payload: outboxEvents.payload })
        .from(outboxEvents)
      expect(events).toHaveLength(1)
      expect(events[0]?.eventType).toBe('talent.registered')
      expect(events[0]?.payload).toEqual({ talentId, userId })
    })
  })

  describe('save, updating', () => {
    let talentId: string

    beforeEach(async () => {
      talentId = await repo.save({ userId, bio: 'Original bio' }, undefined, [
        { skillId: reactId, proficiencyLevel: 'advanced', isPrimary: true },
      ])
      await handle.db
        .update(talentProfiles)
        .set({ verificationStatus: 'verified' })
        .where(eq(talentProfiles.id, talentId))
    })

    it('keeps the same profile id', async () => {
      const again = await repo.save({ userId, bio: 'Updated bio' }, talentId, undefined)

      expect(again).toBe(talentId)
      expect((await profile(talentId))?.bio).toBe('Updated bio')
    })

    /**
     * Verification comes from CV parsing. Editing a bio is not grounds to
     * revoke it, and resetting it dropped the talent out of matching and the
     * directory at once.
     */
    it('never revokes verification on an edit', async () => {
      await repo.save({ userId, bio: 'Updated bio' }, talentId, undefined)

      expect((await profile(talentId))?.verificationStatus).toBe('verified')
    })

    /** An absent list means unchanged, not "this talent has no skills". */
    it('leaves the skills alone when none were supplied', async () => {
      await repo.save({ userId, bio: 'Updated bio' }, talentId, undefined)

      expect(await storedSkills(talentId)).toEqual([{ skillId: reactId, isPrimary: true }])
    })

    it('replaces the whole set when a list is supplied', async () => {
      await repo.save({ userId }, talentId, [
        { skillId: goId, proficiencyLevel: 'expert', isPrimary: true },
      ])

      expect(await storedSkills(talentId)).toEqual([{ skillId: goId, isPrimary: true }])
    })

    /** An explicitly empty list is a real instruction: remove them all. */
    it('clears the set for an empty list', async () => {
      await repo.save({ userId }, talentId, [])

      expect(await storedSkills(talentId)).toEqual([])
    })

    it('tolerates the same skill twice in one request', async () => {
      await repo.save({ userId }, talentId, [
        { skillId: goId, proficiencyLevel: 'expert', isPrimary: true },
        { skillId: goId, proficiencyLevel: 'beginner', isPrimary: false },
      ])

      expect(await storedSkills(talentId)).toHaveLength(1)
    })

    /**
     * The failure the transaction exists for. An unknown skill fails the skill
     * insert, which runs after the profile write and after the delete that
     * cleared the old rows. If either survives, the talent is left unmatchable
     * for work they can do and nothing anywhere says so.
     */
    it('restores the skills when the new set cannot be written', async () => {
      await expect(
        repo.save({ userId, bio: 'Should not persist' }, talentId, [
          { skillId: uuidv7(), proficiencyLevel: 'expert', isPrimary: true },
        ]),
      ).rejects.toThrow()

      expect(await storedSkills(talentId)).toEqual([{ skillId: reactId, isPrimary: true }])
      expect((await profile(talentId))?.bio).toBe('Original bio')
    })

    it('publishes nothing when the write is rolled back', async () => {
      const before = await handle.db.select({ id: outboxEvents.id }).from(outboxEvents)

      await expect(
        repo.save({ userId }, talentId, [
          { skillId: uuidv7(), proficiencyLevel: 'expert', isPrimary: true },
        ]),
      ).rejects.toThrow()

      expect(await handle.db.select({ id: outboxEvents.id }).from(outboxEvents)).toHaveLength(
        before.length,
      )
    })
  })
})
