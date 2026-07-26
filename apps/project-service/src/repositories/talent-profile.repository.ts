import { type Database, talentProfiles, talentSkills } from '@kerjacus/db'
import { eq } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { appendOutboxEvent } from '../lib/outbox'

type ProfileInput = {
  userId: string
  bio?: string | null
  location?: string | null
  yearsOfExperience?: number
  educationUniversity?: string | null
  educationMajor?: string | null
  educationYear?: number | null
  portfolioLinks?: unknown
  domainExpertise?: unknown
}

type SkillInput = {
  skillId: string
  proficiencyLevel: 'beginner' | 'intermediate' | 'advanced' | 'expert'
  isPrimary: boolean
}

export class TalentProfileRepository {
  constructor(private db: Database) {}

  async findByUserId(userId: string): Promise<{ id: string } | undefined> {
    const [profile] = await this.db
      .select({ id: talentProfiles.id })
      .from(talentProfiles)
      .where(eq(talentProfiles.userId, userId))
      .limit(1)
    return profile
  }

  /**
   * Save a profile and its skills together.
   *
   * The skills were replaced by deleting every row and re-inserting them one
   * at a time, outside any transaction. A failure partway through left a
   * talent whose skills had been deleted and only partly restored - and
   * skills are what findEligibleTalents filters on, so the talent quietly
   * stopped being matchable for work they can do, with nothing to show it
   * had happened. Re-saving the profile was the only repair, and nobody
   * would know to try.
   *
   * The taxonomy lookup stays outside: it reads the skills table and can
   * miss, and holding a write transaction open across those reads would keep
   * a lock for the whole resolution.
   */
  async save(
    input: ProfileInput,
    existingId: string | undefined,
    skills: SkillInput[] | undefined,
  ): Promise<string> {
    const profileId = existingId ?? uuidv7()

    await this.db.transaction(async (tx) => {
      if (existingId) {
        await tx
          .update(talentProfiles)
          .set({ ...input, updatedAt: new Date() })
          .where(eq(talentProfiles.id, existingId))
      } else {
        await tx.insert(talentProfiles).values({
          ...input,
          id: profileId,
          verificationStatus: 'unverified',
        } as never)
      }

      // Only touch the skill rows when the caller supplied a set. An absent
      // list means "unchanged", not "the talent has no skills".
      if (skills) {
        await tx.delete(talentSkills).where(eq(talentSkills.talentId, profileId))
        if (skills.length > 0) {
          await tx
            .insert(talentSkills)
            .values(skills.map((s) => ({ ...s, talentId: profileId })))
            .onConflictDoNothing()
        }
      }

      await appendOutboxEvent(tx, {
        aggregateType: 'talent',
        aggregateId: profileId,
        eventType: 'talent.registered',
        payload: { talentId: profileId, userId: input.userId },
      })
    })

    return profileId
  }
}
