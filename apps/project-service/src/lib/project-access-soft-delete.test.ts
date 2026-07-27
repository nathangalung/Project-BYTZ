import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Deleting a project is soft: the row stays and every listing filters it out.
 * ProjectRepository does that consistently, and so does the whole Go side.
 *
 * The two shared authorisation helpers did not. They resolved a project by id
 * with no deleted_at predicate, so a deleted project stayed fully operable
 * through every route that authorises through them - milestones, work
 * packages, time logs, chat, contracts, invoices - while being invisible in
 * every list the owner could see. Deletion looked done and was not.
 */

const source = readFileSync(path.resolve(__dirname, './project-access.ts'), 'utf8')

function fn(name: string): string {
  const start = source.indexOf(`export async function ${name}`)
  expect(start, `${name} not found`).toBeGreaterThan(-1)
  return source.slice(start, source.indexOf('\nexport ', start + 1))
}

describe('project authorization helpers', () => {
  for (const name of ['assertProjectOwner', 'assertProjectAccess', 'assertProjectParty']) {
    it(`${name} treats a deleted project as gone`, () => {
      expect(fn(name)).toContain('isNull(projects.deletedAt)')
    })
  }
})

describe('GET /projects/stats', () => {
  const routes = readFileSync(path.resolve(__dirname, '../routes/projects.ts'), 'utf8')
  const start = routes.indexOf("projectsRoute.get('/stats'")
  const body = routes.slice(start, routes.indexOf('projectsRoute.', start + 20))

  /**
   * Public, unauthenticated, and rendered as platform success metrics on the
   * landing page. Counting deleted projects inflates all three numbers.
   */
  it('counts only projects that still exist', () => {
    expect(start, '/stats route not found').toBeGreaterThan(-1)
    const counts = body.match(/count\(\*\)/g) ?? []
    const filters = body.match(/isNull\(projectsTable\.deletedAt\)/g) ?? []
    expect(filters.length, 'every counter needs the filter').toBe(counts.length)
  })
})
