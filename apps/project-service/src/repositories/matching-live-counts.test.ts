import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { computePemerataanScore } from '../services/matching.service'

/**
 * pemerataan_skor carries the largest matching weight, 0.35, and it is computed
 * from a talent's active and completed project counts.
 *
 * Those counts were read from talent_profiles columns that only the seed ever
 * wrote. On the dev database the busiest talent held three active assignments
 * and was recorded as zero, so they scored as if idle and kept being
 * recommended. The repository now counts from project_assignments instead.
 */

const source = readFileSync(path.resolve(__dirname, './matching.repository.ts'), 'utf8')

describe('eligible talent counts', () => {
  it('counts assignments rather than reading the stored columns', () => {
    const query = source.slice(source.indexOf('findEligibleTalents'))
    const select = query.slice(0, query.indexOf('.from('))

    expect(select).toContain('projectAssignments')
    expect(select).not.toContain('talentProfiles.totalProjectsActive')
    expect(select).not.toContain('talentProfiles.totalProjectsCompleted')
  })

  it('still reads rating and penalty from the profile', () => {
    // pemerataanPenalty is maintained by penalty.service, unlike the counters.
    const query = source.slice(source.indexOf('findEligibleTalents'))
    expect(query).toContain('talentProfiles.pemerataanPenalty')
    expect(query).toContain('talentProfiles.averageRating')
  })
})

describe('computePemerataanScore', () => {
  it('gives an idle talent the top score', () => {
    expect(computePemerataanScore(0, 0, 0)).toBe(1)
  })

  // The case the stale counters got wrong.
  it('ranks a busy talent far below an idle one', () => {
    const busy = computePemerataanScore(3, 0, 0)
    const idle = computePemerataanScore(0, 2, 0)
    expect(busy).toBeLessThan(idle)
    expect(busy).toBeLessThan(0.2)
  })

  it('weighs an active project above a completed one', () => {
    expect(computePemerataanScore(1, 0, 0)).toBeLessThan(computePemerataanScore(0, 1, 0))
  })

  it('lowers the score as the penalty grows', () => {
    expect(computePemerataanScore(0, 0, 2)).toBeLessThan(computePemerataanScore(0, 0, 0))
  })

  it('never returns above one or below zero', () => {
    for (const [a, c, p] of [
      [0, 0, 0],
      [8, 40, 5],
      [1, 1, 1],
    ]) {
      const score = computePemerataanScore(a, c, p)
      expect(score).toBeGreaterThan(0)
      expect(score).toBeLessThanOrEqual(1)
    }
  })
})
