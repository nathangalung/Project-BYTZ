import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { getValidTransitions } from '../lib/state-machine'

/**
 * There was no way to end an assignment once it had been accepted.
 *
 * A talent who had to step away and an owner who needed to replace one had the
 * same two options: leave the assignment standing forever, or cancel the whole
 * project and refund the escrow. `partially_active` - a project still running
 * with a position open - was the status this route was built to write, and it
 * is gone: a running project with an open seat is an `in_progress` project
 * holding an `unassigned` work package, which is one fact in one place rather
 * than two that could disagree.
 */

const source = readFileSync(path.resolve(__dirname, './matching.ts'), 'utf8')

const handler = (() => {
  const marker = "matchingRoute.post('/assignments/:id/terminate'"
  const start = source.indexOf(marker)
  expect(start, 'terminate route not found').toBeGreaterThan(-1)
  const next = source.indexOf('matchingRoute.', start + marker.length)
  return source.slice(start, next === -1 ? source.length : next)
})()

describe('POST /matching/assignments/:id/terminate', () => {
  it('admits the owner and the assigned talent, and refuses everyone else', () => {
    expect(handler).toContain('assignment.talentUserId === user.id')
    expect(handler).toContain('assignment.ownerId === user.id')
    expect(handler).toMatch(/if \(!byTalent && !byOwner\)/)
    expect(handler).toMatch(/AppError\(\s*'AUTH_FORBIDDEN'/)
  })

  /**
   * loadOwnAssignment joins on talent_profiles.user_id, so it can only ever
   * recognise the talent. The owner needs the project row in the same read.
   */
  it('reads the project owner rather than reusing the talent-only lookup', () => {
    expect(handler).toContain('.innerJoin(projects,')
    expect(handler).not.toContain('loadOwnAssignment(db')
  })

  /** A pending offer is declined; terminate is for work already taken on. */
  it('only ends an accepted, active assignment', () => {
    expect(handler).toMatch(/assignment\.status !== 'active'/)
    expect(handler).toMatch(/assignment\.acceptanceStatus !== 'accepted'/)
  })

  /**
   * Reopening a package on a project that has not started leaves it staffing a
   * seat nothing is waiting on, and the project has its own restaffing routes
   * until work begins. `in_progress` is now the whole of "running": the second
   * status this guard used to admit said "running, one seat open", which the
   * reopened package says by itself.
   */
  it('refuses to end an assignment before the project is running', () => {
    const guard = source.slice(source.indexOf('function assertProjectRunning('))
    const body = guard.slice(0, guard.indexOf('\n}'))
    expect(body).toMatch(/status !== 'in_progress'/)
    expect(body.match(/status !== '/g), 'running is the only position admitted').toHaveLength(1)
    expect(handler).toContain('assertProjectRunning(')
  })

  /**
   * The assignment claim is compare-and-set, but the project status lives on a
   * different row and the pre-flight read takes no lock. Checked again under
   * the lock, or a termination racing the owner's move to review reopens a
   * work package on a project nobody is building any more.
   */
  it('re-checks the project status under the lock, not only before it', () => {
    const tx = handler.slice(handler.indexOf('db.transaction'))
    const lock = tx.indexOf(".for('update')")
    const check = tx.indexOf('assertProjectRunning(')
    expect(lock, 'no project lock').toBeGreaterThan(-1)
    expect(check, 'status is not re-checked inside the transaction').toBeGreaterThan(lock)
    expect(tx).toContain('locked?.status')
  })

  /**
   * Same lock, same position, as accept, decline and confirm. Taking them the
   * other way round in one handler turns the race into a deadlock.
   */
  it('takes the project lock before touching the work package', () => {
    const lock = handler.indexOf(".for('update')")
    const pkg = handler.indexOf('.update(workPackages)')
    expect(pkg, 'work package write not found').toBeGreaterThan(-1)
    expect(lock, 'no project lock').toBeGreaterThan(-1)
    expect(lock).toBeLessThan(pkg)
  })

  it('claims the assignment rather than writing on its id alone', () => {
    const start = handler.indexOf('.update(projectAssignments)')
    expect(start, 'assignment update not found').toBeGreaterThan(-1)
    const end = handler.indexOf('.returning(', start)
    expect(end, 'the write does not report whether it landed').toBeGreaterThan(start)
    const update = handler.slice(start, end)
    expect(update).toMatch(/eq\(projectAssignments\.status,\s*'active'\)/)
    expect(update).toMatch(/eq\(projectAssignments\.acceptanceStatus,\s*'accepted'\)/)
  })

  it('reopens the position so the owner can staff it again', () => {
    expect(handler).toMatch(/\.update\(workPackages\)[\s\S]*?status: 'unassigned'/)
  })

  /**
   * The premise this replaces - "drops the project to partially_active and
   * logs the move" - is gone with the status. An open seat is the reopened
   * work package above and nothing else, so the handler must not write a
   * second, separate record of it: no status on the project, and no status log
   * for a move that never happens. Two records of one fact is how they came to
   * disagree.
   */
  it('leaves the running project where it is and logs no move', () => {
    const write = handler.slice(handler.indexOf('.update(projects)'))
    expect(handler.indexOf('.update(projects)'), 'project write not found').toBeGreaterThan(-1)
    expect(write.slice(0, write.indexOf('.where'))).not.toContain('status:')
    expect(handler).not.toContain('projectStatusLogs')
  })

  /**
   * completed_at is the column findRecentAbandons reads. Writing it on an
   * owner-initiated termination would charge the talent the abandonment
   * penalty for a decision that was not theirs.
   */
  it('stamps completed_at only when the talent walks away', () => {
    expect(handler).toMatch(/byTalent \? \{ completedAt: new Date\(\) \} : \{\}/)
  })

  it('does not mark the offer declined, which is a different outcome', () => {
    expect(handler).not.toContain("acceptanceStatus: 'declined'")
  })

  it('emits an event the notification side can tell from a decline', () => {
    expect(handler).toContain('TALENT_SUBJECTS.ASSIGNMENT_TERMINATED')
  })
})

describe('the position this endpoint leaves the project in', () => {
  /**
   * There is no longer a position for "running with a seat open", so there is
   * no status for this endpoint to write and none for it to climb back out of.
   * The project stays `in_progress`, whose only moves are on to final review
   * and out to cancelled - a degraded position would need a back edge, and the
   * line has none.
   */
  it('is in_progress, which still leads on to final review', () => {
    expect(getValidTransitions('in_progress')).toEqual(['final_review', 'cancelled'])
  })
})
