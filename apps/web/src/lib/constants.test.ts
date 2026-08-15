import { describe, expect, it } from 'vitest'
import { API_VERSION, PAGINATION } from './constants'

/**
 * A barrel with no importers.
 *
 * Nothing under apps/web/src imports '@/lib/constants' or './constants' -
 * every route builds its own URL string and every paginated call site writes
 * its own pageSize. So this file re-exports two names the app never reads,
 * and this test is currently its only consumer. Recorded here rather than
 * deleted because deletion is a source change and this pass is tests only.
 *
 * The values are asserted literally, not compared against @kerjacus/shared.
 * Comparing the re-export to its own source would pass no matter what either
 * side became; the point of pinning them is that the API path segment and the
 * page-size cap are wire contract, shared with the Hono services.
 */
describe('the constants re-exported to apps/web', () => {
  it('names the v1 API prefix the services actually route', () => {
    expect(API_VERSION).toBe('v1')
  })

  it('starts pagination at page one, not zero', () => {
    expect(PAGINATION.DEFAULT_PAGE).toBe(1)
  })

  it('asks for twenty rows by default', () => {
    expect(PAGINATION.DEFAULT_PAGE_SIZE).toBe(20)
  })

  /** The cap is what stops a client asking a service for every row it has. */
  it('caps a page at a hundred rows', () => {
    expect(PAGINATION.MAX_PAGE_SIZE).toBe(100)
  })

  it('keeps the default below the cap', () => {
    expect(PAGINATION.DEFAULT_PAGE_SIZE).toBeLessThanOrEqual(PAGINATION.MAX_PAGE_SIZE)
  })
})
