import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * GET /talent-profiles/:id/active-projects had no authorization at all - no
 * session read, no ownership check. The query ran straight from the path
 * parameter, and it returns project titles, statuses, progress, the current
 * milestone and the deadline.
 *
 * That is the pre-deal anonymity rule inverted. Matching hands an owner the
 * raw talentId of every anonymous candidate, so an owner reviewing a
 * shortlist could read each candidate's other clients' project titles - and
 * a competing talent could enumerate the whole book of work from one id.
 *
 * A talent's own dashboard is the only legitimate caller, so the rule is the
 * same as everywhere else: the caller must be the person whose data it is,
 * or an admin.
 */

const source = readFileSync(path.resolve(__dirname, './talent-profiles.ts'), 'utf8')

function handler(marker: string): string {
  const start = source.indexOf(marker)
  expect(start, `route ${marker} not found`).toBeGreaterThan(-1)
  const next = source.indexOf('talentProfileRoute.', start + marker.length)
  return source.slice(start, next === -1 ? source.length : next)
}

describe('GET /talent-profiles/:id/active-projects', () => {
  const body = handler("talentProfileRoute.get('/:id/active-projects'")

  it('reads the session', () => {
    expect(body).toContain('getAuthUser')
  })

  it('serves the talent their own work, and nobody else theirs', () => {
    expect(body).toContain('AUTH_FORBIDDEN')
    expect(body).toMatch(/userId !== |!== user\.id|user\.id !== /)
  })

  /**
   * An admin monitors utilisation and intervenes on late projects, so the
   * admin path is deliberate rather than an escape hatch.
   */
  it('lets an admin through', () => {
    // Written as a refusal, so the admin arm is the exemption from it.
    expect(body).toMatch(/role !== 'admin'|role === 'admin'/)
  })
})

describe('the rest of the talent-profile routes', () => {
  /**
   * The neighbouring routes already check. This one being the exception is
   * what made it easy to miss - it reads like the others until you look for
   * the check that is not there.
   */
  it('all read the session', () => {
    const routes = source.split('talentProfileRoute.').slice(1)
    for (const route of routes) {
      const name = route.slice(0, route.indexOf('\n'))
      expect(route, `${name} has no session read`).toMatch(/getAuthUser|getOptionalUser/)
    }
  })
})
