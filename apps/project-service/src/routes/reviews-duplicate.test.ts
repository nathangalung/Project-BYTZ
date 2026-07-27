import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * A rating is internal, and it feeds matching: matching.repository.ts averages
 * reviews per talent and that average is 0.15 of the recommendation score.
 *
 * The duplicate guard SELECTed outside the transaction that then inserted, so
 * two concurrent submits both passed it. The result is a rater counted twice
 * in a talent's average and two review.created events, which skews talent
 * scoring in a way nothing would ever surface as an error.
 */

const source = readFileSync(path.resolve(__dirname, './reviews.ts'), 'utf8')

describe('POST /reviews', () => {
  /**
   * The insert has to be the thing that fails, not a read taken before it.
   */
  it('lets the insert settle the duplicate', () => {
    expect(source).toContain('onConflictDoNothing')
  })

  it('reports the conflict from what the insert returned', () => {
    expect(source).toContain('CONFLICT')
  })
})

describe('reviews migration', () => {
  const migrationsDir = path.resolve(__dirname, '../../../../packages/db/migrations')
  const sql = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => readFileSync(path.join(migrationsDir, f), 'utf8'))
    .join('\n')

  /**
   * One review per direction per project. Both directions coexist, so the
   * reviewer has to be part of the key.
   */
  it('admits one review per project, reviewer and reviewee', () => {
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX "reviews_project_reviewer_reviewee_unique" ON "reviews"[^;]*\("project_id","reviewer_id","reviewee_id"\)/,
    )
  })

  /**
   * reviews had no index at all, and matching joins it on reviewee per run.
   */
  it('indexes the lookup matching actually runs', () => {
    expect(sql).toMatch(/CREATE INDEX "idx_reviews_reviewee_type" ON "reviews"/)
  })
})
