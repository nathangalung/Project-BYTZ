import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Approving a milestone pays the talent and then owes three invoice copies.
 *
 * The invoice event was appended in the route with the bare pool, one
 * statement after updateMilestoneStatus had already committed on its own. A
 * crash in that gap left the talent paid, the milestone terminally approved,
 * and no invoice for anybody - plus a permanent hole in the per-project
 * invoice_number sequence, which nothing reconciles.
 *
 * The route's comment claimed "outbox commit gives us durability so a crash
 * here cannot drop the invoice work". That is true of the row and false of the
 * pair, which is the whole point of the pattern.
 *
 * updateStatus already runs a transaction and already appends the status event
 * inside it, so the invoice event belongs there too - beside the write it has
 * to be atomic with, not one caller away from it.
 */

const repo = readFileSync(path.resolve(__dirname, './milestone.repository.ts'), 'utf8')
const route = readFileSync(path.resolve(__dirname, '../routes/milestones.ts'), 'utf8')

describe('milestone approval', () => {
  it('appends the invoice event inside the status transaction', () => {
    const start = repo.indexOf('async updateStatus(')
    const body = repo.slice(start, repo.indexOf('\n  async ', start + 1))

    expect(start, 'updateStatus not found').toBeGreaterThan(-1)
    expect(body).toContain('MILESTONE_SUBJECTS.INVOICE_REQUESTED')
    expect(body).toMatch(/appendOutboxEvent\(tx,/)
  })

  /**
   * The pool overload is what made the bug expressible. Passing `db` here
   * compiles and silently degrades the pair to two autocommits.
   */
  it('no longer appends the invoice event from the route', () => {
    expect(route).not.toContain('invoice_requested')
  })
})
