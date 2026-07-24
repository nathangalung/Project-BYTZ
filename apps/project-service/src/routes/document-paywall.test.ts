import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Downloading a BRD or PRD is the paid deliverable. The gate must be the paid
 * entitlement (paidAt), not the review lifecycle (status), because a revision
 * resets status to review and would otherwise re-lock a document the owner has
 * already paid for.
 */
const projects = readFileSync(path.join(__dirname, 'projects.ts'), 'utf8')

describe('document paywall', () => {
  it('gates downloads and revision caps on the paid entitlement', () => {
    const gates = projects.match(/isDocumentPaid\(projectId, '(?:brd|prd)', \w+\.paidAt\)/g) ?? []
    // Two downloads plus two revision caps, all reading one entitlement source.
    expect(gates).toHaveLength(4)
  })

  it('does not gate downloads on review status', () => {
    expect(projects).not.toContain("brd.status !== 'paid'")
    expect(projects).not.toContain("prd.status !== 'paid'")
  })

  it('stamps paidAt when a document payment completes', () => {
    expect(projects).toContain('paidAt: new Date()')
  })

  it('keys payment idempotency off paidAt, which survives revisions', () => {
    expect(projects).toMatch(/if \(brd\.paidAt\)/)
    expect(projects).toMatch(/if \(prd\.paidAt\)/)
  })

  it('caps unpaid revisions at the free limit and paid ones at nine', () => {
    expect(projects).toContain('brdPaid ? MAX_PAID_DOC_VERSION : FREE_BRD_GENERATIONS')
    expect(projects).toContain('prdPaid ? MAX_PAID_DOC_VERSION : FREE_PRD_GENERATIONS')
  })
})
