import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The BRD and PRD are the product. Every route that has read their content
 * used to hand it to the owner whole before a rupiah had changed hands, so a
 * buyer could take the blueprint - stack, schema, endpoints, the priced
 * decomposition - and have it built somewhere else for nothing.
 *
 * Source-text assertions because the routes need a database to run: what they
 * pin is that no read of content bypasses the gate, which is a property of the
 * call sites rather than of a response. The projection itself is covered by
 * visibility.test.ts, which runs the real function.
 */
const projects = readFileSync(path.join(__dirname, 'projects.ts'), 'utf8')

describe('every route that reads document content', () => {
  it('sends the project page through the gate with a resolved unlock', () => {
    expect(projects).toContain("await documentUnlock(id, 'brd', brd, isOwnerViewer)")
    expect(projects).toContain("await documentUnlock(id, 'prd', prd, isOwnerViewer)")
  })

  it('sends GET /:id/brd through the gate rather than returning the row', () => {
    expect(projects).toContain("await documentUnlock(projectId, 'brd', brd, true)")
    expect(projects).not.toContain('data: brd }')
  })

  it('sends GET /:id/prd through the gate rather than returning the row', () => {
    expect(projects).toContain("await documentUnlock(projectId, 'prd', prd, isOwner)")
    expect(projects).not.toContain('data: prd ?? null')
  })

  it('lets an assigned talent read the PRD as their brief', () => {
    // Resolved once and passed to the gate, so the talent branch and the
    // authorisation check cannot disagree about who is a participant.
    expect(projects).toContain(
      'const participant = isOwner ? false : await isAssignedTalent(projectId, user.id)',
    )
  })

  it('projects the freshly generated body too, so a regenerate is no way round', () => {
    expect(projects).toContain('data: brdPaid ? brdData : brdBuyerContent(brdData)')
    expect(projects).toContain('data: prdPaid ? prdData : prdBuyerContent(prdData)')
  })
})

describe('the PDF downloads', () => {
  // These were already right, and the point of pinning them is that they stay
  // a refusal: downgrading them to a buyer view would be handing out a
  // document that is supposed to be the paid deliverable.
  it('refuse outright until the document is paid for', () => {
    expect(projects).toContain("if (!(await isDocumentPaid(projectId, 'brd', brd.paidAt))) {")
    expect(projects).toContain("if (!(await isDocumentPaid(projectId, 'prd', prd.paidAt))) {")
    expect(projects).toContain("throw new AppError('DOCUMENT_NOT_PAID', 'Pay for the BRD")
    expect(projects).toContain("throw new AppError('DOCUMENT_NOT_PAID', 'Pay for the PRD")
  })

  it('render from the stored content, never from a projection', () => {
    expect(projects).toContain('content: normalizeBrdContent(raw)')
    expect(projects).toContain('content: normalizePrdContent(raw)')
  })
})
