import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * list() backs GET /projects, which any signed-in user may call. It selected
 * every column and left applyProjectVisibility to remove the ones that matter.
 *
 * That works only for the columns someone thought to name. `projects` gains
 * columns over time, and a denylist ships each new one to every signed-in
 * user until somebody notices - the same failure mode publicProjectScope is
 * an allowlist to avoid. Naming the columns here makes exposing a new one a
 * decision rather than a default.
 */

const source = readFileSync(path.resolve(__dirname, './project.repository.ts'), 'utf8')

function listBody(): string {
  const start = source.indexOf('async list(')
  expect(start, 'list() not found').toBeGreaterThan(-1)
  return source.slice(start, source.indexOf('async getStatusLogs', start))
}

describe('projectRepo.list', () => {
  const body = listBody()

  it('names the columns it returns', () => {
    expect(body).not.toMatch(/\.select\(\)\s*\n\s*\.from\(projects\)/)
    expect(body).toContain('PROJECT_LIST_COLUMNS')
  })

  /**
   * The soft-delete marker is a query predicate, not payload: list() already
   * filters on it, so every row carries the same null.
   */
  it('does not ship the soft-delete marker', () => {
    const columns = source.slice(source.indexOf('PROJECT_LIST_COLUMNS'))
    expect(columns.slice(0, columns.indexOf('}'))).not.toContain('deletedAt')
  })

  /**
   * The owner branch of applyProjectVisibility returns the row as stored, and
   * the owner dashboard calls this route filtered to their own projects, so
   * the money columns must still be selected - the gate removes them for
   * everyone else.
   */
  it('still selects what the owner is entitled to see', () => {
    for (const column of ['finalPrice', 'platformFee', 'talentPayout', 'companyName']) {
      expect(source).toContain(`${column}: projects.${column}`)
    }
  })
})
