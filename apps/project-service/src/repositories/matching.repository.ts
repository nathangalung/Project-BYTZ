import type { Database } from '@kerjacus/db'
import { skills, talentProfiles, talentSkills } from '@kerjacus/db'
import { and, eq, inArray } from 'drizzle-orm'

type TalentProfileSelect = typeof talentProfiles.$inferSelect

export type EligibleTalent = Pick<
  TalentProfileSelect,
  | 'id'
  | 'userId'
  | 'totalProjectsCompleted'
  | 'totalProjectsActive'
  | 'averageRating'
  | 'pemerataanPenalty'
>

export type TalentSkillRow = {
  talentId: string
  skillName: string
}

export class MatchingRepository {
  constructor(private db: Database) {}

  async findEligibleTalents(excludeTalentIds: string[] = []): Promise<EligibleTalent[]> {
    const talents = await this.db
      .select({
        id: talentProfiles.id,
        userId: talentProfiles.userId,
        totalProjectsCompleted: talentProfiles.totalProjectsCompleted,
        totalProjectsActive: talentProfiles.totalProjectsActive,
        averageRating: talentProfiles.averageRating,
        pemerataanPenalty: talentProfiles.pemerataanPenalty,
      })
      .from(talentProfiles)
      .where(
        and(
          eq(talentProfiles.verificationStatus, 'verified'),
          eq(talentProfiles.availabilityStatus, 'available'),
        ),
      )

    if (excludeTalentIds.length === 0) {
      return talents
    }
    return talents.filter((w) => !excludeTalentIds.includes(w.id))
  }

  async getTalentSkills(talentIds: string[]): Promise<TalentSkillRow[]> {
    if (talentIds.length === 0) return []

    return await this.db
      .select({
        talentId: talentSkills.talentId,
        skillName: skills.name,
      })
      .from(talentSkills)
      .innerJoin(skills, eq(talentSkills.skillId, skills.id))
      .where(inArray(talentSkills.talentId, talentIds))
  }
}
