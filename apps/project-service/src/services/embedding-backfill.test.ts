import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The embedding request is appended after transitionStatus has already
 * committed, on the bare pool, so a crash in that gap leaves an approved
 * document with a null embedding forever. ai-service only ever reacts to the
 * event and has no backfill, so the document drops out of the RAG corpus
 * silently and scoping quality degrades with nothing reporting it.
 *
 * This is swept rather than made transactional because the gaps already in the
 * database will not self-heal either, and a transaction around the status
 * change would not repair them.
 */

const source = readFileSync(path.resolve(__dirname, './embedding-backfill.ts'), 'utf8')
const scheduler = readFileSync(path.resolve(__dirname, './scheduled-jobs.ts'), 'utf8')

describe('embedding backfill', () => {
  it('looks for approved documents with no embedding', () => {
    expect(source).toContain('isNull(table.embedding)')
    expect(source).toMatch(/eq\(table\.status, 'approved'\)/)
  })

  it('covers both document types', () => {
    expect(source).toContain('ai.brd.embed_requested')
    expect(source).toContain('ai.prd.embed_requested')
  })

  /**
   * A sweep with no bound would ship the full content of every stranded
   * document into the outbox in one pass.
   */
  it('bounds how many it re-requests per pass', () => {
    expect(source).toMatch(/\.limit\(limit\)/)
  })
})

describe('scheduler', () => {
  it('runs the backfill and stops it on shutdown', () => {
    expect(scheduler).toContain('runEmbeddingBackfill')
    expect(scheduler).toContain('clearInterval(embeddingBackfillIntervalId)')
  })
})
