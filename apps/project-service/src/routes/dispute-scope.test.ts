import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Opening a dispute authorised the caller against the project and then took
 * two more ids from the body on trust.
 *
 * workPackageId decides whose money the resolution moves.
 * DisputeRepository.findEscrowDeposit matches on project AND work package, so
 * a foreign project's package matches nothing - but a package belonging to a
 * different talent on the SAME project matches exactly. A talent could open a
 * dispute scoped to a teammate's package, and a funds_to_owner resolution
 * refunds that teammate's escrow over a dispute they were never in. The
 * repository comment warns about picking up "a package deposit belonging to a
 * talent who is not part of the dispute at all"; nothing upstream enforced it.
 *
 * againstUserId decides who counts as a party: DisputeService.changeStatus
 * reads `initiatedBy === actor.id || againstUserId === actor.id`. Naming an
 * arbitrary user makes a stranger the respondent on a case they have no
 * connection to, and hands them standing to move its status.
 */

const source = readFileSync(path.resolve(__dirname, './disputes.ts'), 'utf8')

function handler(marker: string): string {
  const start = source.indexOf(marker)
  expect(start, `route ${marker} not found`).toBeGreaterThan(-1)
  const next = source.indexOf('disputeRoute.', start + marker.length)
  return source.slice(start, next === -1 ? source.length : next)
}

describe('POST /disputes', () => {
  const body = handler("disputeRoute.post('/'")

  /**
   * A talent may dispute only the package they hold. An owner disputes any
   * package on their own project, which is legitimate.
   */
  it('lets a talent dispute only their own work package', () => {
    expect(body).toContain('assertDisputableWorkPackage')
  })

  /**
   * The respondent has to be the other side of this project, not any user id
   * in the system.
   */
  it('requires the respondent to be a party to the project', () => {
    expect(body).toContain('assertProjectParty')
  })

  /**
   * Disputing yourself would make the same person initiator and respondent,
   * which satisfies every party check by construction.
   */
  it('refuses a dispute against yourself', () => {
    expect(body).toMatch(/againstUserId === userId|userId === parsed\.data\.againstUserId/)
  })
})

describe('assertProjectParty', () => {
  const access = readFileSync(path.resolve(__dirname, '../lib/project-access.ts'), 'utf8')
  const start = access.indexOf('export async function assertProjectParty')
  const fn = access.slice(start, access.indexOf('\nexport ', start + 1))

  /**
   * A talent who abandons the work gets their assignment terminated, and
   * abandonment is one of the things disputes exist for. Reusing the live-only
   * rule here would refuse the dispute exactly when it is most warranted, so
   * the respondent check is historical: ever assigned, any status.
   */
  it('still admits a talent whose assignment ended', () => {
    expect(start, 'assertProjectParty not found').toBeGreaterThan(-1)
    expect(fn).not.toContain('LIVE_ASSIGNMENT_STATUSES')
    expect(fn).not.toContain('isAssignedTalent')
  })
})

describe('assertDisputableWorkPackage', () => {
  const access = readFileSync(path.resolve(__dirname, '../lib/project-access.ts'), 'utf8')
  const start = access.indexOf('export async function assertDisputableWorkPackage')
  const fn = access.slice(start, access.indexOf('\nexport ', start + 1))

  /**
   * A package from another project must not resolve at all. Without the
   * project predicate the id alone would be enough.
   */
  it('scopes the work package to the project', () => {
    expect(start, 'assertDisputableWorkPackage not found').toBeGreaterThan(-1)
    expect(fn).toMatch(/eq\(workPackages\.projectId,\s*projectId\)/)
  })

  /**
   * The talent branch keys on the package, not on the project. Matching any
   * live assignment on the project would let a teammate qualify.
   */
  it('matches the talent against the package, not the project', () => {
    expect(fn).toMatch(/eq\(projectAssignments\.workPackageId,\s*workPackageId\)/)
  })
})
