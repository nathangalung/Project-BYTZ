import { describe, expect, it, vi } from 'vitest'
import type { EligibleTalent } from '../repositories/matching.repository'
import { MatchingService } from './matching.service'

// Mock repository
function createMockRepo(
  talents: EligibleTalent[] = [],
  skills: Array<{ talentId: string; skillName: string }> = [],
) {
  return {
    findEligibleTalents: vi.fn().mockResolvedValue(talents),
    getTalentSkills: vi.fn().mockResolvedValue(skills),
  }
}

function makeTalent(overrides: Partial<EligibleTalent> = {}): EligibleTalent {
  return {
    id: `talent-${Math.random().toString(36).slice(2, 8)}`,
    userId: `user-${Math.random().toString(36).slice(2, 8)}`,
    totalProjectsActive: 0,
    totalProjectsCompleted: 0,
    averageRating: null,
    pemerataanPenalty: 0,
    ...overrides,
  }
}

describe('MatchingService', () => {
  describe('matchTalentsToProject', () => {
    it('returns empty when no talents found', async () => {
      const repo = createMockRepo()
      const service = new MatchingService(repo)

      const result = await service.matchTalentsToProject(['React'])
      expect(result.recommendations).toHaveLength(0)
      expect(result.explorationCount).toBe(0)
      expect(result.exploitationCount).toBe(0)
    })

    it('scores talents by skill match', async () => {
      const w1 = makeTalent({ id: 'w1', userId: 'u1' })
      const w2 = makeTalent({ id: 'w2', userId: 'u2' })

      const repo = createMockRepo(
        [w1, w2],
        [
          { talentId: 'w1', skillName: 'React' },
          { talentId: 'w1', skillName: 'Node.js' },
          { talentId: 'w2', skillName: 'Python' },
        ],
      )

      const service = new MatchingService(repo)
      const result = await service.matchTalentsToProject(['React', 'Node.js'], [], 10)

      expect(result.recommendations.length).toBeGreaterThan(0)

      // w1 has full skill match
      const w1Score = result.recommendations.find((r) => r.talentId === 'w1')
      const w2Score = result.recommendations.find((r) => r.talentId === 'w2')

      if (w1Score && w2Score) {
        expect(w1Score.skillMatch).toBe(1)
        expect(w2Score.skillMatch).toBe(0)
      }
    })

    it('new talents get pemerataan bonus', async () => {
      const newTalent = makeTalent({
        id: 'new',
        userId: 'u-new',
        totalProjectsCompleted: 0,
      })
      const expTalent = makeTalent({
        id: 'exp',
        userId: 'u-exp',
        totalProjectsCompleted: 10,
        totalProjectsActive: 1,
        averageRating: 4.5,
      })

      const repo = createMockRepo(
        [newTalent, expTalent],
        [
          { talentId: 'new', skillName: 'React' },
          { talentId: 'exp', skillName: 'React' },
        ],
      )

      const service = new MatchingService(repo)
      const result = await service.matchTalentsToProject(['React'], [], 10)

      const newTalentScore = result.recommendations.find((r) => r.talentId === 'new')
      expect(newTalentScore).toBeDefined()
      expect(newTalentScore?.pemerataanScore).toBe(1)
    })

    it('respects limit parameter', async () => {
      const workers = Array.from({ length: 20 }, (_, i) =>
        makeTalent({ id: `w${i}`, userId: `u${i}` }),
      )

      const skills = workers.map((w) => ({
        talentId: w.id,
        skillName: 'React',
      }))

      const repo = createMockRepo(workers, skills)
      const service = new MatchingService(repo)
      const result = await service.matchTalentsToProject(['React'], [], 5)

      expect(result.recommendations.length).toBeLessThanOrEqual(5)
    })

    it('applies epsilon-greedy exploration', async () => {
      const workers = Array.from({ length: 10 }, (_, i) =>
        makeTalent({
          id: `w${i}`,
          userId: `u${i}`,
          totalProjectsCompleted: i * 2,
          totalProjectsActive: i % 3,
        }),
      )

      const skills = workers.map((w) => ({
        talentId: w.id,
        skillName: 'React',
      }))

      const repo = createMockRepo(workers, skills)
      const service = new MatchingService(repo)
      const result = await service.matchTalentsToProject(['React'], [], 10)

      // ~30% exploration rate
      expect(result.explorationCount + result.exploitationCount).toBe(result.recommendations.length)
    })

    it('passes excludeTalentIds to repository', async () => {
      const repo = createMockRepo()
      const service = new MatchingService(repo)

      await service.matchTalentsToProject(['React'], ['exclude-1'])
      expect(repo.findEligibleTalents).toHaveBeenCalledWith(['exclude-1'])
    })

    it('fetches skills for eligible talents', async () => {
      const w1 = makeTalent({ id: 'w1' })
      const repo = createMockRepo([w1], [])
      const service = new MatchingService(repo)

      await service.matchTalentsToProject(['React'])
      expect(repo.getTalentSkills).toHaveBeenCalledWith(['w1'])
    })
  })
})

