import { describe, expect, it, vi } from 'vitest'
import type {
  EligibleTalent,
  MatchingRepository,
  TalentHistoricalStats,
} from '../repositories/matching.repository'
import {
  buildEmbeddingScoreFn,
  computePemerataanScore,
  computeRatingScore,
  computeSkillMatch,
  computeTrackRecord,
  cosineSimilarity,
  jaroWinkler,
  MatchingService,
} from './matching.service'

// Mock repository — cast as MatchingRepository for DI
function createMockRepo(
  talents: EligibleTalent[] = [],
  skills: Array<{ talentId: string; skillName: string }> = [],
  stats: Map<string, TalentHistoricalStats> = new Map(),
  embeddingMap?: Map<string, number[]>,
): MatchingRepository {
  const base: Partial<MatchingRepository> = {
    findEligibleTalents: vi.fn().mockResolvedValue(talents),
    getTalentSkills: vi.fn().mockResolvedValue(skills),
    getTalentHistoricalStats: vi.fn().mockResolvedValue(stats),
  }
  if (embeddingMap !== undefined) {
    base.getAllSkillEmbeddings = vi.fn().mockResolvedValue(embeddingMap)
  }
  return base as unknown as MatchingRepository
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

    it('fetches historical stats for eligible talents', async () => {
      const w1 = makeTalent({ id: 'w1' })
      const repo = createMockRepo([w1], [])
      const service = new MatchingService(repo)

      await service.matchTalentsToProject(['React'])
      expect(repo.getTalentHistoricalStats).toHaveBeenCalledWith(['w1'])
    })

    it('uses real on-time and satisfaction rates from stats', async () => {
      const w1 = makeTalent({ id: 'w1', userId: 'u1', totalProjectsCompleted: 5 })
      const stats = new Map<string, TalentHistoricalStats>([
        ['w1', { onTimeRate: 1.0, satisfactionRate: 1.0 }],
      ])
      const repo = createMockRepo([w1], [{ talentId: 'w1', skillName: 'React' }], stats)
      const service = new MatchingService(repo)
      const result = await service.matchTalentsToProject(['React'], [], 10)
      const score = result.recommendations.find((r) => r.talentId === 'w1')
      expect(score?.trackRecord).toBe(1) // 1.0 * 0.6 + 1.0 * 0.4
    })

    it('matches skills with fuzzy similarity (React.js ~ React)', async () => {
      const w1 = makeTalent({ id: 'w1', userId: 'u1' })
      const repo = createMockRepo([w1], [{ talentId: 'w1', skillName: 'React.js' }])
      const service = new MatchingService(repo)
      const result = await service.matchTalentsToProject(['React'], [], 10)
      const score = result.recommendations.find((r) => r.talentId === 'w1')
      expect(score).toBeDefined()
      // Jaro-Winkler match -> SKILL_MATCH_FUZZY = 0.9
      expect(score?.skillMatch).toBeGreaterThanOrEqual(0.9)
    })

    it('uses embedding fallback when provided', async () => {
      const w1 = makeTalent({ id: 'w1', userId: 'u1' })
      const repo = createMockRepo([w1], [{ talentId: 'w1', skillName: 'Vue' }])
      // Embedding stub returns high similarity for any pair
      const getEmbedding = vi.fn().mockResolvedValue(0.9)
      const service = new MatchingService(repo, getEmbedding)
      const result = await service.matchTalentsToProject(['React'], [], 10)
      const score = result.recommendations.find((r) => r.talentId === 'w1')
      expect(score?.skillMatch).toBeGreaterThanOrEqual(0.8)
      expect(getEmbedding).toHaveBeenCalled()
    })

    it('auto-wires embedding fn from repo when none injected', async () => {
      const w1 = makeTalent({ id: 'w1', userId: 'u1' })
      // React and Vue have high cosine similarity via precomputed vectors
      const reactVec = [1, 0, 0.5]
      const vueVec = [0.9, 0.1, 0.5]
      const embMap = new Map<string, number[]>([
        ['react', reactVec],
        ['vue', vueVec],
      ])
      const repo = createMockRepo([w1], [{ talentId: 'w1', skillName: 'Vue' }], new Map(), embMap)
      const service = new MatchingService(repo)
      const result = await service.matchTalentsToProject(['React'], [], 10)
      // Embedding cascade should fire since JW('react','vue') < threshold
      expect(repo.getAllSkillEmbeddings).toHaveBeenCalled()
      const score = result.recommendations.find((r) => r.talentId === 'w1')
      expect(score).toBeDefined()
      // cosine(reactVec, vueVec) > EMBEDDING_THRESHOLD (0.7) -> SKILL_MATCH_SEMANTIC (0.8)
      expect(score?.skillMatch).toBeGreaterThanOrEqual(0.8)
    })

    it('skips auto-wire when repo has no getAllSkillEmbeddings method', async () => {
      const w1 = makeTalent({ id: 'w1', userId: 'u1' })
      // Repo without getAllSkillEmbeddings (old mock shape, backwards-compat)
      const repo = createMockRepo([w1], [{ talentId: 'w1', skillName: 'Vue' }])
      const service = new MatchingService(repo)
      // Should not throw; Stage 3 simply skips
      const result = await service.matchTalentsToProject(['React'], [], 10)
      const score = result.recommendations.find((r) => r.talentId === 'w1')
      expect(score).toBeDefined()
      expect(score?.skillMatch).toBe(0)
    })

    it('skips auto-wire when embedding map is empty', async () => {
      const w1 = makeTalent({ id: 'w1', userId: 'u1' })
      const repo = createMockRepo(
        [w1],
        [{ talentId: 'w1', skillName: 'Vue' }],
        new Map(),
        new Map(),
      )
      const service = new MatchingService(repo)
      const result = await service.matchTalentsToProject(['React'], [], 10)
      expect(repo.getAllSkillEmbeddings).toHaveBeenCalled()
      const score = result.recommendations.find((r) => r.talentId === 'w1')
      expect(score?.skillMatch).toBe(0)
    })

    it('injected embedding fn takes priority over auto-wire', async () => {
      const w1 = makeTalent({ id: 'w1', userId: 'u1' })
      const embMap = new Map<string, number[]>([['vue', [1, 0, 0]]])
      const repo = createMockRepo([w1], [{ talentId: 'w1', skillName: 'Vue' }], new Map(), embMap)
      const injectedFn = vi.fn().mockResolvedValue(0.95)
      const service = new MatchingService(repo, injectedFn)
      await service.matchTalentsToProject(['React'], [], 10)
      expect(injectedFn).toHaveBeenCalled()
      expect(repo.getAllSkillEmbeddings).not.toHaveBeenCalled()
    })
  })
})

