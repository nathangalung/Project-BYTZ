import { brdDocuments, documentChunks, getDb, prdDocuments } from '@kerjacus/db'
import { and, eq, notExists } from 'drizzle-orm'
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
 * not. The write replaces a document's chunks inside one transaction, so
 * re-requesting one that is mid-flight costs a duplicate call and nothing else.
 *
 * The done-signal is the absence of chunks, not a null embedding column. It was
 * the column until retrieval moved to document_chunks, and leaving it there
 * would have made the predicate permanently true: nothing writes that column
 * any more, so every approved document would be re-embedded every six hours
 * forever, paying for it each time and rewriting chunks that were already
 * correct. Ask the question about the table the work actually lands in.
 */

type EmbeddingBackfillResult = { brd: number; prd: number }

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
      .where(
        and(
          eq(table.status, 'approved'),
          notExists(
            db
              .select({ one: documentChunks.id })
              .from(documentChunks)
              .where(eq(documentChunks.documentId, table.id)),
          ),
        ),
      )
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
