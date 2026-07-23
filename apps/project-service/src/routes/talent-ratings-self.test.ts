import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * GET /talents/ratings derived the talent from a client-supplied userId query
 * param that the sole caller never sends, so the ratings panel was always
 * empty. It also let any signed-in user read another talent's internal ratings
 * by passing an id. sessionMiddleware runs on /api/v1/talents/*, so the
 * recipient is the authenticated caller, not a query param.
 */

const source = readFileSync(path.resolve(__dirname, './talents.ts'), 'utf8')

function ratingsBody(): string {
  const start = source.indexOf("talentRoute.get('/ratings'")
  expect(start).toBeGreaterThan(-1)
  const rest = source.slice(start)
  const next = rest.indexOf("talentRoute.get('/:id'")
  return next === -1 ? rest : rest.slice(0, next)
}

describe('GET /talents/ratings', () => {
  const body = ratingsBody()

  it('derives the talent from the session, not a query param', () => {
    expect(body).toContain('getAuthUser')
  })

  it('does not read userId from the query', () => {
    expect(body).not.toMatch(/query\(['"]userId['"]\)/)
  })
})
