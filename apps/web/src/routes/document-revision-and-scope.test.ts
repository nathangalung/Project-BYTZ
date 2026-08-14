import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const readSource = (rel: string) => readFileSync(path.resolve(__dirname, rel), 'utf8')

const brdSource = readSource('./_authenticated/projects/$projectId/brd.tsx')
const prdSource = readSource('./_authenticated/projects/$projectId/prd.tsx')

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

/**
 * out_of_scope used to be normalised inline here, and the section it feeds
 * was empty because nobody read the snake_case spelling. That normalisation
 * now lives in packages/shared/src/brd-content.ts, shared with the PDF
 * renderer, and is tested there against the content rather than the source.
 * What this file still owns is that the page delegates rather than growing a
 * second copy - which is how the two drifted in the first place.
 */
describe('BRD viewer normalisation', () => {
  it('delegates to the shared normaliser', () => {
    expect(brdSource).toContain('normalizeBrdContent')
  })

  it('keeps no second copy of its own', () => {
    expect(brdSource).not.toContain('raw.out_of_scope')
    expect(brdSource).not.toContain('raw.executive_summary')
  })
})
