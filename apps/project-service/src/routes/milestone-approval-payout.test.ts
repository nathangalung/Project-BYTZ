import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Approving a milestone paid the talent, and the payout call sat in a
 * try/catch that logged the failure and carried on. So a release that failed -
 * an unfunded project, an escrow pool another talent had already drained, the
 * payment service down - left the milestone approved with no money moved. That
 * state is terminal for a milestone and is what tells the talent they have
 * been paid, and the only trace was a log line.
 *
 * The payout now runs first and the approval is only recorded once it returns.
 * The release is idempotent by milestone, so a retry after a lost response
 * replays instead of paying twice.
 */

const source = readFileSync(path.resolve(__dirname, './milestones.ts'), 'utf8')

const handler = (() => {
  const marker = "milestonesRoute.patch('/milestones/:id/status'"
  const start = source.indexOf(marker)
  expect(start, 'status route not found').toBeGreaterThan(-1)
  const next = source.indexOf('milestonesRoute.', start + marker.length)
  return source.slice(start, next === -1 ? source.length : next)
})()

describe('PATCH /milestones/:id/status', () => {
  it('settles escrow before it records the approval', () => {
    const settle = handler.indexOf('settleMilestoneEscrow')
    const approve = handler.indexOf('updateMilestoneStatus')

    expect(settle).toBeGreaterThan(-1)
    expect(approve).toBeGreaterThan(-1)
    expect(settle).toBeLessThan(approve)
  })

  it('settles against the submitted milestone, which is the state it is still in', () => {
    expect(handler).toMatch(/settleMilestoneEscrow\([^)]*'submitted'\)/)
  })

  it('does not swallow a failed payout', () => {
    const settleBlock = handler.slice(
      handler.indexOf('settleMilestoneEscrow'),
      handler.indexOf('updateMilestoneStatus'),
    )
    expect(settleBlock).toContain('throw')
  })

  /**
   * The invoice request no longer sits after the approval in this handler, it
   * commits with it inside updateStatus's transaction. Ordering by line number
   * was the weaker guarantee: it held only while nothing crashed in between.
   * milestone-invoice-atomicity.test.ts asserts the stronger one.
   */
  it('leaves the invoice request to the transaction that records the approval', () => {
    expect(handler).not.toContain('invoice_requested')
  })
})
