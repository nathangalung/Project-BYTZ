import { MAX_PAGE } from '@kerjacus/shared'
import { describe, expect, it } from 'vitest'
import { publicPaginationSchema } from './pagination'

/**
 * GET /projects/public answers without a session and parsed both of its
 * pagination inputs with a bare Number(), so the query string went straight to
 * SQL. `?pageSize=1000000` became that LIMIT and returned the whole table to an
 * anonymous caller, and `?page=abc` became OFFSET NaN, which Postgres rejects
 * as a 500 rather than a validation error.
 *
 * Coercion has to reject rather than produce NaN, and both bounds have to hold
 * on the one route that needs no credentials to reach.
 */

describe('publicPaginationSchema', () => {
  it('keeps the 12-card grid the public browse renders', () => {
    expect(publicPaginationSchema.parse({}).pageSize).toBe(12)
    expect(publicPaginationSchema.parse({}).page).toBe(1)
  })

  it('caps how many rows one anonymous request can ask for', () => {
    expect(publicPaginationSchema.safeParse({ pageSize: 101 }).success).toBe(false)
    expect(publicPaginationSchema.safeParse({ pageSize: 1_000_000 }).success).toBe(false)
    expect(publicPaginationSchema.parse({ pageSize: 100 }).pageSize).toBe(100)
  })

  it('caps how deep the offset can reach', () => {
    expect(publicPaginationSchema.safeParse({ page: MAX_PAGE + 1 }).success).toBe(false)
    expect(publicPaginationSchema.parse({ page: MAX_PAGE }).page).toBe(MAX_PAGE)
  })

  /**
   * Number('abc') is NaN and NaN reached the query builder. Rejecting is the
   * point: a 400 naming the bad parameter beats a 500 from the database.
   */
  it('refuses input that a bare Number would turn into NaN', () => {
    for (const bad of ['abc', '', '1e400', {}, []]) {
      expect(publicPaginationSchema.safeParse({ page: bad }).success).toBe(false)
      expect(publicPaginationSchema.safeParse({ pageSize: bad }).success).toBe(false)
    }
  })

  it('refuses zero and negative pages a bare Number would pass through', () => {
    expect(publicPaginationSchema.safeParse({ page: 0 }).success).toBe(false)
    expect(publicPaginationSchema.safeParse({ page: -1 }).success).toBe(false)
    expect(publicPaginationSchema.safeParse({ pageSize: -5 }).success).toBe(false)
  })

  it('still coerces the strings a query string actually delivers', () => {
    const parsed = publicPaginationSchema.parse({ page: '3', pageSize: '24' })
    expect(parsed.page).toBe(3)
    expect(parsed.pageSize).toBe(24)
  })
})
