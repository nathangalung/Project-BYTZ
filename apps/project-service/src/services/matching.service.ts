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

export type TalentHistoricalStats = {
  onTimeRate: number
  satisfactionRate: number
}

export type EmbeddingScoreFn = (a: string, b: string) => Promise<number>

const SKILL_MATCH_EXACT = 1
const SKILL_MATCH_FUZZY = 0.9
const SKILL_MATCH_SEMANTIC = 0.8
const JARO_WINKLER_THRESHOLD = 0.85
const EMBEDDING_THRESHOLD = 0.7

// Jaro-Winkler similarity (0-1)
export function jaroWinkler(s1: string, s2: string): number {
  if (s1 === s2) return 1
  if (s1.length === 0 || s2.length === 0) return 0
  const matchDistance = Math.floor(Math.max(s1.length, s2.length) / 2) - 1
  const s1Matches = new Array(s1.length).fill(false)
  const s2Matches = new Array(s2.length).fill(false)
  let matches = 0
  for (let i = 0; i < s1.length; i++) {
    const start = Math.max(0, i - matchDistance)
    const end = Math.min(i + matchDistance + 1, s2.length)
    for (let j = start; j < end; j++) {
      if (s2Matches[j]) continue
      if (s1[i] !== s2[j]) continue
      s1Matches[i] = true
      s2Matches[j] = true
      matches++
      break
    }
  }
  if (matches === 0) return 0
  let transpositions = 0
  let k = 0
  for (let i = 0; i < s1.length; i++) {
    if (!s1Matches[i]) continue
    while (!s2Matches[k]) k++
    if (s1[i] !== s2[k]) transpositions++
    k++
  }
  const jaro =
    (matches / s1.length + matches / s2.length + (matches - transpositions / 2) / matches) / 3
  let prefix = 0
  for (let i = 0; i < Math.min(4, s1.length, s2.length); i++) {
    if (s1[i] === s2[i]) prefix++
    else break
  }
  return jaro + prefix * 0.1 * (1 - jaro)
}

// Fuzzy match cascade for one required skill against talent's skill list.
// Returns best partial score in [0,1].
async function matchOneSkill(
  required: string,
  talentSkills: string[],
  getEmbeddingScore?: EmbeddingScoreFn,
): Promise<number> {
  const requiredLower = required.toLowerCase()
  const normalized = talentSkills.map((s) => s.toLowerCase())

  // Stage 1: exact match (case-insensitive)
  if (normalized.includes(requiredLower)) return SKILL_MATCH_EXACT

  // Stage 2: Jaro-Winkler similarity
  let bestJw = 0
  for (const ts of normalized) {
    const score = jaroWinkler(requiredLower, ts)
    if (score > bestJw) bestJw = score
  }
  if (bestJw > JARO_WINKLER_THRESHOLD) return SKILL_MATCH_FUZZY

  // Stage 3: embedding similarity (optional)
  if (getEmbeddingScore) {
    let bestEmb = 0
    for (const ts of normalized) {
      const score = await getEmbeddingScore(requiredLower, ts)
      if (score > bestEmb) bestEmb = score
    }
    if (bestEmb > EMBEDDING_THRESHOLD) return SKILL_MATCH_SEMANTIC
  }

  return 0
}

// Compute skill_match (0-1) via fuzzy cascade: exact -> Jaro-Winkler -> embedding.
export async function computeSkillMatch(
  talentSkillNames: string[],
  requiredSkills: string[],
  getEmbeddingScore?: EmbeddingScoreFn,
): Promise<number> {
  if (requiredSkills.length === 0) return 0.5

  let total = 0
  for (const rs of requiredSkills) {
    total += await matchOneSkill(rs, talentSkillNames, getEmbeddingScore)
  }
  return total / requiredSkills.length
}

// Compute pemerataan_skor (0-1): inversely proportional to active/total projects
export function computePemerataanScore(
  activeProjects: number,
  completedProjects: number,
  penalty: number,
): number {
  const raw = 1 / (1 + activeProjects * 2 + completedProjects * 0.1 + penalty)
  return Math.min(1, raw)
}

// Compute track_record (0-1) from real historical stats.
export function computeTrackRecord(stats: {
  onTimeRate?: number
  satisfactionRate?: number
  completedProjects: number
}): number {
  if (stats.completedProjects === 0) return NEW_TALENT_DEFAULTS.TRACK_RECORD
  const onTimeRate = stats.onTimeRate ?? 0.8
  const satisfactionRate = stats.satisfactionRate ?? 0.8
  return onTimeRate * 0.6 + satisfactionRate * 0.4
}

// Compute normalized rating score (0-1)
export function computeRatingScore(avgRating: number | null): number {
  if (avgRating === null) return NEW_TALENT_DEFAULTS.RATING
  return (avgRating - 1) / 4
}

async function scoreTalent(
  talent: EligibleTalent,
  talentSkillNames: string[],
  requiredSkills: string[],
  stats: TalentHistoricalStats | undefined,
  getEmbeddingScore?: EmbeddingScoreFn,
): Promise<TalentScore> {
  const skillMatch = await computeSkillMatch(talentSkillNames, requiredSkills, getEmbeddingScore)
  const pemerataanScore = computePemerataanScore(
    talent.totalProjectsActive,
    talent.totalProjectsCompleted,
    talent.pemerataanPenalty,
  )
  const trackRecord = computeTrackRecord({
    onTimeRate: stats?.onTimeRate,
    satisfactionRate: stats?.satisfactionRate,
    completedProjects: talent.totalProjectsCompleted,
  })
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
  constructor(
    private matchingRepo: MatchingRepository,
    private getEmbeddingScore?: EmbeddingScoreFn,
  ) {}

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

    // Fetch historical stats (on-time, satisfaction) for all eligible talents
    const statsMap = await this.matchingRepo.getTalentHistoricalStats(talentIds)

    // Group skills by talent
    const skillsByTalent = new Map<string, string[]>()
    for (const ws of allTalentSkills) {
      const existing = skillsByTalent.get(ws.talentId) ?? []
      existing.push(ws.skillName)
      skillsByTalent.set(ws.talentId, existing)
    }

    // Score all talents (async due to embedding cascade)
    const scored: TalentScore[] = await Promise.all(
      eligibleTalents.map((talent) => {
        const talentSkillNames = skillsByTalent.get(talent.id) ?? []
        const stats = statsMap.get(talent.id)
        return scoreTalent(talent, talentSkillNames, requiredSkills, stats, this.getEmbeddingScore)
      }),
    )

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
