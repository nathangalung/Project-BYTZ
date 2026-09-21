import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ABANDON_PENALTY_DELTA, PenaltyService } from '../services/penalty.service'

/**
 * Declining an offer was punished as abandonment.
 *
 * findRecentAbandons selected every assignment with status 'terminated', and
 * the decline handler writes exactly that status when a talent turns an offer
 * down. So refusing work a talent never accepted cost them the same
 * pemerataan penalty as walking off a project mid-build - and pemerataan
 * carries the largest matching weight, so the punishment compounds into fewer
 * offers.
 *
 * Two columns separate the cases, and neither needs a migration:
 * acceptance_status says whether the work was ever taken on, and completed_at
 * is written only when the talent themselves ends it.
 */

const source = readFileSync(path.resolve(__dirname, './matching.repository.ts'), 'utf8')

const query = (() => {
  const start = source.indexOf('async findRecentAbandons(')
  expect(start, 'findRecentAbandons not found').toBeGreaterThan(-1)
  return source.slice(start)
})()

describe('findRecentAbandons', () => {
  it('counts only assignments that were accepted', () => {
    expect(query).toMatch(/eq\(projectAssignments\.acceptanceStatus,\s*'accepted'\)/)
  })

  it('still requires the terminated status and the recency cutoff', () => {
    expect(query).toMatch(/eq\(projectAssignments\.status,\s*'terminated'\)/)
    expect(query).toMatch(/gte\(projectAssignments\.completedAt,\s*cutoff\)/)
  })

  /**
   * The decline handler writes acceptance_status 'declined' alongside the
   * terminated status, so the predicate above is what keeps it out. Asserted
   * against the handler itself: the filter is only a discriminator for as long
   * as the two paths keep writing different values.
   */
  it('excludes what the decline path writes', () => {
    const matching = readFileSync(path.resolve(__dirname, '../routes/matching.ts'), 'utf8')
    const decline = matching.slice(
      matching.indexOf("matchingRoute.post('/assignments/:id/decline'"),
    )
    const claim = decline.slice(decline.indexOf('claimPendingAssignment(tx'))
    expect(claim).toContain("acceptanceStatus: 'declined'")
    expect(claim).toContain("status: 'terminated'")
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
