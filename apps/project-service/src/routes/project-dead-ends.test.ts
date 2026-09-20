import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { getValidTransitions, isValidTransition } from '../lib/state-machine'

const source = readFileSync(path.resolve(__dirname, './projects.ts'), 'utf8')

function handler(marker: string): string {
  const start = source.indexOf(marker)
  expect(start, `route ${marker} not found`).toBeGreaterThan(-1)
  const next = source.indexOf('projectsRoute.', start + marker.length)
  return source.slice(start, next === -1 ? source.length : next)
}

/**
 * 'completed' is terminal, and nothing checked what the project still owed
 * before going there. An owner accepting while a milestone was unapproved, or
 * while the escrow ledger still held money, closed the project over a balance
 * that then had no path to the talent or back to themselves.
 */
describe('POST /projects/:id/transition -> completed', () => {
  const body = handler("projectsRoute.post('/:id/transition'")

  const guard = (() => {
    const start = body.indexOf("parsed.data.status === 'completed'")
    expect(start, 'completion guard not found').toBeGreaterThan(-1)
    return body.slice(start, body.indexOf("parsed.data.status === 'cancelled'", start))
  })()

  it('refuses while any milestone is unapproved', () => {
    expect(guard).toMatch(/ne\(milestonesTable\.status,\s*'approved'\)/)
    expect(guard).toMatch(/open > 0/)
  })

  it('refuses while the escrow ledger still holds money', () => {
    expect(guard).toContain('getEscrowBalance(id)')
    expect(guard).toMatch(/balance > 0/)
  })

  /**
   * Reads, not settlements. A release and a refund both commit inside
   * payment-service and a throw here cannot roll either back, which is the
   * same trap the cancellation path below the guard documents.
   */
  it('does not move money inside the status change', () => {
    expect(guard).not.toContain('refundRemainingEscrow')
    expect(guard).not.toContain('settleMilestoneEscrow')
  })

  /**
   * disputed -> completed is an admin resolving a dispute, which settles on
   * its own terms. Putting it behind a live payment-service call would narrow
   * the very escape hatch this guard depends on.
   */
  it('applies to the review exit only', () => {
    expect(guard).toContain("ownedProject.status === 'review'")
  })

  it('tells the owner what to do about it', () => {
    expect(guard).toMatch(/cancel the project/i)
  })
})

/**
 * A guard that can refuse needs a second door, or it is itself the dead end.
 * Cancelling refunds the remaining balance to the owner.
 */
describe('the way out of review', () => {
  it('allows a project in review to be cancelled', () => {
    expect(isValidTransition('review', 'cancelled')).toBe(true)
    expect(getValidTransitions('review')).toContain('cancelled')
  })

  it('still refunds before it flips the status', () => {
    const body = handler("projectsRoute.post('/:id/transition'")
    const refund = body.indexOf('refundRemainingEscrow')
    const transition = body.indexOf('service.transitionStatus(')
    expect(refund).toBeGreaterThan(-1)
    expect(transition).toBeGreaterThan(refund)
  })
})

/**
 * Work package creation from a fresh PRD sat in a try/catch that logged and
 * carried on. A project could therefore land in prd_generated holding zero
 * packages: matching answers MATCHING_NO_WORK_PACKAGES, the owner cannot edit
 * it back (EDITABLE_STATUSES stops at brd_approved), and the only move left
 * costs a capped paid revision.
 */
describe('POST /projects/:id/generate-prd', () => {
  const body = handler("projectsRoute.post('/:id/generate-prd'")

  const creation = (() => {
    const start = body.indexOf('wpService.listByProject(projectId)')
    expect(start, 'work package creation not found').toBeGreaterThan(-1)
    return body.slice(start, body.indexOf('.update(prdDocuments)', start))
  })()

  /**
   * Ordering is the fix. The fill-in below sets version and clears the claim
   * marker, and releaseClaim matches on the version the claim reserved - once
   * the document is stored the claim can no longer be handed back.
   */
  it('creates the packages before the document is stored', () => {
    const packages = body.indexOf('wpService.createWorkPackages(')
    const stored = body.indexOf('.update(prdDocuments)')
    expect(packages).toBeGreaterThan(-1)
    expect(stored).toBeGreaterThan(-1)
    expect(packages).toBeLessThan(stored)
  })

  it('fails the generation and hands the claim back', () => {
    expect(creation).toContain("releaseClaim('prd', projectId, claim)")
    expect(creation).toMatch(/releaseClaim[\s\S]*throw err/)
  })

  it('does not swallow the failure into a log line', () => {
    expect(creation).not.toMatch(/catch[\s\S]*console\.error[\s\S]*\}\s*$/)
  })

  /** An empty plan is the same dead end as a failed insert. */
  it('treats a PRD that yields no package as a failed generation', () => {
    expect(creation).toMatch(/allWps\.length === 0[\s\S]*AppError/)
  })

  /**
   * Dependency edges stay best-effort: a project with packages and no edges is
   * staffable, one with no packages is not.
   */
  it('still tolerates a dependency graph it could not plan', () => {
    const deps = body.slice(body.indexOf('planDependencies('))
    expect(deps).toContain('console.error')
    expect(body.indexOf('planDependencies(')).toBeGreaterThan(body.indexOf('.update(prdDocuments)'))
  })
})