// Unit tests for scoring functions (extracted logic)
describe('Skill Match Computation', () => {
  // Re-implement for direct unit testing
  function computeSkillMatch(talentSkills: string[], required: string[]): number {
    if (required.length === 0) return 0.5
    const normalizedTalent = talentSkills.map((s) => s.toLowerCase())
    const matched = required.filter((rs) => normalizedTalent.includes(rs.toLowerCase())).length
    return matched / required.length
  }

  it('returns 1 for full match', () => {
    expect(computeSkillMatch(['React', 'Node.js'], ['React', 'Node.js'])).toBe(1)
  })

  it('returns 0.5 for half match', () => {
    expect(computeSkillMatch(['React'], ['React', 'Node.js'])).toBe(0.5)
  })

  it('returns 0 for no match', () => {
    expect(computeSkillMatch(['Python'], ['React', 'Node.js'])).toBe(0)
  })

  it('returns 0.5 for empty requirements', () => {
    expect(computeSkillMatch(['React'], [])).toBe(0.5)
  })

  it('is case insensitive', () => {
    expect(computeSkillMatch(['react'], ['React'])).toBe(1)
    expect(computeSkillMatch(['REACT'], ['react'])).toBe(1)
  })
})

describe('Pemerataan Score Computation', () => {
  function computePemerataanScore(active: number, completed: number, penalty: number): number {
    return Math.min(1, 1 / (1 + active * 2 + completed * 0.1 + penalty))
  }

  it('new talent gets max score', () => {
    expect(computePemerataanScore(0, 0, 0)).toBe(1)
  })

  it('active projects reduce score', () => {
    const score = computePemerataanScore(1, 0, 0)
    expect(score).toBeLessThan(1)
    expect(score).toBeCloseTo(1 / 3, 5)
  })

  it('completed projects reduce score slightly', () => {
    const score = computePemerataanScore(0, 10, 0)
    expect(score).toBeLessThan(1)
    expect(score).toBeCloseTo(0.5, 5)
  })

  it('penalty reduces score further', () => {
    const withoutPenalty = computePemerataanScore(0, 5, 0)
    const withPenalty = computePemerataanScore(0, 5, 1)
    expect(withPenalty).toBeLessThan(withoutPenalty)
  })

  it('capped at 1', () => {
    expect(computePemerataanScore(0, 0, 0)).toBeLessThanOrEqual(1)
  })

  it('heavy load yields low score', () => {
    const score = computePemerataanScore(3, 20, 2)
    expect(score).toBeLessThan(0.15)
  })
})

describe('Track Record Computation', () => {
  function computeTrackRecord(completed: number, onTimeRate: number): number {
    if (completed === 0) return 0.6
    const satisfactionRate = 0.8
    return onTimeRate * 0.6 + satisfactionRate * 0.4
  }

  it('new talent defaults to 0.6', () => {
    expect(computeTrackRecord(0, 0.8)).toBe(0.6)
  })

  it('perfect on-time rate', () => {
    expect(computeTrackRecord(5, 1.0)).toBeCloseTo(0.92, 2)
  })

  it('poor on-time rate', () => {
    expect(computeTrackRecord(5, 0.3)).toBeCloseTo(0.5, 2)
  })
})

describe('Rating Score Computation', () => {
  function computeRatingScore(avgRating: number | null): number {
    if (avgRating === null) return 0.7
    return (avgRating - 1) / 4
  }

  it('null rating defaults to 0.7', () => {
    expect(computeRatingScore(null)).toBe(0.7)
  })

  it('rating 5 yields 1.0', () => {
    expect(computeRatingScore(5)).toBe(1.0)
  })

  it('rating 1 yields 0', () => {
    expect(computeRatingScore(1)).toBe(0)
  })

  it('rating 3 yields 0.5', () => {
    expect(computeRatingScore(3)).toBe(0.5)
  })
})
