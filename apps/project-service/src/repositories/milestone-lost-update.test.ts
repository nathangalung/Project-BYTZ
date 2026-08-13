import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Approving a milestone is read, validate, write, and the write was
 * unconditional.
 *
 * MilestoneService reads the current status, checks the transition in
 * JavaScript, then updateStatus writes `.where(eq(milestones.id, id))`. Two
 * callers that both read `submitted` both pass the check and both write
 * `approved`. That is not hypothetical: an owner double-clicking Approve races
 * the 14-day auto-release sweep, which is a scheduled job aiming at exactly the
 * milestones an owner is most likely to be looking at.
 *
 * The money survives, because the release is keyed `release:${milestoneId}`.
 * What does not: completedAt is overwritten by the loser, and two
 * milestone.approved events reach the outbox, so the talent is told twice and
 * the second invoice is stopped only by a unique index.
 *
 * The status the caller validated has to be part of the predicate, so the
 * database decides the race rather than whichever transaction commits last.
 */

const source = readFileSync(path.resolve(__dirname, './milestone.repository.ts'), 'utf8')

function method(name: string): string {
  const start = source.indexOf(`async ${name}(`)
  expect(start, `${name} not found`).toBeGreaterThan(-1)
  const next = source.indexOf('\n  async ', start + 1)
  return source.slice(start, next === -1 ? source.length : next)
}

describe('updateStatus', () => {
  const body = method('updateStatus')

  it('takes the status the caller validated against', () => {
    expect(body).toMatch(/expectedStatus/)
  })

  /**
   * The predicate is the guard. Keying on the id alone lets the second writer
   * through no matter what it read.
   */
  it('writes only while the row still holds that status', () => {
    expect(body).toMatch(/eq\(milestones\.status,\s*expectedStatus\)/)
  })

  /**
   * Scoped to the update chain on purpose. The conflict branch reads by id
   * alone, legitimately, to report what the row moved to instead.
   */
  it('does not write on the id alone', () => {
    const update = body.slice(body.indexOf('.update(milestones)'), body.indexOf('.returning()'))
    expect(update).not.toMatch(/\.where\(\s*eq\(milestones\.id,\s*id\)\s*\)/)
    expect(update).toContain('and(')
  })

  /**
   * Losing the race has to be distinguishable from the row not existing, or
   * the caller cannot tell a conflict from a 404.
   */
  it('reports a lost race as a conflict', () => {
    expect(body).toContain('CONFLICT')
  })
})
