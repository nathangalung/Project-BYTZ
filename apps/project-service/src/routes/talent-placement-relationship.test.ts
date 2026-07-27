import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Talent placement is the release valve for direct hiring: an owner who worked
 * with a talent may recruit them, and the platform takes a conversion fee
 * instead of losing the relationship off-platform. The precondition is the
 * working relationship. It was never checked.
 *
 * The route confirmed the caller owns the project, then confirmed the talent
 * profile exists - by id, nothing else. The two facts were never joined. And
 * owners hold real talent ids already: the matching route hands them back with
 * every recommendation, for candidates who are still anonymous and were never
 * hired. So an owner could file a direct-hire request, with a conversion fee
 * attached, against someone they had only ever been shown.
 *
 * That is the anonymity model inverted. Its whole point is that an owner
 * cannot reach a talent they have not dealt with.
 */

const source = readFileSync(path.resolve(__dirname, './talent-placement.ts'), 'utf8')

function handler(marker: string): string {
  const start = source.indexOf(marker)
  expect(start, `route ${marker} not found`).toBeGreaterThan(-1)
  const next = source.indexOf('talentPlacementRoute.', start + marker.length)
  return source.slice(start, next === -1 ? source.length : next)
}

describe('POST /talent-placement', () => {
  const body = handler("talentPlacementRoute.post('/'")

  /**
   * The relationship is the authorisation. It lives in project_assignments,
   * and the check has to read it.
   */
  it('requires the talent to have been assigned to the project', () => {
    expect(body).toContain('projectAssignments')
    expect(body).toMatch(/eq\(projectAssignments\.projectId,[\s\S]{0,60}projectId\)/)
    expect(body).toMatch(/eq\(projectAssignments\.talentId,[\s\S]{0,60}talentId\)/)
  })

  /**
   * Existence is not a relationship. Every talent profile in the system passes
   * a lookup by id.
   */
  it('does not settle for the talent profile merely existing', () => {
    expect(body).not.toMatch(/\.where\(\s*eq\(talentProfiles\.id,[^)]*\)\s*\)/)
  })

  /**
   * A declined offer may be made again. An outstanding one may not: without
   * this the route mints unlimited fee-bearing requests for one pair.
   */
  it('refuses a second outstanding request for the same pair', () => {
    expect(body).toContain('CONFLICT')
  })
})

describe('talent_placement_requests migration', () => {
  const migrationsDir = path.resolve(__dirname, '../../../../packages/db/migrations')
  const sql = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => readFileSync(path.join(migrationsDir, f), 'utf8'))
    .join('\n')

  /**
   * Partial, because a declined request must not block an honest second
   * approach later.
   */
  it('admits one live request per project and talent', () => {
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX "talent_placement_live_unique" ON "talent_placement_requests"[^;]*\("project_id","talent_id"\)[^;]*WHERE[^;]*declined/,
    )
  })
})
