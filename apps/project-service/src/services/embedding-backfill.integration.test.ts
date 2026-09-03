import { brdDocuments, documentChunks, getDb, projects, user } from '@kerjacus/db'
import { connectTestDatabase, hasTestDatabase, type TestHandle } from '@kerjacus/db/testing'
import { sql } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { runEmbeddingBackfill } from './embedding-backfill'

/**
 * The sweep re-requests indexing for approved documents that have none.
 *
 * It is tested against a real database because its whole behaviour is one
 * predicate, and the previous test asserted the predicate's source text. That
 * passed unchanged when retrieval moved to document_chunks and nothing wrote
 * brd_documents.embedding any more, which made `isNull(table.embedding)`
 * permanently true: every approved document would have been re-embedded every
 * six hours forever, paying for it each pass. A text match cannot tell a
 * predicate that selects everything from one that selects the right rows.
 */

const INTEGRATION_LOCK = sql`SELECT pg_advisory_lock(20260813)`

describe.skipIf(!hasTestDatabase())('embedding backfill against Postgres', () => {
  let handle: TestHandle
  let ownerId: string

  beforeAll(async () => {
    handle = await connectTestDatabase()
    await handle.db.execute(INTEGRATION_LOCK)
    getDb(process.env.TEST_DATABASE_URL)
  }, 120_000)

  afterAll(async () => {
    await handle.close()
  })

  beforeEach(async () => {
    await handle.truncate()
    ownerId = uuidv7()
    await handle.db.insert(user).values({ id: ownerId, name: 'Owner', email: `${ownerId}@e.test` })
  })

  async function approvedDocument(status: 'approved' | 'draft' = 'approved') {
    const projectId = uuidv7()
    const documentId = uuidv7()
    await handle.db.insert(projects).values({
      id: projectId,
      ownerId,
      title: 'Marketplace',
      description: 'desc',
      category: 'web_app',
      budgetMin: 1,
      budgetMax: 2,
      estimatedTimelineDays: 30,
    })
    await handle.db.insert(brdDocuments).values({
      id: documentId,
      projectId,
      content: { executive_summary: 'a managed marketplace' },
      price: 99_000,
      status,
    })
    return { projectId, documentId }
  }

  it('re-requests a document that has no chunks', async () => {
    await approvedDocument()
    const result = await runEmbeddingBackfill()
    expect(result.brd).toBe(1)
  })

  /**
   * The regression. Chunks are the done-signal now, so a document that has
   * them must be left alone no matter what the embedding column says.
   */
  it('skips a document that already has chunks', async () => {
    const { projectId, documentId } = await approvedDocument()
    await handle.db.insert(documentChunks).values({
      id: uuidv7(),
      documentId,
      documentType: 'brd',
      projectId,
      sectionTitle: 'executive summary',
      sectionOrder: 0,
      content: 'a managed marketplace',
    })

    const result = await runEmbeddingBackfill()
    expect(result.brd).toBe(0)
  })

  it('does not settle: a second pass over indexed documents stays quiet', async () => {
    const { projectId, documentId } = await approvedDocument()
    await handle.db.insert(documentChunks).values({
      id: uuidv7(),
      documentId,
      documentType: 'brd',
      projectId,
      sectionTitle: 'scope',
      sectionOrder: 0,
      content: 'web application',
    })

    expect((await runEmbeddingBackfill()).brd).toBe(0)
    expect((await runEmbeddingBackfill()).brd).toBe(0)
  })

  /** Only approved documents are in the corpus; a draft is not stranded. */
  it('ignores a document that is not approved', async () => {
    await approvedDocument('draft')
    expect((await runEmbeddingBackfill()).brd).toBe(0)
  })

  /**
   * Chunks are keyed per document, so another document's chunks must not
   * satisfy this one. A correlated subquery gets this right and an
   * uncorrelated EXISTS silently does not.
   */
  it('does not let one document’s chunks cover another', async () => {
    const indexed = await approvedDocument()
    await approvedDocument()
    await handle.db.insert(documentChunks).values({
      id: uuidv7(),
      documentId: indexed.documentId,
      documentType: 'brd',
      projectId: indexed.projectId,
      sectionTitle: 'scope',
      sectionOrder: 0,
      content: 'web application',
    })

    expect((await runEmbeddingBackfill()).brd).toBe(1)
  })

  it('bounds a pass to the limit it was given', async () => {
    await approvedDocument()
    await approvedDocument()
    await approvedDocument()
    expect((await runEmbeddingBackfill(2)).brd).toBe(2)
  })

  it('writes the event the ai-service consumer listens for', async () => {
    const { documentId } = await approvedDocument()
    await runEmbeddingBackfill()

    const events = await handle.db.execute(
      sql`SELECT event_type, payload FROM outbox_events WHERE aggregate_id = ${documentId}`,
    )
    const row = (events as unknown as Array<Record<string, unknown>>)[0]
    expect(row.event_type).toBe('ai.brd.embed_requested')
    expect((row.payload as Record<string, unknown>).documentType).toBe('brd')
  })
})

describe.skipIf(!hasTestDatabase())('backfill scheduling', () => {
  it('is wired into the scheduler and cleared on shutdown', async () => {
    const { readFileSync } = await import('node:fs')
    const path = await import('node:path')
    const scheduler = readFileSync(path.resolve(__dirname, './scheduled-jobs.ts'), 'utf8')
    expect(scheduler).toContain('runEmbeddingBackfill')
    expect(scheduler).toContain('clearInterval(embeddingBackfillIntervalId)')
  })
})
