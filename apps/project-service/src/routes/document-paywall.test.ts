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
const settlement = readFileSync(
  path.join(__dirname, '../services/payment-settlement.service.ts'),
  'utf8',
)

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

  /**
   * Settling a payment moved out of the route into
   * PaymentSettlementService, where each branch is asserted against a
   * retried notification rather than against the shape of a handler. What
   * stays here is that the paywall's own column is the one being stamped.
   */
  it('stamps paidAt when a document payment completes', () => {
    expect(settlement).toContain('paidAt: new Date()')
  })

  /**
   * Still keyed off paidAt, but the key is now in the WHERE clause rather than
   * an if above it. Reading the column and then writing it let two retried
   * notifications both see null and both report a fresh sale.
   */
  it('keys payment idempotency off paidAt, which survives revisions', () => {
    expect(settlement).toMatch(/isNull\(table\.paidAt\)/)
    expect(settlement).toContain('already processed')
  })

  it('caps revisions through the shared gate and hard-stops the paid cap', () => {
    expect(projects).toContain('revisionGate(currentVersion, brdPaid, FREE_BRD_GENERATIONS)')
    expect(projects).toContain('revisionGate(currentVersion, prdPaid, FREE_PRD_GENERATIONS)')
    // The paid cap raises a distinct error, never the pay-to-unlock 402.
    expect(projects).toContain('DOCUMENT_REVISION_LIMIT')
  })

  it('caps a brand-new document by the daily free quota', () => {
    expect(projects).toContain("dailyDocsCreated(user.id, 'brd')")
    expect(projects).toContain("dailyDocsCreated(user.id, 'prd')")
    expect(projects).toContain('DOCUMENT_DAILY_LIMIT')
  })
})
