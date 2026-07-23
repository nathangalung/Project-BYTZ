import { describe, expect, it } from 'vitest'
import brdSource from './_authenticated/projects/$projectId/brd.tsx?raw'
import prdSource from './_authenticated/projects/$projectId/prd.tsx?raw'

/**
 * The document revision endpoints expect a description; the pages sent content,
 * so every revision 400d, and the raw fetch swallowed the error as a silent
 * success. The BRD content normaliser also skipped out_of_scope, leaving the
 * paid Out of Scope section always empty.
 */
describe('document revision matches the service contract', () => {
  it('BRD sends description and surfaces failure', () => {
    expect(brdSource).toContain('description: revisionText.trim()')
    expect(brdSource).toContain('if (!res.ok)')
  })

  it('PRD sends description and surfaces failure', () => {
    expect(prdSource).toContain('description: revisionText.trim()')
    expect(prdSource).toContain('if (!res.ok)')
  })
})

describe('BRD viewer shows the out-of-scope items', () => {
  it('normalises out_of_scope from the stored content', () => {
    expect(brdSource).toContain('raw.out_of_scope')
  })
})
