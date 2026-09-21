import { readFileSync } from 'node:fs'
import path from 'node:path'
import { ERROR_HTTP_STATUS } from '@kerjacus/shared'
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
   * final_review -> completed is the only way in to 'completed', so the guard
   * is scoped to it rather than to every arrival.
   */
  it('applies to the final-review exit only', () => {
    expect(guard).toContain("ownedProject.status === 'final_review'")
  })

  it('tells the owner what to do about it', () => {
    expect(guard).toMatch(/cancel the project/i)
  })
})

/**
 * A guard that can refuse needs a second door, or it is itself the dead end.
 * Cancelling refunds the remaining balance to the owner.
 */
describe('the way out of final review', () => {
  it('allows a project in final review to be cancelled', () => {
    expect(isValidTransition('final_review', 'cancelled')).toBe(true)
    expect(getValidTransitions('final_review')).toContain('cancelled')
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
 * carried on. A project could therefore land on the PRD step holding zero
 * packages: matching answers MATCHING_NO_WORK_PACKAGES, the owner cannot edit
 * it back (EDITABLE_STATUSES stops at brd_review), and the only move left
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

/**
 * The PRD is written from the approved BRD, and the BRD was loaded as optional:
 * `brdContent: (brd?.content ?? {})` turned an absent document into an empty
 * object, so a project that had never produced a BRD could be made to generate
 * a PRD out of nothing by calling the route directly. Nor was the status read,
 * so a BRD still sitting in review could be walked past the same way - the PRD
 * page disabled its button, but the API is what decides.
 *
 * Asserted on the source because the behaviour needs a live database to reach;
 * the integration file covers what it answers, this covers that the guard is
 * where it has to be - before the allowance is claimed and before the model is
 * called, so a refused request bills nothing.
 */
describe('generate-prd requires an approved BRD', () => {
  const prd = handler("projectsRoute.post('/:id/generate-prd'")
  const revision = handler("projectsRoute.post('/:id/prd/revision'")

  it('refuses before the allowance is claimed or the model is called', () => {
    for (const body of [prd, revision]) {
      const guard = body.indexOf('requireApprovedBrd(')
      expect(guard).toBeGreaterThan(-1)
      expect(guard).toBeLessThan(body.indexOf('generatePrdContent('))
      expect(guard).toBeLessThan(body.search(/claim(Generation|Revision)\(/))
    }
  })

  it('never hands the generator an empty BRD', () => {
    for (const body of [prd, revision]) {
      expect(body).not.toContain('brd?.content ?? {}')
      expect(body).toContain('brdContent,')
    }
  })

  /**
   * The position and the approval are two separate facts.
   *
   * brd_review spans generated and approved, so the position alone can no
   * longer say the owner accepted the draft - the document's own status does,
   * and canGeneratePrd takes both.
   */
  it('checks the status against the shared precondition, not a literal', () => {
    expect(source).toContain('canGeneratePrd(status, brd.status)')
    expect(source).toMatch(/requireApprovedBrd\(projectId, project\.status as ProjectStatus\)/)
  })

  it('answers with the prerequisite code rather than a payment or a quota', () => {
    expect(source).toContain("'DOCUMENT_BRD_NOT_APPROVED'")
    expect(ERROR_HTTP_STATUS.DOCUMENT_BRD_NOT_APPROVED).toBe(409)
  })

  /**
   * The gate runs ahead of the free-allowance and daily-document checks: an
   * owner with no approved BRD owes an approval, and being told about a quota
   * instead would send them to the wrong screen entirely.
   */
  it('is reached before the allowance checks answer for it', () => {
    expect(prd.indexOf('requireApprovedBrd(')).toBeLessThan(
      prd.indexOf('DOCUMENT_GENERATION_LIMIT'),
    )
    expect(prd.indexOf('requireApprovedBrd(')).toBeLessThan(prd.indexOf('DOCUMENT_DAILY_LIMIT'))
  })
})
