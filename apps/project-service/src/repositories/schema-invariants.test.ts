import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Twenty-eight migrations carried no CHECK constraint at all, so every money
 * and range invariant was enforced only by Zod on the HTTP path. Anything that
 * did not arrive over HTTP skipped them: migration 0023 writes ledger rows in
 * raw SQL, the seed writes directly, and time_logs.duration_minutes came
 * straight off the client with no bound anywhere.
 *
 * These are asserted against the migrations rather than the Drizzle model
 * because the model is the intent and the migration is what reaches the
 * database.
 */

const migrationsDir = path.resolve(__dirname, '../../../../packages/db/migrations')
const sql = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .map((f) => readFileSync(path.join(migrationsDir, f), 'utf8'))
  .join('\n')

describe('money and range constraints', () => {
  const expected = [
    'work_packages_amount_positive',
    'work_packages_hours_positive',
    'work_packages_payout_within_amount',
    'milestones_amount_non_negative',
    'milestones_revision_count_non_negative',
    'projects_budget_range',
    'projects_price_split',
    'transactions_amount_positive',
    'ledger_entries_amount_positive',
    'reviews_rating_range',
    'time_logs_interval_ordered',
    'time_logs_duration_non_negative',
  ]

  for (const name of expected) {
    it(`enforces ${name}`, () => {
      expect(sql).toContain(`ADD CONSTRAINT "${name}"`)
    })
  }

  /**
   * NOT VALID takes no full-table lock and cannot fail a deploy on rows that
   * predate the rule, while still checking every new and updated row. That is
   * the only shape safe to add to a live table here.
   */
  it('adds every check NOT VALID', () => {
    const checks = sql.match(/ADD CONSTRAINT "[a-z_]+"\s+CHECK/g) ?? []
    const notValid = sql.match(/\) NOT VALID;/g) ?? []
    expect(checks.length, 'expected one check per constraint').toBe(expected.length)
    expect(notValid.length, 'every check must be NOT VALID').toBe(checks.length)
  })

  /**
   * final_price = talent_payout + platform_fee is the fee primitive. pricing.ts
   * computes it as a difference so it cannot drift, and this is the backstop
   * for anything that writes the columns without going through it.
   */
  it('backs the fee primitive with a constraint', () => {
    expect(sql).toMatch(/final_price = talent_payout \+ platform_fee/)
  })
})

describe('indexes the running queries need', () => {
  const expected = [
    // The daily revenue panel sums by status and type inside a per-day range.
    'idx_transactions_status_type_created',
    // The AI cost panel, per day and then grouped by model.
    'idx_ai_interactions_created',
    'idx_ai_interactions_model_created',
    // The notification list pages by recency; the unread index cannot order it.
    'idx_notifications_user_created',
    // The BM25 arm of hybrid_search, once per scoping message.
    'idx_brd_documents_content_fts',
    // Admin search is ILIKE '%term%'; a leading wildcard rules out btree.
    'idx_user_name_trgm',
    'idx_projects_title_trgm',
  ]

  for (const name of expected) {
    it(`creates ${name}`, () => {
      expect(sql).toContain(name)
    })
  }

  /**
   * The full-text expression has to match services/rag.py, or Postgres will
   * not use the index and the seq scan comes back unannounced.
   *
   * rag.py builds one expression for both shapes: `{field}::text`, where field
   * is the jsonb `content` column on the document tables and the text `content`
   * column on document_chunks. The cast is load-bearing for jsonb and a no-op
   * for text, which Postgres strips at parse time, so the chunk index is
   * written without it and still matches. Verified on a real database: the
   * recheck condition comes back as to_tsvector('english'::regconfig, content).
   */
  it('indexes the exact expression the query builds', () => {
    const rag = readFileSync(
      path.resolve(__dirname, '../../../ai-service/app/services/rag.py'),
      'utf8',
    )
    expect(rag).toContain("to_tsvector('english', {field}::text)")
    expect(sql).toContain("to_tsvector('english', content::text)")
  })

  /**
   * Documents are retrieved as sections, so both arms read document_chunks
   * rather than the document tables. Either index missing turns one arm of the
   * hybrid search into a sequential scan over every chunk on the platform, on
   * every scoping message.
   */
  it('indexes both arms of the chunk search', () => {
    const rag = readFileSync(
      path.resolve(__dirname, '../../../ai-service/app/services/rag.py'),
      'utf8',
    )
    expect(rag).toContain('"document_chunks" if doc_type else table')
    expect(sql).toContain('"idx_document_chunks_content_fts"')
    expect(sql).toContain('"document_chunks_embedding_hnsw_idx"')
    expect(sql).toContain('vector_cosine_ops')
  })

  /**
   * The tenant predicate on the vector arm is access control, not a filter: an
   * unscoped search once spliced every owner's BRD into other owners' scoping
   * prompts. It reads project_id straight off the chunk, so the column has to
   * be NOT NULL rather than merely present.
   */
  it('requires an owner on every chunk', () => {
    const create = sql.match(/CREATE TABLE "document_chunks"[^;]*/g)?.pop() ?? ''
    expect(create).toMatch(/"project_id" text NOT NULL/)
    expect(sql).toContain('document_chunks_project_id_projects_id_fk')
  })

  /**
   * The browse index led with (status, visibility) and claimed to supply the
   * ordering. Both routes use IN-lists, and a btree scan over a
   * ScalarArrayOpExpr does not preserve trailing-column ordering, so a Sort ran
   * over every matching row before the LIMIT. created_at has to lead.
   */
  it('orders the browse index by the column the routes sort on', () => {
    const create = sql.match(/CREATE INDEX "idx_projects_browse"[^;]*/g)?.pop() ?? ''
    expect(create).toMatch(/btree \("created_at" DESC/)
    expect(create).toContain('visibility IN')
    expect(create).toContain('status IN')
  })

  /**
   * Nothing queries skills by vector distance: hybrid_search is only ever
   * called with brd_documents, and skill matching computes cosine in JS. The
   * index was written on every skill update and never read.
   */
  it('drops the skills vector index nothing reads', () => {
    expect(sql).toContain('DROP INDEX IF EXISTS "skills_embedding_hnsw_idx"')
  })
})
