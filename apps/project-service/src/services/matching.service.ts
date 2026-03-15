import { EXPLORATION_RATE, MATCHING_WEIGHTS, NEW_WORKER_DEFAULTS } from '@bytz/shared'
import type { EligibleWorker, MatchingRepository } from '../repositories/matching.repository'

export type WorkerScore = {
  workerId: string
  userId: string
  score: number
  skillMatch: number
  pemerataanScore: number
  trackRecord: number
  rating: number
  isExploration: boolean
}

export type MatchingResult = {
  recommendations: WorkerScore[]
  explorationCount: number
  exploitationCount: number
}

// Compute skill_match (0-1): exact string match, case-insensitive
function computeSkillMatch(workerSkillNames: string[], requiredSkills: string[]): number {
  if (requiredSkills.length === 0) return 0.5

  const normalizedWorkerSkills = workerSkillNames.map((s) => s.toLowerCase())
  const matched = requiredSkills.filter((rs) =>
    normalizedWorkerSkills.includes(rs.toLowerCase()),
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
  if (completedProjects === 0) return NEW_WORKER_DEFAULTS.TRACK_RECORD
  // Simplified: satisfaction rate defaults to 0.8 until reviews are queried
  const satisfactionRate = 0.8
  return onTimeRate * 0.6 + satisfactionRate * 0.4
}

// Compute normalized rating score (0-1)
function computeRatingScore(avgRating: number | null): number {
  if (avgRating === null) return NEW_WORKER_DEFAULTS.RATING
  return (avgRating - 1) / 4
}

function scoreWorker(
  worker: EligibleWorker,
  workerSkillNames: string[],
  requiredSkills: string[],
): WorkerScore {
  const skillMatch = computeSkillMatch(workerSkillNames, requiredSkills)
  const pemerataanScore = computePemerataanScore(
    worker.totalProjectsActive,
    worker.totalProjectsCompleted,
    worker.pemerataanPenalty,
  )
  // On-time rate defaults to 0.8 until historical data is available
  const trackRecord = computeTrackRecord(worker.totalProjectsCompleted, 0.8)
  const rating = computeRatingScore(worker.averageRating)

  const baseScore =
    skillMatch * MATCHING_WEIGHTS.SKILL_MATCH +
    pemerataanScore * MATCHING_WEIGHTS.PEMERATAAN +
    trackRecord * MATCHING_WEIGHTS.TRACK_RECORD +
    rating * MATCHING_WEIGHTS.RATING

  // New worker boost: +0.2 if never completed a project
  const score =
    worker.totalProjectsCompleted === 0
      ? Math.min(1, baseScore + NEW_WORKER_DEFAULTS.PEMERATAAN_BONUS)
      : baseScore

  return {
    workerId: worker.id,
    userId: worker.userId,
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

  async matchWorkersToProject(
    requiredSkills: string[],
    excludeWorkerIds: string[] = [],
    limit: number = 10,
  ): Promise<MatchingResult> {
    const eligibleWorkers = await this.matchingRepo.findEligibleWorkers(excludeWorkerIds)

    if (eligibleWorkers.length === 0) {
      return { recommendations: [], explorationCount: 0, exploitationCount: 0 }
    }

    // Fetch skills for all eligible workers
    const workerIds = eligibleWorkers.map((w) => w.id)
    const allWorkerSkills = await this.matchingRepo.getWorkerSkills(workerIds)

    // Group skills by worker
    const skillsByWorker = new Map<string, string[]>()
    for (const ws of allWorkerSkills) {
      const existing = skillsByWorker.get(ws.workerId) ?? []
      existing.push(ws.skillName)
      skillsByWorker.set(ws.workerId, existing)
    }

    // Score all workers
    const scored: WorkerScore[] = eligibleWorkers.map((worker) => {
      const workerSkillNames = skillsByWorker.get(worker.id) ?? []
      return scoreWorker(worker, workerSkillNames, requiredSkills)
    })

    // Epsilon-greedy: 30% exploration, 70% exploitation
    const explorationSlots = Math.ceil(limit * EXPLORATION_RATE)
    const exploitationSlots = limit - explorationSlots

    // Exploitation: top scored workers with at least some skill match
    const sortedByScore = [...scored].sort((a, b) => b.score - a.score)
    const exploitation = sortedByScore.filter((w) => w.skillMatch > 0).slice(0, exploitationSlots)

    // Exploration: workers with higher pemerataan score (fewer projects)
    // Exclude workers already in exploitation pool
    const exploitationIds = new Set(exploitation.map((w) => w.workerId))
    const explorationPool = scored
      .filter((w) => !exploitationIds.has(w.workerId))
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
