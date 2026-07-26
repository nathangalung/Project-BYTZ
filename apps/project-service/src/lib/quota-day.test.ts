import { describe, expect, it } from 'vitest'
import { startOfQuotaDay } from './document-entitlement'

/**
 * The free document allowance is one per person per day. "Day" was midnight
 * UTC, which in Indonesia is seven in the morning - so an owner working on
 * Tuesday evening and again on Wednesday morning was still inside Tuesday's
 * quota, while one who started at 06:00 got a fresh allowance an hour later
 * for no reason they could see.
 *
 * The product is Indonesian and prices in Rupiah. The day it means is the
 * calendar day its owners are living in.
 */

describe('startOfQuotaDay', () => {
  it('starts the day at midnight in Jakarta, not in UTC', () => {
    // 02:00 WIB on 3 March is 19:00 UTC on 2 March. The day began at
    // 17:00 UTC on 2 March, not at midnight UTC on either date.
    const at = new Date('2026-03-02T19:00:00Z')
    expect(startOfQuotaDay(at).toISOString()).toBe('2026-03-02T17:00:00.000Z')
  })

  it('keeps a late-evening request inside the day the owner is in', () => {
    // 23:30 WIB on 2 March is 16:30 UTC the same day - still 2 March in
    // Jakarta, so the window must not have rolled over yet.
    const at = new Date('2026-03-02T16:30:00Z')
    expect(startOfQuotaDay(at).toISOString()).toBe('2026-03-01T17:00:00.000Z')
  })

  it('rolls over at Jakarta midnight', () => {
    const before = new Date('2026-03-02T16:59:59Z')
    const after = new Date('2026-03-02T17:00:00Z')
    expect(startOfQuotaDay(before).getTime()).toBeLessThan(startOfQuotaDay(after).getTime())
  })

  /**
   * WIB is UTC+7 year round - Indonesia observes no daylight saving - so the
   * offset is a constant rather than something to look up per date.
   */
  it('uses the same offset in both halves of the year', () => {
    const jan = new Date('2026-01-15T12:00:00Z')
    const jul = new Date('2026-07-15T12:00:00Z')
    const offset = (d: Date) => d.getTime() - startOfQuotaDay(d).getTime()
    expect(offset(jan)).toBe(offset(jul))
  })
})
