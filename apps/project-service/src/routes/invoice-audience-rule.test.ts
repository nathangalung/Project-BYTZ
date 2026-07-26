import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Who may see which invoice copy is decided in two places, and it has to be
 * the same rule in both: a talent sees a milestone if they are its named
 * assignee, or if they hold a live assignment on its work package. The second
 * arm exists because an integration milestone spans several talents and names
 * none of them.
 *
 * The two are not one function by choice. resolveInvoiceAudience answers for
 * a single milestone; talentMilestoneIds lists every milestone on a project a
 * talent may see. Collapsing them would mean calling the single-milestone
 * lookup once per row, which is the N+1 the batch query exists to avoid.
 *
 * What is shared is the rule, so what is pinned here is the rule. Getting it
 * wrong is not a 500 - it is an owner's gross shown on a talent's invoice, or
 * a talent's payout shown to another talent, and CLAUDE.md is explicit that
 * one copy must never carry both numbers.
 */

const source = readFileSync(path.resolve(__dirname, './invoices.ts'), 'utf8')

function resolver(marker: string, until: string): string {
  const start = source.indexOf(marker)
  expect(start, `${marker} not found`).toBeGreaterThan(-1)
  const end = source.indexOf(until, start)
  return source.slice(start, end === -1 ? source.length : end)
}

const perMilestone = resolver(
  'async function resolveInvoiceAudience',
  'async function talentMilestoneIds',
)
const perProject = resolver('async function talentMilestoneIds', 'invoiceRoute.')

describe('the invoice audience rule', () => {
  /**
   * A live assignment is active or completed. A terminated or replaced talent
   * must not keep reading the invoices of work they no longer hold, and both
   * resolvers have to agree on that or one of them leaks.
   */
  it('counts the same assignment statuses as live in both resolvers', () => {
    expect(source).toContain("const WORKED_STATUSES = ['active', 'completed'] as const")
    expect(perMilestone).toContain('WORKED_STATUSES')
    expect(perProject).toContain('WORKED_STATUSES')
  })

  it('reads the named assignee in both', () => {
    expect(perMilestone).toContain('assignedTalentId')
    expect(perProject).toContain('assignedTalentId')
  })

  /**
   * The integration-milestone arm. Without it a talent who did the work on a
   * shared milestone cannot see the invoice for it, because nobody is named.
   */
  it('falls back to the work package in both', () => {
    expect(perMilestone).toContain('workPackageId')
    expect(perProject).toContain('workPackageId')
  })

  // The owner short-circuit has to come first, or an owner who also holds a
  // talent profile on their own project would be served the talent copy.
  it('answers owner before it considers any talent path', () => {
    const owner = perMilestone.indexOf("return 'owner'")
    const talent = perMilestone.indexOf("return 'talent'")
    expect(owner).toBeGreaterThan(-1)
    expect(talent).toBeGreaterThan(owner)
  })

  it('answers admin before either', () => {
    const admin = perMilestone.indexOf("return 'admin'")
    expect(admin).toBeGreaterThan(-1)
    expect(admin).toBeLessThan(perMilestone.indexOf("return 'owner'"))
  })

  /**
   * Neither resolver may fall through to a default. An unmatched caller is
   * not an owner with nothing to show; they have no business reading it.
   */
  it('refuses a caller who matches nothing', () => {
    expect(perMilestone).toContain('AUTH_FORBIDDEN')
  })
})
