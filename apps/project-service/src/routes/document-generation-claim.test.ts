import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Generating a BRD or PRD is a billed, non-idempotent Gemini call, and the free
 * allowance was guarded by reading the document version, comparing it to the
 * limit, and generating. Two concurrent submits read the same version, both
 * passed, and both called the model: one allowance spent, two invoices, and no
 * duplicate row anywhere to notice it afterwards.
 *
 * The allowance is therefore claimed with a conditional UPDATE that only lands
 * while the row still holds the version it was read at, and the claim is taken
 * before the model call rather than after. A generation that then fails hands
 * the slot back, because document-generation.ts already promises the owner that
 * a failed call leaves their quota untouched.
 */

const source = readFileSync(path.resolve(__dirname, './projects.ts'), 'utf8')
const claimLib = readFileSync(path.resolve(__dirname, '../lib/document-claim.ts'), 'utf8')

function handler(marker: string): string {
  const start = source.indexOf(marker)
  expect(start, `route ${marker} not found`).toBeGreaterThan(-1)
  const next = source.indexOf('projectsRoute.', start + marker.length)
  return source.slice(start, next === -1 ? source.length : next)
}

const ROUTES = [
  {
    name: 'BRD generation',
    marker: "projectsRoute.post('/:id/generate-brd'",
    claim: "claimGeneration('brd'",
    generate: 'generateBrdContent(',
    write: '.update(brdDocuments)',
  },
  {
    name: 'PRD generation',
    marker: "projectsRoute.post('/:id/generate-prd'",
    claim: "claimGeneration('prd'",
    generate: 'generatePrdContent(',
    write: '.update(prdDocuments)',
  },
  {
    name: 'BRD revision',
    marker: "projectsRoute.post('/:id/brd/revision'",
    claim: "claimRevision('brd'",
    generate: 'generateBrdContent(',
    write: '.update(brdDocuments)',
  },
  {
    name: 'PRD revision',
    marker: "projectsRoute.post('/:id/prd/revision'",
    claim: "claimRevision('prd'",
    generate: 'generatePrdContent(',
    write: '.update(prdDocuments)',
  },
] as const

describe('document generation claim', () => {
  for (const route of ROUTES) {
    describe(route.name, () => {
      const body = handler(route.marker)

      it('claims the allowance before calling the model', () => {
        const claimAt = body.indexOf(route.claim)
        const generateAt = body.indexOf(route.generate)
        expect(claimAt, `${route.claim} missing`).toBeGreaterThan(-1)
        expect(generateAt, `${route.generate} missing`).toBeGreaterThan(-1)
        expect(claimAt).toBeLessThan(generateAt)
      })

      it('hands the allowance back when generation fails', () => {
        expect(body).toContain('releaseClaim(')
      })

      /**
       * The release belongs to the model call alone. Everything after it runs
       * on a generation already paid for, so a release in a tail finally would
       * refund a slot for a billed call.
       */
      it('scopes the release to the model call, not to the stored write', () => {
        expect(body.indexOf('releaseClaim(')).toBeLessThan(body.indexOf(route.write))
      })

      // The claim already advanced the version; bumping again would charge twice.
      it('stores the claimed version instead of re-counting the allowance', () => {
        expect(body).toContain('version: claim.version')
        expect(body).not.toMatch(/version: \(existing\w+\.version \?\? 0\) \+ 1/)
        expect(body).not.toContain('version: currentVersion + 1,')
      })
    })
  }

  // A lost race must not leave the revision instruction in the scoping thread.
  // Only the BRD revision writes one; the PRD revision regenerates from the BRD.
  it('claims a BRD revision before appending its instruction to the chat', () => {
    const body = handler("projectsRoute.post('/:id/brd/revision'")
    const instructionAt = body.indexOf('[Revisi BRD]')
    expect(instructionAt).toBeGreaterThan(-1)
    expect(body.indexOf('claimRevision(')).toBeLessThan(instructionAt)
  })

  it('claims through a conditional update rather than a read-then-write', () => {
    // The WHERE carries the version that was read, so a second caller holding
    // the same value updates nothing and is turned away.
    expect(claimLib).toMatch(/eq\(table\.version, fromVersion\)/)
    // A first generation has no row to update, so the insert is the claim.
    expect(claimLib).toContain('onConflictDoNothing')
  })

  it('turns a lost race away rather than generating a second document', () => {
    expect(claimLib).toContain('CONFLICT')
    expect(claimLib).toContain('DOCUMENT_GENERATION_LIMIT')
  })

  /**
   * The claim row is a reservation, not a document: it carries no content and
   * every read that asks whether a document exists must answer no.
   */
  it('hides an in-flight claim row from the document reads', () => {
    const guarded = source.match(/gt\((?:brd|prd)Documents\.version, 0\)/g) ?? []
    expect(guarded.length).toBeGreaterThanOrEqual(6)
  })
})
