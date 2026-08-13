import { describe, expect, it } from 'vitest'
import { projectsRoute } from './projects'

/**
 * Hono matches in registration order, so a parameter route registered before a
 * literal swallows it. `/projects/:id` sits alongside `/projects/stats`,
 * `/projects/public` and `/projects/available`, and all three would be read as
 * an id.
 *
 * talents.ts already shipped this bug once: GET /talents/ratings was registered
 * after GET /talents/:id, so the ratings panel was permanently empty and
 * nothing errored, because the caller got a plausible-looking lookup for a
 * talent named "ratings".
 *
 * This asserts against Hono's own route table rather than the source text, so
 * it keeps working when the handlers move into sub-routers. That is the point:
 * it is the fitness check for splitting this file, and it has to mean the same
 * thing before and after the split.
 */

const LITERALS_BEFORE_PARAM = ['/stats', '/public', '/available']

function indexOfRoute(method: string, path: string): number {
  return projectsRoute.routes.findIndex((r) => r.method === method && r.path === path)
}

describe('projects route registration order', () => {
  it('registers the parameter route at all', () => {
    expect(indexOfRoute('GET', '/:id')).toBeGreaterThan(-1)
  })

  for (const literal of LITERALS_BEFORE_PARAM) {
    it(`registers ${literal} before /:id`, () => {
      const literalAt = indexOfRoute('GET', literal)
      const paramAt = indexOfRoute('GET', '/:id')

      expect(literalAt, `${literal} is not registered`).toBeGreaterThan(-1)
      expect(literalAt).toBeLessThan(paramAt)
    })
  }

  /**
   * The nested literals under an id are a second class of the same hazard:
   * `/:id/brd` must not be reachable as `/:id/:something`. There is no such
   * catch-all today, so this records that there still is not one.
   */
  it('has no catch-all second segment under an id', () => {
    const catchAll = projectsRoute.routes.filter(
      (r) => /^\/:id\/:[^/]+$/.test(r.path) && r.method !== 'ALL',
    )
    expect(catchAll.map((r) => `${r.method} ${r.path}`)).toEqual([])
  })
})
