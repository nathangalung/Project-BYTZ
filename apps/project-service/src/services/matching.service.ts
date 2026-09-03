import { EXPLORATION_RATE, MATCHING_WEIGHTS, NEW_TALENT_DEFAULTS } from '@kerjacus/shared'
import type { EligibleTalent, MatchingRepository } from '../repositories/matching.repository'

type TalentScore = {
  talentId: string
  userId: string
  score: number
  skillMatch: number
  pemerataanScore: number
  trackRecord: number
  rating: number
  isExploration: boolean
}

type MatchingResult = {
  recommendations: TalentScore[]
  explorationCount: number
  exploitationCount: number
}

type TalentHistoricalStats = {
  onTimeRate: number
  satisfactionRate: number
}

type EmbeddingScoreFn = (a: string, b: string) => Promise<number>

/**
 * Everything scoring needs that does not depend on which position is being
 * filled. Held so a team project reads it once rather than once per work
 * package - see loadCandidatePool.
 */
type CandidatePool = {
  eligibleTalents: Awaited<ReturnType<MatchingRepository['findEligibleTalents']>>
  skillsByTalent: Map<string, string[]>
  statsMap: Awaited<ReturnType<MatchingRepository['getTalentHistoricalStats']>>
  embeddingScoreFn?: EmbeddingScoreFn
}

const SKILL_MATCH_EXACT = 1
const SKILL_MATCH_FUZZY = 0.9
const SKILL_MATCH_SEMANTIC = 0.8
const JARO_WINKLER_THRESHOLD = 0.85
const EMBEDDING_THRESHOLD = 0.7

// Cosine similarity for equal-length vectors
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

/**
 * Build the embedding score fn from the precomputed skill vector map.
 *
 * An empty map means stage 3 of the cascade does not run, which is a real
 * downgrade rather than a neutral one: skillMatch > 0 is a hard filter on both
 * the exploitation and the exploration pool, so a semantically-equivalent
 * talent ("Golang" against "Go backend") is excluded, not just ranked lower.
 * It used to happen silently - nothing wrote skills.embedding at all - so say
 * so once rather than degrade without a word.
 */
