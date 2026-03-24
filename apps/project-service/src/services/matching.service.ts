import { EXPLORATION_RATE, MATCHING_WEIGHTS, NEW_TALENT_DEFAULTS } from '@kerjacus/shared'
import type { EligibleTalent, MatchingRepository } from '../repositories/matching.repository'

export type TalentScore = {
  talentId: string
  userId: string
  score: number
  skillMatch: number
  pemerataanScore: number
  trackRecord: number
  rating: number
  isExploration: boolean
}

export type MatchingResult = {
  recommendations: TalentScore[]
  explorationCount: number
  exploitationCount: number
}

// Compute skill_match (0-1): exact string match, case-insensitive
function computeSkillMatch(talentSkillNames: string[], requiredSkills: string[]): number {
  if (requiredSkills.length === 0) return 0.5

  const normalizedTalentSkills = talentSkillNames.map((s) => s.toLowerCase())
  const matched = requiredSkills.filter((rs) =>
    normalizedTalentSkills.includes(rs.toLowerCase()),
  ).length

  return matched / requiredSkills.length
}

// Compute pemerataan_skor (0-1): inversely proportional to active/total projects
function computePemerataanScore(
  activeProjects: number,
  completedProjects: number,
  penalty: number,
): number {
  const raw = 1 / (1 + activeProjects * 2 + completedProjects * 0.1 + penalty)
  return Math.min(1, raw)
}

// Compute track_record (0-1): on-time rate and satisfaction
function computeTrackRecord(completedProjects: number, onTimeRate: number): number {
  if (completedProjects === 0) return NEW_TALENT_DEFAULTS.TRACK_RECORD
  // Simplified: satisfaction rate defaults to 0.8 until reviews are queried
  const satisfactionRate = 0.8
  return onTimeRate * 0.6 + satisfactionRate * 0.4
}

// Compute normalized rating score (0-1)
function computeRatingScore(avgRating: number | null): number {
  if (avgRating === null) return NEW_TALENT_DEFAULTS.RATING
  return (avgRating - 1) / 4
}

function scoreTalent(
  talent: EligibleTalent,
  talentSkillNames: string[],
  requiredSkills: string[],
): TalentScore {
  const skillMatch = computeSkillMatch(talentSkillNames, requiredSkills)
  const pemerataanScore = computePemerataanScore(
    talent.totalProjectsActive,
    talent.totalProjectsCompleted,
    talent.pemerataanPenalty,
  )
  // On-time rate defaults to 0.8 until historical data is available
  const trackRecord = computeTrackRecord(talent.totalProjectsCompleted, 0.8)
  const rating = computeRatingScore(talent.averageRating)

  const baseScore =
    skillMatch * MATCHING_WEIGHTS.SKILL_MATCH +
    pemerataanScore * MATCHING_WEIGHTS.PEMERATAAN +
    trackRecord * MATCHING_WEIGHTS.TRACK_RECORD +
    rating * MATCHING_WEIGHTS.RATING

  // New talent boost: +0.2 if never completed a project
  const score =
    talent.totalProjectsCompleted === 0
      ? Math.min(1, baseScore + NEW_TALENT_DEFAULTS.PEMERATAAN_BONUS)
      : baseScore

  return {
    talentId: talent.id,
    userId: talent.userId,
    score,
    skillMatch,
    pemerataanScore,
    trackRecord,
    rating,
    isExploration: false,
  }
}

export class MatchingService {
  constructor(private matchingRepo: MatchingRepository) {}

  async matchTalentsToProject(
    requiredSkills: string[],
    excludeTalentIds: string[] = [],
    limit: number = 10,
  ): Promise<MatchingResult> {
    const eligibleTalents = await this.matchingRepo.findEligibleTalents(excludeTalentIds)

    if (eligibleTalents.length === 0) {
      return { recommendations: [], explorationCount: 0, exploitationCount: 0 }
    }

    // Fetch skills for all eligible talents
    const talentIds = eligibleTalents.map((w) => w.id)
    const allTalentSkills = await this.matchingRepo.getTalentSkills(talentIds)

    // Group skills by talent
    const skillsByTalent = new Map<string, string[]>()
    for (const ws of allTalentSkills) {
      const existing = skillsByTalent.get(ws.talentId) ?? []
      existing.push(ws.skillName)
      skillsByTalent.set(ws.talentId, existing)
    }

    // Score all talents
    const scored: TalentScore[] = eligibleTalents.map((talent) => {
      const talentSkillNames = skillsByTalent.get(talent.id) ?? []
      return scoreTalent(talent, talentSkillNames, requiredSkills)
    })

    // Epsilon-greedy: 30% exploration, 70% exploitation
    const explorationSlots = Math.ceil(limit * EXPLORATION_RATE)
    const exploitationSlots = limit - explorationSlots

    // Exploitation: top scored talents with at least some skill match
    const sortedByScore = [...scored].sort((a, b) => b.score - a.score)
    const exploitation = sortedByScore.filter((w) => w.skillMatch > 0).slice(0, exploitationSlots)

    // Exploration: talents with higher pemerataan score (fewer projects)
    // Exclude talents already in exploitation pool
    const exploitationIds = new Set(exploitation.map((w) => w.talentId))
    const explorationPool = scored
      .filter((w) => !exploitationIds.has(w.talentId))
      .sort((a, b) => b.pemerataanScore - a.pemerataanScore)

    const exploration = explorationPool
      .slice(0, explorationSlots)
      .map((w) => ({ ...w, isExploration: true }))

    const recommendations = [...exploitation, ...exploration].slice(0, limit)

    return {
      recommendations,
      explorationCount: exploration.length,
      exploitationCount: exploitation.length,
    }
  }
}