describe('jaroWinkler', () => {
  it('returns 1 for identical strings', () => {
    expect(jaroWinkler('react', 'react')).toBe(1)
  })

  it('returns 0 for empty string', () => {
    expect(jaroWinkler('', 'react')).toBe(0)
    expect(jaroWinkler('react', '')).toBe(0)
  })

  it('returns high score for near-identical strings', () => {
    expect(jaroWinkler('react', 'reactjs')).toBeGreaterThan(0.85)
    expect(jaroWinkler('reactjs', 'react.js')).toBeGreaterThan(0.85)
  })

  it('returns low score for unrelated strings', () => {
    expect(jaroWinkler('react', 'python')).toBeLessThan(0.7)
  })

  it('rewards common prefix', () => {
    const withPrefix = jaroWinkler('reactjs', 'reactnative')
    const withoutPrefix = jaroWinkler('reactjs', 'nativereact')
    expect(withPrefix).toBeGreaterThan(withoutPrefix)
  })
})

describe('computeSkillMatch (fuzzy)', () => {
  it('returns 1 for exact match (case insensitive)', async () => {
    expect(await computeSkillMatch(['React'], ['react'])).toBe(1)
    expect(await computeSkillMatch(['REACT'], ['React'])).toBe(1)
  })

  it('returns 0.5 for empty requirements', async () => {
    expect(await computeSkillMatch(['React'], [])).toBe(0.5)
  })

  it('returns fuzzy score for similar skills (React.js ~ React)', async () => {
    const score = await computeSkillMatch(['React.js'], ['React'])
    expect(score).toBeGreaterThanOrEqual(0.9)
    expect(score).toBeLessThan(1)
  })

  it('returns fuzzy score for ReactJS variant', async () => {
    const score = await computeSkillMatch(['ReactJS'], ['React'])
    expect(score).toBeGreaterThanOrEqual(0.9)
  })

  it('returns 0 for completely different skills (no embedding)', async () => {
    expect(await computeSkillMatch(['Python'], ['Java'])).toBe(0)
  })

  it('partial match across multiple required skills', async () => {
    const score = await computeSkillMatch(['React', 'Vue'], ['React', 'Node.js'])
    expect(score).toBeGreaterThanOrEqual(0.5)
    expect(score).toBeLessThan(1)
  })

  it('uses embedding score when JW fails', async () => {
    const getEmbedding = vi.fn().mockResolvedValue(0.85)
    const score = await computeSkillMatch(['Pandas'], ['Python'], getEmbedding)
    expect(score).toBeGreaterThanOrEqual(0.8)
  })

  it('embedding default returns 0 (no fallback)', async () => {
    const getEmbedding = vi.fn().mockResolvedValue(0)
    expect(await computeSkillMatch(['Pandas'], ['Python'], getEmbedding)).toBe(0)
  })
})

