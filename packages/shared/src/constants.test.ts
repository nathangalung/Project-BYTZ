import { describe, expect, it } from 'vitest'
import {
  API_VERSION,
  AUTO_RELEASE_DAYS,
  EXPLORATION_RATE,
  FILE_LIMITS,
  FREE_REVISION_ROUNDS,
  HEALTH_THRESHOLDS,
  HEALTH_WEIGHTS,
  MARGIN_RATES,
  MATCHING_SLA,
  MATCHING_WEIGHTS,
  MAX_TEAM_SIZE,
  NEW_TALENT_DEFAULTS,
  PAGINATION,
  RAG_CONFIG,
  RATE_LIMITS,
  REVISION_FEES,
  TALENT_INACTIVITY_REASSIGN_DAYS,
  TALENT_INACTIVITY_WARNING_DAYS,
  TALENT_PLACEMENT_FEE,
  TALENT_QUALITY,
} from './constants'

describe('MATCHING_WEIGHTS', () => {
  it('sums to 1.0', () => {
    const sum =
      MATCHING_WEIGHTS.SKILL_MATCH +
      MATCHING_WEIGHTS.PEMERATAAN +
      MATCHING_WEIGHTS.TRACK_RECORD +
      MATCHING_WEIGHTS.RATING
    expect(sum).toBeCloseTo(1.0)
  })

  it('pemerataan has highest weight', () => {
    expect(MATCHING_WEIGHTS.PEMERATAAN).toBe(0.35)
  })

  it('rating has lowest weight', () => {
    expect(MATCHING_WEIGHTS.RATING).toBe(0.15)
  })

  it('skill match is 0.3', () => {
    expect(MATCHING_WEIGHTS.SKILL_MATCH).toBe(0.3)
  })

  it('track record is 0.2', () => {
    expect(MATCHING_WEIGHTS.TRACK_RECORD).toBe(0.2)
  })
})

describe('EXPLORATION_RATE', () => {
  it('is 30%', () => {
    expect(EXPLORATION_RATE).toBe(0.3)
  })
})

describe('NEW_TALENT_DEFAULTS', () => {
  it('has benefit of the doubt values', () => {
    expect(NEW_TALENT_DEFAULTS.TRACK_RECORD).toBe(0.6)
    expect(NEW_TALENT_DEFAULTS.RATING).toBe(0.7)
    expect(NEW_TALENT_DEFAULTS.PEMERATAAN_BONUS).toBe(0.2)
  })
})

describe('MARGIN_RATES', () => {
  it('decreases with project value', () => {
    expect(MARGIN_RATES.BELOW_10M.max).toBeGreaterThan(MARGIN_RATES.FROM_10M_TO_50M.max)
    expect(MARGIN_RATES.FROM_10M_TO_50M.max).toBeGreaterThan(MARGIN_RATES.FROM_50M_TO_100M.max)
    expect(MARGIN_RATES.FROM_50M_TO_100M.max).toBeGreaterThan(MARGIN_RATES.ABOVE_100M.max)
  })

  it('has min <= max per tier', () => {
    expect(MARGIN_RATES.BELOW_10M.min).toBeLessThanOrEqual(MARGIN_RATES.BELOW_10M.max)
    expect(MARGIN_RATES.FROM_10M_TO_50M.min).toBeLessThanOrEqual(MARGIN_RATES.FROM_10M_TO_50M.max)
    expect(MARGIN_RATES.FROM_50M_TO_100M.min).toBeLessThanOrEqual(MARGIN_RATES.FROM_50M_TO_100M.max)
    expect(MARGIN_RATES.ABOVE_100M.min).toBeLessThanOrEqual(MARGIN_RATES.ABOVE_100M.max)
  })
})

describe('REVISION_FEES', () => {
  it('minor is less than moderate', () => {
    expect(REVISION_FEES.MINOR.max).toBeLessThan(REVISION_FEES.MODERATE.min)
  })
})