export function buildEmbeddingScoreFn(
  embeddingMap: Map<string, number[]>,
): EmbeddingScoreFn | undefined {
  if (embeddingMap.size === 0) {
    console.warn(
      '[Matching] no skill embeddings; semantic stage disabled. Run the ai-service skill backfill.',
    )
    return undefined
  }
  return async (a: string, b: string) => {
    const va = embeddingMap.get(a.toLowerCase())
    const vb = embeddingMap.get(b.toLowerCase())
    if (!va || !vb) return 0
    return cosineSimilarity(va, vb)
  }
}

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

  // New talent boost: +0.2 only for a talent who has never had a project at
  // all -- none active, none completed. A busy first-timer is not new.
  const isNewTalent = talent.totalProjectsCompleted === 0 && talent.totalProjectsActive === 0
  const score = isNewTalent
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

  /**
   * Everything scoring needs that does not depend on the position being
   * filled: the candidates, their skills, their history, and the skill
   * embeddings.
   *
   * Loaded separately because recommendForPackages needs it once for a whole
   * project rather than once per work package. Only requiredSkills and the
   * reserved set vary between positions, and neither is a reason to re-read
   * every talent and every 1024-float embedding from Postgres again.
   */
  private async loadCandidatePool(excludeTalentIds: string[] = []): Promise<CandidatePool> {
    const eligibleTalents = await this.matchingRepo.findEligibleTalents(excludeTalentIds)

    if (eligibleTalents.length === 0) {
      return { eligibleTalents: [], skillsByTalent: new Map(), statsMap: new Map() }
    }

    const talentIds = eligibleTalents.map((w) => w.id)
    const [allTalentSkills, statsMap] = await Promise.all([
      this.matchingRepo.getTalentSkills(talentIds),
      this.matchingRepo.getTalentHistoricalStats(talentIds),
    ])

    const skillsByTalent = new Map<string, string[]>()
    for (const ws of allTalentSkills) {
      const existing = skillsByTalent.get(ws.talentId) ?? []
      existing.push(ws.skillName)
      skillsByTalent.set(ws.talentId, existing)
    }

    // Auto-wire embedding fn from precomputed skills.embedding when none injected
    let embeddingScoreFn = this.getEmbeddingScore
    if (!embeddingScoreFn) {
      const embMap = await this.matchingRepo.getAllSkillEmbeddings?.()
      if (embMap) {
        embeddingScoreFn = buildEmbeddingScoreFn(embMap)
      }
    }

    return { eligibleTalents, skillsByTalent, statsMap, embeddingScoreFn }
  }

  async matchTalentsToProject(
    requiredSkills: string[],
    excludeTalentIds: string[] = [],
    limit: number = 10,
  ): Promise<MatchingResult> {
    const pool = await this.loadCandidatePool(excludeTalentIds)
    return await this.scorePool(pool, requiredSkills, [], limit)
  }

  /** Score a loaded pool against one position's skills. */
  private async scorePool(
    pool: CandidatePool,
    requiredSkills: string[],
    excludeTalentIds: string[],
    limit: number,
  ): Promise<MatchingResult> {
    const { skillsByTalent, statsMap, embeddingScoreFn } = pool
    // Reserved talents are filtered here rather than re-queried, so a team
    // project loads the pool once instead of once per work package.
    const excluded = new Set(excludeTalentIds)
    const eligibleTalents = excluded.size
      ? pool.eligibleTalents.filter((t) => !excluded.has(t.id))
      : pool.eligibleTalents

    if (eligibleTalents.length === 0) {
      return { recommendations: [], explorationCount: 0, exploitationCount: 0 }
    }

    // Score all talents (async due to embedding cascade)
    const scored: TalentScore[] = await Promise.all(
      eligibleTalents.map((talent) => {
        const talentSkillNames = skillsByTalent.get(talent.id) ?? []
        const stats = statsMap.get(talent.id)
        return scoreTalent(talent, talentSkillNames, requiredSkills, stats, embeddingScoreFn)
      }),
    )

    // Epsilon-greedy: 30% exploration, 70% exploitation
    const explorationSlots = Math.ceil(limit * EXPLORATION_RATE)
    const exploitationSlots = limit - explorationSlots

    // Exploitation: top scored talents with at least some skill match
    const sortedByScore = [...scored].sort((a, b) => b.score - a.score)
    const exploitation = sortedByScore.filter((w) => w.skillMatch > 0).slice(0, exploitationSlots)

    // Exploration favours fewer-project talents, but still needs basic skill
    // overlap -- exploration is not a way in for a zero-match talent.
    const exploitationIds = new Set(exploitation.map((w) => w.talentId))
    const explorationPool = scored
      .filter((w) => !exploitationIds.has(w.talentId) && w.skillMatch > 0)
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

  // Recommend talents for each work package against its own required skills.
  // Greedy: packages are processed in order and each one's top pick is reserved,
  // so the same talent is never the first choice for two positions -- this keeps
  // the suggested assignment disjoint and spreads work across talents. Alternates
  // may still overlap; the caller enforces final one-talent-per-position.
  async recommendForPackages(
    packages: Array<{ workPackageId: string; requiredSkills: string[] }>,
    limit = 5,
  ): Promise<Array<{ workPackageId: string; recommendations: TalentScore[] }>> {
    // One read for the whole project. Each package used to re-run the entire
    // bundle - candidates, their skills, their history, and every skill
    // embedding - when only requiredSkills and the reserved set differ, so an
    // eight-package project did eight full scans serially inside one request.
    const pool = await this.loadCandidatePool()

    const reserved: string[] = []
    const out: Array<{ workPackageId: string; recommendations: TalentScore[] }> = []
    for (const pkg of packages) {
      const result = await this.scorePool(pool, pkg.requiredSkills, reserved, limit)
      const top = result.recommendations[0]
      if (top) reserved.push(top.talentId)
      out.push({ workPackageId: pkg.workPackageId, recommendations: result.recommendations })
    }
    return out
  }
}
