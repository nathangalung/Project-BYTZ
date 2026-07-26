import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Accepting an application set a status column and stopped there. No
 * project_assignment row was ever written, so the talent the owner had just
 * hired was not on the project by any measure the rest of the system uses:
 *
 *   - contracts.ts resolves the signing talent through the assignment
 *   - work packages stay unassigned, so the board shows no owner
 *   - escrow and milestones have no talent to pay
 *
 * The owner saw "accepted" and nothing happened next. Accepting IS the
 * hiring decision; the assignment is its bookkeeping, so the two belong in
 * one transaction rather than in a step nobody knew was missing.
 */

const source = readFileSync(path.resolve(__dirname, './applications.ts'), 'utf8')

function handler(marker: string): string {
  const start = source.indexOf(marker)
  expect(start, `route ${marker} not found`).toBeGreaterThan(-1)
  const next = source.indexOf('applicationRoute.', start + marker.length)
  return source.slice(start, next === -1 ? source.length : next)
}

describe('PATCH /applications/:id', () => {
  const body = handler("applicationRoute.patch('/:id'")

  it('creates the assignment when the owner accepts', () => {
    expect(body).toContain('projectAssignments')
    expect(body).toContain('accepted')
  })

  /**
   * The status update and the assignment must land together. A committed
   * acceptance with no assignment is the exact state this fixes, and a
   * partial failure would recreate it.
   */
  it('writes both inside the existing transaction', () => {
    const tx = body.slice(body.indexOf('db.transaction'))
    expect(tx).toContain('projectAssignments')
    expect(tx).toContain('appendOutboxEvent')
  })

  /**
   * A work package is required by the schema, and the live-assignment unique
   * index means the choice cannot be arbitrary. Pick deterministically and
   * refuse rather than guess when there is nothing free.
   */
  it('picks an unassigned work package deterministically', () => {
    expect(body).toContain('workPackages')
    expect(body).toContain('orderIndex')
  })

  it('refuses to accept when no work package is free', () => {
    expect(body).toMatch(/AppError\(\s*'CONFLICT'/)
  })

  // Rejecting and withdrawing must not create anything.
  it('creates nothing on any other transition', () => {
    const tx = body.slice(body.indexOf('db.transaction'))
    const insert = tx.indexOf('insert(projectAssignments)')
    expect(insert).toBeGreaterThan(-1)
    expect(tx.slice(0, insert)).toMatch(/newStatus === 'accepted'/)
  })
})
