import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Answering an offer is read, check, write, and the write was unconditional.
 *
 * Both handlers call loadOwnAssignment on the pool, gate on what it read with
 * assertAssignmentPending, then update `WHERE id = assignment.id` with nothing
 * about acceptance_status in the predicate. Two requests that both read
 * `pending` both pass the gate and both write.
 *
 * The corruption is not the duplicate assignment write, it is the work
 * package. A decline interleaving an accept sets the package back to
 * 'unassigned' after the accept counted it in allPackagesStaffed, so the
 * project sits in 'matched' holding a package /positions offers to somebody
 * else. Double accept and double decline each emit their outbox event twice on
 * top of that.
 *
 * A compare-and-set alone does not close it: the two handlers corrupt a row
 * neither of them compares on, so they also have to serialise. Accept already
 * took the project row; decline took no lock at all.
 */

const source = readFileSync(path.resolve(__dirname, './matching.ts'), 'utf8')

function handler(marker: string): string {
  const start = source.indexOf(marker)
  expect(start, `route ${marker} not found`).toBeGreaterThan(-1)
  const next = source.indexOf('matchingRoute.', start + marker.length)
  return source.slice(start, next === -1 ? source.length : next)
}

function func(name: string): string {
  const start = source.indexOf(`async function ${name}(`)
  expect(start, `${name} not found`).toBeGreaterThan(-1)
  const next = source.indexOf('\nmatchingRoute.', start)
  return source.slice(start, next === -1 ? source.length : next)
}

/**
 * One shared claim for both answers: the compare-and-set and the diagnosis
 * that follows it are identical, only the columns written differ.
 */
describe('claimPendingAssignment', () => {
  const body = func('claimPendingAssignment')

  /**
   * assertAssignmentPending validated a status. The predicate is the only
   * place that validation survives the trip to the database; keyed on the id
   * alone the second writer goes through no matter what it read.
   */
  it('writes only while the offer is still pending', () => {
    expect(body).toMatch(/eq\(projectAssignments\.acceptanceStatus,\s*'pending'\)/)
  })

  /**
   * Scoped to the update chain on purpose. The conflict branch re-reads the
   * row by id, legitimately, to report what it moved to instead, and that read
   * must not be able to satisfy an assertion about the write.
   */
  it('does not write on the assignment id alone', () => {
    const start = body.indexOf('.update(projectAssignments)')
    expect(start, 'assignment update not found').toBeGreaterThan(-1)
    const end = body.indexOf('.returning(', start)
    expect(end, 'the write does not report whether it landed').toBeGreaterThan(start)
    const update = body.slice(start, end)
    expect(update).not.toMatch(/\.where\(\s*eq\(projectAssignments\.id,[^)]*\)\s*\)/)
    expect(update).toContain('and(')
  })

  /**
   * Losing the race has to be distinguishable from the offer not existing, or
   * the talent cannot tell "already answered" from a dead link.
   */
  it('reports a lost race as a conflict', () => {
    expect(body).toMatch(/AppError\(\s*'CONFLICT'/)
  })
})

describe.each([
  ['accept', "matchingRoute.post('/assignments/:id/accept'"],
  ['decline', "matchingRoute.post('/assignments/:id/decline'"],
])('POST /matching/assignments/:id/%s', (_action, marker) => {
  const body = handler(marker)

  it('answers the offer through the guarded claim', () => {
    expect(body).toContain('claimPendingAssignment')
  })

  it('does not write the assignment row itself', () => {
    expect(body).not.toContain('.update(projectAssignments)')
  })

  /**
   * The compare-and-set guards the assignment row. Nothing guards the work
   * package row, which is the one whose value actually corrupts, so the two
   * handlers must not run at once on the same project.
   */
  it('serialises on the project row', () => {
    expect(body).toContain(".for('update')")
  })

  /**
   * Same lock, same position, in every handler that writes these rows: the
   * project row before the work package row. Taking them the other way round
   * in one handler turns the race into a deadlock.
   */
  it('takes the project lock before touching the work package', () => {
    const lock = body.indexOf(".for('update')")
    const pkg = body.indexOf('.update(workPackages)')
    expect(pkg, 'work package write not found').toBeGreaterThan(-1)
    expect(lock, 'no project lock').toBeGreaterThan(-1)
    expect(lock).toBeLessThan(pkg)
  })
})

/**
 * Confirm writes the same two rows and is the third party to the race. It
 * updated work packages first and the project last, the exact inversion that
 * deadlocks against the handlers above once they both hold the project row.
 */
describe('POST /matching/confirm', () => {
  const body = handler("matchingRoute.post('/confirm'")

  it('takes the project lock before touching the work package', () => {
    const tx = body.slice(body.indexOf('db.transaction'))
    const lock = tx.indexOf(".for('update')")
    const pkg = tx.indexOf('.update(workPackages)')
    expect(pkg, 'work package write not found').toBeGreaterThan(-1)
    expect(lock, 'confirm does not lock the project row').toBeGreaterThan(-1)
    expect(lock).toBeLessThan(pkg)
  })
})
