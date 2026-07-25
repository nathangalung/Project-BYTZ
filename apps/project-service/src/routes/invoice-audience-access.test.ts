import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Owner and talent used to be served one PDF that printed the talent payout
 * above the gross total, so either party could read the platform fee off it
 * by subtraction. Copies are per audience now, and the two rules that keep
 * them apart are worth pinning: the server decides the audience, and a
 * talent's list is scoped to the milestones they worked on.
 */

const source = readFileSync(path.resolve(__dirname, './invoices.ts'), 'utf8')

describe('invoice audience', () => {
  it('derives the audience from the caller, never from the filename', () => {
    expect(source).toContain('resolveInvoiceAudience')
    expect(source).not.toContain("endsWith('-admin.pdf')")
    expect(source).not.toContain('wantsAdminCopy')
  })

  it('gives each relationship its own copy', () => {
    expect(source).toContain("if (userRole === 'admin') return 'admin'")
    expect(source).toContain("if (project.ownerId === userId) return 'owner'")
    expect(source).toContain("return 'talent'")
  })
})

describe('talent invoice scope', () => {
  it('counts assignments the talent worked, not ones they declined', () => {
    expect(source).toContain("const WORKED_STATUSES = ['active', 'completed'] as const")
    expect(source).not.toContain("eq(projectAssignments.status, 'active')")
  })

  /**
   * An assigned talent with nothing invoiced yet is authorized and simply
   * has no rows. Conflating that with "not a participant" 403s the Documents
   * tab of every talent before their first milestone settles.
   */
  it('separates having no invoices from having no standing', () => {
    expect(source).toContain('Promise<string[] | null>')
    expect(source).toContain('if (owned === null) {')
    expect(source).not.toContain('visibleMilestoneIds.length === 0')
  })

  it('hands back the authenticated route, not the private object URL', () => {
    const line = source.split('\n').find((l) => l.includes('downloadUrl:'))
    expect(line).toContain('/api/v1/projects/')
    expect(line).toContain('/invoices/')
    expect(line).toContain('.pdf')
    expect(source).not.toContain('pdfUrl: i.pdfUrl')
  })
})