describe('HEALTH_WEIGHTS', () => {
  it('sums to 1.0', () => {
    const sum =
      HEALTH_WEIGHTS.TIMELINE +
      HEALTH_WEIGHTS.MILESTONE +
      HEALTH_WEIGHTS.COMMUNICATION +
      HEALTH_WEIGHTS.BUDGET
    expect(sum).toBeCloseTo(1.0)
  })

  it('timeline has highest weight', () => {
    expect(HEALTH_WEIGHTS.TIMELINE).toBe(0.35)
  })
})

describe('HEALTH_THRESHOLDS', () => {
  it('are ordered correctly', () => {
    expect(HEALTH_THRESHOLDS.HEALTHY).toBeGreaterThan(HEALTH_THRESHOLDS.AT_RISK)
    expect(HEALTH_THRESHOLDS.AT_RISK).toBeGreaterThan(HEALTH_THRESHOLDS.CRITICAL)
    expect(HEALTH_THRESHOLDS.CRITICAL).toBeGreaterThan(HEALTH_THRESHOLDS.EMERGENCY)
  })
})

describe('constants', () => {
  it('free revisions is 2', () => {
    expect(FREE_REVISION_ROUNDS).toBe(2)
  })

  it('auto release is 14 days', () => {
    expect(AUTO_RELEASE_DAYS).toBe(14)
  })

  it('talent inactivity warning is 7 days', () => {
    expect(TALENT_INACTIVITY_WARNING_DAYS).toBe(7)
  })

  it('talent inactivity reassign is 10 days', () => {
    expect(TALENT_INACTIVITY_REASSIGN_DAYS).toBe(10)
  })

  it('max team size is 8', () => {
    expect(MAX_TEAM_SIZE).toBe(8)
  })

  it('matching SLA single talent is 72 hours', () => {
    expect(MATCHING_SLA.SINGLE_TALENT_HOURS).toBe(72)
  })

  it('matching SLA team project is 14 days', () => {
    expect(MATCHING_SLA.TEAM_PROJECT_DAYS).toBe(14)
  })

  it('talent placement fee range', () => {
    expect(TALENT_PLACEMENT_FEE.MIN_PERCENTAGE).toBe(0.1)
    expect(TALENT_PLACEMENT_FEE.MAX_PERCENTAGE).toBe(0.15)
  })

  it('rate limits are configured', () => {
    expect(RATE_LIMITS.STANDARD.requests).toBe(100)
    expect(RATE_LIMITS.AI_INTENSIVE.requests).toBe(10)
  })

  it('pagination has defaults', () => {
    expect(PAGINATION.DEFAULT_PAGE).toBe(1)
    expect(PAGINATION.DEFAULT_PAGE_SIZE).toBe(20)
    expect(PAGINATION.MAX_PAGE_SIZE).toBe(100)
  })

  it('file limits are set', () => {
    expect(FILE_LIMITS.CV_MAX_SIZE).toBe(5 * 1024 * 1024)
    expect(FILE_LIMITS.ATTACHMENT_MAX_SIZE).toBe(10 * 1024 * 1024)
  })

  it('talent quality thresholds exist', () => {
    expect(TALENT_QUALITY.WARNING_RATING).toBe(3.5)
    expect(TALENT_QUALITY.SUSPEND_RATING).toBe(3.0)
    expect(TALENT_QUALITY.MAX_ABANDONS_BEFORE_SUSPEND).toBe(2)
  })

  it('RAG config is defined', () => {
    expect(RAG_CONFIG.SIMILARITY_THRESHOLD).toBe(0.5)
    expect(RAG_CONFIG.TOP_K_RESULTS).toBe(4)
    expect(RAG_CONFIG.EMBEDDING_DIMENSIONS).toBe(1536)
  })

  it('API version is v1', () => {
    expect(API_VERSION).toBe('v1')
  })
})
