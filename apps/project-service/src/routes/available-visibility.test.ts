import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyProjectVisibility } from '../lib/visibility'

/**
 * GET /projects/available is in the public route list in index.ts, so it
 * answers without a session, and it filtered on status alone. A project the
 * owner marked private was fully readable by anyone the moment it reached
 * matching, description and preferences included, while GET /projects/:id
 * answered 404 for the same row.
 *
 * GET /projects/public in the same file did filter, and truncated
 * public_summary descriptions by hand. Two routes, two rules, one of them
 * missing. Both now go through applyProjectVisibility.
 */

const source = readFileSync(path.resolve(__dirname, './projects.ts'), 'utf8')

function routeBody(marker: string): string {
  const start = source.indexOf(marker)
  expect(start, `route ${marker} not found`).toBeGreaterThan(-1)
  return source.slice(start, source.indexOf('projectsRoute.', start + marker.length))
}

describe('GET /projects/available', () => {
  const body = routeBody("projectsRoute.get('/available'")

  it('excludes private projects', () => {
    expect(body).toContain('visibility')
    expect(body).toMatch(/public_summary/)
  })

  it('shapes rows through the shared gate', () => {
    expect(body).toContain('applyProjectVisibility')
  })
})

describe('GET /projects/public', () => {
  const body = routeBody("projectsRoute.get('/public'")

  it('shapes rows through the shared gate rather than its own truncation', () => {
    expect(body).toContain('applyProjectVisibility')
    expect(body).not.toContain('substring(0, 120)')
  })
})

describe('anonymous viewer', () => {
  const row = {
    ownerId: 'owner-1',
    visibility: 'public_summary',
    description: 'a'.repeat(300),
    preferences: { minExperience: 3 },
  }

  it('gets a truncated description and no preferences', () => {
    const seen = applyProjectVisibility(row, null)
    expect(seen.description?.length).toBeLessThan(row.description.length)
    expect(seen.preferences).toBeNull()
  })

  /**
   * The band is the owner's own intake guess, made before the AI priced
   * anything. Browse cards that advertised it quoted several times what a seat
   * pays, so it leaves with the money columns rather than reading as an offer.
   */
  it('does not hand over the owner intake budget band', () => {
    const seen = applyProjectVisibility(
      { ...row, budgetMin: 45_000_000, budgetMax: 70_000_000 },
      null,
    )
    expect(seen.budgetMin).toBeUndefined()
    expect(seen.budgetMax).toBeUndefined()
  })

  it('leaves the band with the owner, who typed it', () => {
    const withBand = { ...row, budgetMin: 45_000_000, budgetMax: 70_000_000 }
    expect(applyProjectVisibility(withBand, 'owner-1').budgetMin).toBe(45_000_000)
  })

  it('cannot reach a private row', () => {
    expect(() => applyProjectVisibility({ ...row, visibility: 'private' }, null)).toThrow()
  })

  // A list has no owner to compare against, so it must not match on undefined.
  it('is not treated as the owner when ownerId is absent', () => {
    const withoutOwner = { ...row, ownerId: undefined, visibility: 'private' }
    expect(() => applyProjectVisibility(withoutOwner, null)).toThrow()
  })
})

/**
 * GET /:id refuses a stranger on a pre-live project, and the browse lists
 * only surface matching and team_forming. If those two rules ever disagree,
 * browse links to a page that answers 404 - and the public_detail scope
 * section, which only renders for a stranger, becomes unreachable code.
 */
describe('browse and direct link agree on what is public', () => {
  const detail = routeBody("projectsRoute.get('/:id'")
  const browsable = ['matching', 'team_forming']

  for (const status of browsable) {
    it(`opens a direct link to a ${status} project`, () => {
      const liveList = detail.slice(detail.indexOf('LIVE_STATUSES'))
      expect(liveList.slice(0, liveList.indexOf(']'))).toContain(`'${status}'`)
    })
  }

  it('serves the scope projection on that page', () => {
    expect(detail).toContain('publicProjectScope')
  })
})
