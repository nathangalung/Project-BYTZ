import type { Database } from '@kerjacus/db'
import {
  milestones,
  projectAssignments,
  reviews,
  skills,
  talentProfiles,
  talentSkills,
} from '@kerjacus/db'
import { and, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm'

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

export type TalentHistoricalStats = {
  onTimeRate: number
  satisfactionRate: number
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

  // Canonical skill embeddings keyed by lowercased name and aliases.
  // Returns empty map if no embeddings populated (cascade Stage 3 then skips).
  async getAllSkillEmbeddings(): Promise<Map<string, number[]>> {
    const rows = await this.db
      .select({
        name: skills.name,
        aliases: skills.aliases,
        embedding: skills.embedding,
      })
      .from(skills)
      .where(isNotNull(skills.embedding))

    const map = new Map<string, number[]>()
    for (const row of rows) {
      if (!row.embedding) continue
      const vector = row.embedding as number[]
      map.set(row.name.toLowerCase(), vector)

      const aliases = row.aliases as string[] | null
      if (Array.isArray(aliases)) {
        for (const alias of aliases) {
          if (typeof alias === 'string' && alias.length > 0) {
            map.set(alias.toLowerCase(), vector)
          }
        }
      }
    }
    return map
  }

  // Returns per-talent on-time rate and satisfaction rate.
  // - onTimeRate: ratio of approved milestones submitted on/before due_date.
  // - satisfactionRate: avg(rating)/5 for owner_to_talent reviews of the talent's user.
  // Talents with no completed milestones AND no reviews are omitted (caller uses NEW_TALENT_DEFAULTS).
  async getTalentHistoricalStats(talentIds: string[]): Promise<Map<string, TalentHistoricalStats>> {
    const result = new Map<string, TalentHistoricalStats>()
    if (talentIds.length === 0) return result

    // On-time rate from milestones table
    const milestoneRows = await this.db
      .select({
        talentId: milestones.assignedTalentId,
        completedCount: sql<number>`count(*)`.as('completed_count'),
        onTimeCount:
          sql<number>`sum(case when ${milestones.submittedAt} is not null and ${milestones.submittedAt} <= ${milestones.dueDate} then 1 else 0 end)`.as(
            'on_time_count',
          ),
      })
      .from(milestones)
      .where(
        and(inArray(milestones.assignedTalentId, talentIds), eq(milestones.status, 'approved')),
      )
      .groupBy(milestones.assignedTalentId)

    const onTimeByTalent = new Map<string, number>()
    for (const row of milestoneRows) {
      if (!row.talentId) continue
      const total = Number(row.completedCount) || 0
      const onTime = Number(row.onTimeCount) || 0
      if (total > 0) {
        onTimeByTalent.set(row.talentId, onTime / total)
      }
    }

    // Satisfaction rate from reviews — join via talent_profiles.userId == reviews.revieweeId
    const reviewRows = await this.db
      .select({
        talentId: talentProfiles.id,
        avgRating: sql<number>`avg(${reviews.rating})`.as('avg_rating'),
        reviewCount: sql<number>`count(*)`.as('review_count'),
      })
      .from(reviews)
      .innerJoin(talentProfiles, eq(reviews.revieweeId, talentProfiles.userId))
      .where(and(inArray(talentProfiles.id, talentIds), eq(reviews.type, 'owner_to_talent')))
      .groupBy(talentProfiles.id)

    const satisfactionByTalent = new Map<string, number>()
    for (const row of reviewRows) {
      const count = Number(row.reviewCount) || 0
      if (count > 0) {
        const avg = Number(row.avgRating) || 0
        satisfactionByTalent.set(row.talentId, avg / 5)
      }
    }

    // Merge: only include talents with at least one signal
    const allIds = new Set([...onTimeByTalent.keys(), ...satisfactionByTalent.keys()])
    for (const id of allIds) {
      result.set(id, {
        onTimeRate: onTimeByTalent.get(id) ?? 0.8,
        satisfactionRate: satisfactionByTalent.get(id) ?? 0.8,
      })
    }
    return result
  }

  // Increment pemerataan_penalty by delta, capped at 5.0
  async incrementPemerataanPenalty(talentId: string, delta: number): Promise<void> {
    await this.db
      .update(talentProfiles)
      .set({
        pemerataanPenalty: sql`LEAST(${talentProfiles.pemerataanPenalty} + ${delta}, 5.0)`,
        updatedAt: new Date(),
      })
      .where(eq(talentProfiles.id, talentId))
  }

  // Find active assignments where talent has no time_logs in the last N days.
  // Returns one row per assignment (talent may have multiple active assignments).
  async findInactiveTalents(
    days: number,
  ): Promise<{ talentId: string; projectId: string; assignmentId: string; lastActivity: Date }[]> {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

    const rows = await this.db.execute(sql`
      SELECT
        pa.id AS assignment_id,
        pa.talent_id AS talent_id,
        pa.project_id AS project_id,
        COALESCE(
          (
            SELECT MAX(tl.started_at)
            FROM time_logs tl
            JOIN tasks t ON t.id = tl.task_id
            JOIN milestones m ON m.id = t.milestone_id
            WHERE m.project_id = pa.project_id
            AND tl.talent_id = pa.talent_id
          ),
          pa.created_at
        ) AS last_activity
      FROM project_assignments pa
      WHERE pa.status = 'active'
      AND NOT EXISTS (
        SELECT 1 FROM time_logs tl
        JOIN tasks t ON t.id = tl.task_id
        JOIN milestones m ON m.id = t.milestone_id
        WHERE m.project_id = pa.project_id
        AND tl.talent_id = pa.talent_id
        AND tl.started_at > ${cutoff}
      )
      AND NOT EXISTS (
        SELECT 1 FROM milestones m2
        WHERE m2.project_id = pa.project_id
        AND m2.assigned_talent_id = pa.talent_id
        AND m2.updated_at > ${cutoff}
      )
      AND pa.created_at < ${cutoff}
    `)

    const result: {
      talentId: string
      projectId: string
      assignmentId: string
      lastActivity: Date
    }[] = []
    for (const row of rows as unknown as Array<Record<string, unknown>>) {
      const r = row as {
        talent_id: string
        project_id: string
        assignment_id: string
        last_activity: string | Date
      }
      result.push({
        talentId: r.talent_id,
        projectId: r.project_id,
        assignmentId: r.assignment_id,
        lastActivity: r.last_activity instanceof Date ? r.last_activity : new Date(r.last_activity),
      })
    }
    return result
  }

  // Find assignments terminated within last N hours. Uses completed_at as the
  // termination timestamp (set when status transitions to a terminal state).
  async findRecentAbandons(
    hoursAgo: number,
  ): Promise<{ talentId: string; assignmentId: string }[]> {
    const cutoff = new Date(Date.now() - hoursAgo * 60 * 60 * 1000)

    const rows = await this.db
      .select({
        assignmentId: projectAssignments.id,
        talentId: projectAssignments.talentId,
      })
      .from(projectAssignments)
      .where(
        and(
          eq(projectAssignments.status, 'terminated'),
          gte(projectAssignments.completedAt, cutoff),
        ),
      )

    return rows
  }
}
