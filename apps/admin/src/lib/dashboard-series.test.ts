import { describe, expect, it } from 'vitest'
import {
  buildAiCostSeries,
  buildRevenueTrendSeries,
  compactNumber,
  type DailyAiCostPoint,
  type DailyRevenuePoint,
  formatUsd,
  toDayLabel,
} from './dashboard-series'

/**
 * AI spend on glm-5.3 lands in fractions of a cent: a scoping turn
 * costs about $0.0008. Intl currency formatting and toFixed(2) both round that
 * to $0.00, so the panel would have reported the platform's AI bill as zero
 * until it crossed a cent per day. formatUsd widens the precision below $1.
 *
 * The series builders take the backend's generate_series output, which already
 * emits one row per day including days with no interactions, so they must not
 * drop, reorder, or collapse anything.
 */

describe('toDayLabel', () => {
  it('shortens an ISO date to day/month', () => {
    expect(toDayLabel('2026-07-24')).toBe('24/7')
  })

  it('keeps the raw string when the date is unparseable', () => {
    expect(toDayLabel('not-a-date')).toBe('not-a-date')
  })
})

describe('formatUsd', () => {
  it.each([
    [0, '$0'],
    [-1, '$0'],
    [0.0008, '$0.0008'],
    [0.0421, '$0.042'],
    [0.42, '$0.420'],
    [1.5, '$1.50'],
    [1234.567, '$1234.57'],
  ])('formats %d as %s', (value, expected) => {
    expect(formatUsd(value)).toBe(expected)
  })

  // A sub-cent bill must never read as nothing spent.
  it('never renders a real cost as zero', () => {
    for (const v of [0.0001, 0.0009, 0.005, 0.009]) {
      expect(formatUsd(v)).not.toBe('$0')
      expect(formatUsd(v)).not.toBe('$0.00')
    }
  })
})

describe('buildAiCostSeries', () => {
  const daily: DailyAiCostPoint[] = [
    { date: '2026-07-23', costUsd: 0.0012, requests: 3, tokens: 5200 },
    { date: '2026-07-24', costUsd: 0.0421, requests: 15, tokens: 65100 },
  ]

  it('maps every day the backend sent, in order', () => {
    expect(buildAiCostSeries(daily)).toEqual([
      { date: '23/7', cost: 0.0012, requests: 3 },
      { date: '24/7', cost: 0.0421, requests: 15 },
    ])
  })

  it('keeps zero-cost days so the trend line has no gaps', () => {
    const withGap: DailyAiCostPoint[] = [
      { date: '2026-07-23', costUsd: 0, requests: 0, tokens: 0 },
      ...daily.slice(1),
    ]
    expect(buildAiCostSeries(withGap)).toHaveLength(2)
    expect(buildAiCostSeries(withGap)[0]).toEqual({ date: '23/7', cost: 0, requests: 0 })
  })

  it.each([
    ['undefined', undefined],
    ['empty', [] as DailyAiCostPoint[]],
  ])('returns an empty series when the payload is %s', (_name, input) => {
    expect(buildAiCostSeries(input)).toEqual([])
  })
})

describe('buildRevenueTrendSeries', () => {
  const daily: DailyRevenuePoint[] = [
    {
      date: '2026-07-24',
      brdRevenue: 150000,
      prdRevenue: 350000,
      marginRevenue: 2500000,
      revisionFee: 0,
      totalRevenue: 3000000,
    },
  ]

  it('plots the daily total', () => {
    expect(buildRevenueTrendSeries(daily)).toEqual([{ date: '24/7', revenue: 3000000 }])
  })

  it.each([
    ['undefined', undefined],
    ['empty', [] as DailyRevenuePoint[]],
  ])('returns an empty series when the payload is %s', (_name, input) => {
    expect(buildRevenueTrendSeries(input)).toEqual([])
  })
})

describe('compactNumber', () => {
  it.each([
    [0, '0'],
    [980, '980'],
    [4650.71, '4.7K'],
    [65100, '65.1K'],
    [1200000, '1.2M'],
  ])('renders %d as %s', (value, expected) => {
    expect(compactNumber.format(value)).toBe(expected)
  })
})
