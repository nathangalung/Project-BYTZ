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
  ]

  for (const name of expected) {
    it(`creates ${name}`, () => {
      expect(sql).toContain(name)
    })
  }

  /**
   * The full-text expression has to match services/rag.py byte for byte, or
   * Postgres will not use the index and the seq scan comes back unannounced.
   */
  it('indexes the exact expression the query builds', () => {
    const rag = readFileSync(
      path.resolve(__dirname, '../../../ai-service/app/services/rag.py'),
      'utf8',
    )
    expect(rag).toContain("to_tsvector('english', {content_field}::text)")
    expect(sql).toContain("to_tsvector('english', content::text)")
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
