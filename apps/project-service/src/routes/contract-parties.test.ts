import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Every authorisation decision in contracts.ts derives one of the two
 * signatories from a different column: the owner from contracts.projectId, the
 * talent from contracts.assignmentId. GET /:id and PATCH /:id/sign both do
 * this. So the pair has to describe one real relationship, and POST / is the
 * only place that can guarantee it.
 *
 * It did not. It checked the caller owns projectId, then checked assignmentId
 * exists - never that the assignment sits on that project. An owner could name
 * their own project and any assignment id in the system, and mint a contract
 * whose talent party is a stranger working for someone else. `content` is the
 * agreement text and was an unconstrained record, so the terms were the
 * attacker's too. The talent then sees a real NDA awaiting their signature.
 */

const source = readFileSync(path.resolve(__dirname, './contracts.ts'), 'utf8')

function handler(marker: string): string {
  const start = source.indexOf(marker)
  expect(start, `route ${marker} not found`).toBeGreaterThan(-1)
  const next = source.indexOf('contractRoute.', start + marker.length)
  return source.slice(start, next === -1 ? source.length : next)
}

describe('POST /contracts', () => {
  const body = handler("contractRoute.post('/'")

  /**
   * The fix that matters: the assignment lookup must be constrained to the
   * project the caller was authorised for, so a stranger's assignment cannot
   * satisfy it.
   */
  it('only accepts an assignment that belongs to the named project', () => {
    expect(body).toMatch(/eq\(projectAssignments\.projectId,[\s\S]{0,60}projectId\)/)
  })

  it('does not look an assignment up by id alone', () => {
    const byIdOnly = /\.where\(\s*eq\(projectAssignments\.id,[^)]*\)\s*\)/
    expect(body).not.toMatch(byIdOnly)
  })

  /**
   * A replaced or terminated talent is no longer a party to anything. Binding
   * one to a fresh agreement is the same defect in a slower form.
   */
  it('refuses an assignment that is no longer live', () => {
    expect(body).toContain('CONTRACTABLE_ASSIGNMENT_STATUSES')
  })

  /**
   * One agreement of each type per assignment. Without this the route is an
   * unbounded writer: same body, same two ids, a new signable contract every
   * call.
   */
  it('refuses a duplicate contract of the same type', () => {
    expect(body).toContain('CONFLICT')
  })
})

describe('contract content', () => {
  /**
   * content is the agreement itself and lands in a JSONB column. As
   * z.record(z.string(), z.unknown()) it accepted any shape and any size, so
   * the route doubled as an unmetered blob store.
   */
  it('is not an unconstrained record', () => {
    expect(source).not.toContain('z.record(z.string(), z.unknown())')
  })
})
