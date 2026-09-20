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
 * with a position open - existed in the enum, in the state machine and in the
 * UI, and no code path had ever written it.
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
   * Dropping a package out of a `matched` project would leave it matched with
   * an open seat, which is the state the transition guard exists to prevent.
   */
  it('refuses to end an assignment before the project is running', () => {
    expect(handler).toMatch(/projectStatus !== 'in_progress'/)
    expect(handler).toMatch(/projectStatus !== 'partially_active'/)
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

  /** The first writer partially_active has ever had. */
  it('drops the running project to partially_active and logs the move', () => {
    expect(handler).toContain("status: 'partially_active'")
    expect(handler).toMatch(/eq\(projects\.status,\s*'in_progress'\)/)
    expect(handler).toContain('projectStatusLogs')
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

describe('the status this endpoint writes', () => {
  it('is reachable from a running project and is not itself a dead end', () => {
    expect(getValidTransitions('in_progress')).toContain('partially_active')
    expect(getValidTransitions('partially_active')).toContain('in_progress')
    expect(getValidTransitions('partially_active')).toContain('review')
    expect(getValidTransitions('partially_active')).toContain('cancelled')
  })
})