describe('computePemerataanScore', () => {
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

  it('heavy load yields low score', () => {
    const score = computePemerataanScore(3, 20, 2)
    expect(score).toBeLessThan(0.15)
  })
})

describe('computeTrackRecord', () => {
  it('new talent defaults to 0.6', () => {
    expect(computeTrackRecord({ completedProjects: 0 })).toBe(0.6)
  })

  it('uses provided on-time and satisfaction rates', () => {
    expect(
      computeTrackRecord({
        completedProjects: 5,
        onTimeRate: 1.0,
        satisfactionRate: 1.0,
      }),
    ).toBeCloseTo(1.0, 2)
  })

  it('defaults missing rates to 0.8', () => {
    expect(computeTrackRecord({ completedProjects: 5 })).toBeCloseTo(0.8, 2)
  })

  it('poor on-time rate lowers score', () => {
    expect(
      computeTrackRecord({
        completedProjects: 5,
        onTimeRate: 0.3,
        satisfactionRate: 0.8,
      }),
    ).toBeCloseTo(0.5, 2)
  })
})

describe('computeRatingScore', () => {
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

describe('cosineSimilarity', () => {
  it('identical vectors yield 1', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1)
  })

  it('orthogonal vectors yield 0', () => {
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0)
  })

  it('opposite vectors yield -1', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1)
  })

  it('similar vectors yield high score', () => {
    const a = [0.9, 0.1, 0.5]
    const b = [1.0, 0.2, 0.4]
    expect(cosineSimilarity(a, b)).toBeGreaterThan(0.97)
  })

  it('returns 0 for empty vectors', () => {
    expect(cosineSimilarity([], [])).toBe(0)
  })

  it('returns 0 for mismatched lengths', () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0)
  })

  it('returns 0 for zero vector', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 0, 0])).toBe(0)
  })
})

describe('buildEmbeddingScoreFn', () => {
  it('returns undefined for empty map', () => {
    expect(buildEmbeddingScoreFn(new Map())).toBeUndefined()
  })

  it('returns a function when map has entries', () => {
    const map = new Map([['react', [1, 0, 0]]])
    expect(buildEmbeddingScoreFn(map)).toBeTypeOf('function')
  })

  it('built fn computes cosine between known keys', async () => {
    const map = new Map<string, number[]>([
      ['react', [1, 0, 0]],
      ['reactjs', [0.99, 0.1, 0]],
    ])
    const fn = buildEmbeddingScoreFn(map)
    expect(fn).toBeDefined()
    const score = await fn?.('react', 'reactjs')
    expect(score).toBeGreaterThan(0.97)
  })

  it('built fn returns 0 for unknown key', async () => {
    const map = new Map([['react', [1, 0, 0]]])
    const fn = buildEmbeddingScoreFn(map)
    expect(fn).toBeDefined()
    const result = await fn?.('react', 'python')
    expect(result).toBe(0)
  })

  it('built fn is case-insensitive', async () => {
    const map = new Map([
      ['react', [1, 0, 0]],
      ['vue', [0.9, 0.1, 0]],
    ])
    const fn = buildEmbeddingScoreFn(map)
    expect(fn).toBeDefined()
    const score = await fn?.('REACT', 'Vue')
    expect(score).toBeGreaterThan(0.9)
  })
})
