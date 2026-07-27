import { brdDocuments, getDb, prdDocuments } from '@kerjacus/db'
import { and, eq, isNull } from 'drizzle-orm'
import { appendOutboxEvent } from '../lib/outbox'

/**
 * Re-request embeddings for approved documents that never got one.
 *
 * The request is appended after transitionStatus has already committed, on the
 * bare pool, so a crash in that gap leaves an approved BRD or PRD with a null
 * embedding forever. ai-service only ever reacts to the event and has no
 * backfill of its own, so the document silently drops out of the RAG corpus and
 * scoping quality degrades with nothing reporting it.
 *
 * A sweep rather than a transaction because it also repairs the gaps already in
 * the database, which threading a transaction through the status change would
 * not. The embedding write is an idempotent upsert keyed by document id, so
 * re-requesting one that is mid-flight costs a duplicate call and nothing else.
 */

export type EmbeddingBackfillResult = { brd: number; prd: number }

const DOC_TABLES = [
  { kind: 'brd' as const, table: brdDocuments, subject: 'ai.brd.embed_requested' as const },
  { kind: 'prd' as const, table: prdDocuments, subject: 'ai.prd.embed_requested' as const },
]

export async function runEmbeddingBackfill(limit = 50): Promise<EmbeddingBackfillResult> {
  const db = getDb()
  const result: EmbeddingBackfillResult = { brd: 0, prd: 0 }

  for (const { kind, table, subject } of DOC_TABLES) {
    const stranded = await db
      .select({ id: table.id, projectId: table.projectId, content: table.content })
      .from(table)
      // paid documents are approved too, and both are in the corpus.
      .where(and(isNull(table.embedding), eq(table.status, 'approved')))
      .limit(limit)

    for (const doc of stranded) {
      await appendOutboxEvent(db, {
        aggregateType: kind === 'brd' ? 'brd_document' : 'prd_document',
        aggregateId: doc.id,
        eventType: subject,
        payload: {
          projectId: doc.projectId,
          documentId: doc.id,
          documentType: kind,
          content: doc.content,
        },
      })
      result[kind] += 1
    }
  }

  return result
}
