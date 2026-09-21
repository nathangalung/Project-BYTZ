import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ABANDON_PENALTY_DELTA, PenaltyService } from '../services/penalty.service'

/**
 * Declining an offer was punished as abandonment.
 *
 * findRecentAbandons selected every assignment that had ended, and declining
 * an offer ends one. So refusing work a talent never accepted cost them the
 * same pemerataan penalty as walking off a project mid-build - and pemerataan
 * carries the largest matching weight, so the punishment compounds into fewer
 * offers.
 *
 * acceptance_status used to separate the cases. It is gone, collapsed into the
 * one status column, so completed_at separates them alone: it is written only
 * when the talent themselves ends work they had taken on. That makes the
 * decline handler's silence load-bearing, which is what the last case here
 * pins.
 */

const source = readFileSync(path.resolve(__dirname, './matching.repository.ts'), 'utf8')

const query = (() => {
  const start = source.indexOf('async findRecentAbandons(')
  expect(start, 'findRecentAbandons not found').toBeGreaterThan(-1)
  return source.slice(start)
})()

describe('findRecentAbandons', () => {
  it('requires the ended status and the recency cutoff', () => {
    expect(query).toMatch(/eq\(projectAssignments\.status,\s*'ended'\)/)
    expect(query).toMatch(/gte\(projectAssignments\.completedAt,\s*cutoff\)/)
  })

  it('no longer reads the acceptance column, which no longer exists', () => {
    expect(query).not.toContain('acceptanceStatus')
  })

  /**
   * completed_at is the whole discriminator, so the decline handler must leave
   * it alone. Asserted against the handler itself: a timestamp added back here
   * would silently charge every talent who says no the abandonment penalty,
   * and no predicate in the repository could tell.
   */
  it('excludes what the decline path writes', () => {
    const matching = readFileSync(path.resolve(__dirname, '../routes/matching.ts'), 'utf8')
    const decline = matching.slice(
      matching.indexOf("matchingRoute.post('/assignments/:id/decline'"),
    )
    const claim = decline.slice(
      decline.indexOf('claimOfferedAssignment(tx'),
      decline.indexOf('.update(workPackages)'),
    )
    expect(claim).toContain("status: 'ended'")
    expect(claim).not.toContain('completedAt')
  })

  /**
   * And the terminate handler must keep writing it, for the talent half only.
   */
  it('includes what a talent walking away writes', () => {
    const matching = readFileSync(path.resolve(__dirname, '../routes/matching.ts'), 'utf8')
    const terminate = matching.slice(
      matching.indexOf("matchingRoute.post('/assignments/:id/terminate'"),
    )
    expect(terminate).toMatch(/byTalent \? \{ completedAt: new Date\(\) \} : \{\}/)
  })
})

describe('PenaltyService.processAbandons', () => {
  it('penalises what the repository reports and nothing else', async () => {
    const incrementPemerataanPenalty = vi.fn().mockResolvedValue(undefined)
    const publish = vi.fn().mockResolvedValue(undefined)
    const repo = {
      findInactiveTalents: vi.fn(),
      findRecentAbandons: vi.fn().mockResolvedValue([{ talentId: 't-1', assignmentId: 'a-1' }]),
      incrementPemerataanPenalty,
    }

    const count = await new PenaltyService(repo as never, { publish }).processAbandons(24)

    expect(count).toBe(1)
    expect(incrementPemerataanPenalty).toHaveBeenCalledWith('t-1', ABANDON_PENALTY_DELTA)
  })

  it('charges nobody when the sweep finds no abandonment', async () => {
    const incrementPemerataanPenalty = vi.fn()
    const repo = {
      findInactiveTalents: vi.fn(),
      findRecentAbandons: vi.fn().mockResolvedValue([]),
      incrementPemerataanPenalty,
    }

    const count = await new PenaltyService(repo as never, { publish: vi.fn() }).processAbandons(24)

    expect(count).toBe(0)
    expect(incrementPemerataanPenalty).not.toHaveBeenCalled()
  })
})
