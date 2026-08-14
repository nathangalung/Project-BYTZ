import { describe, expect, it } from 'vitest'
import {
  formatCurrency,
  formatCurrencyCompact,
  formatDate,
  formatDateShort,
  formatDateTime,
} from './format'

/**
 * These helpers existed as six near-copies across apps/web and apps/admin and
 * had already drifted apart -- one printed "Rp 6jt", its twin "Rp 6 jt", and
 * two of them dropped the billions branch entirely. The point of pinning the
 * exact strings here is that the next copy cannot drift silently.
 */

// Local-time constructor keeps these assertions independent of the host TZ.
const MOMENT = new Date(2026, 7, 13, 14, 30)

describe('formatCurrency', () => {
  it('prints the exact amount with Indonesian grouping', () => {
    expect(formatCurrency(1_000_000)).toBe('Rp 1.000.000')
    expect(formatCurrency(500_000)).toBe('Rp 500.000')
    expect(formatCurrency(0)).toBe('Rp 0')
  })

  // The separator is load-bearing: it stops "Rp" wrapping off its amount.
  it('separates the symbol with a non-breaking space', () => {
    expect(formatCurrency(1_000_000)).not.toContain('Rp ')
    expect(formatCurrency(1_000_000).charCodeAt(2)).toBe(0xa0)
  })

  it('never shows fractional Rupiah', () => {
    expect(formatCurrency(1_500_000.6)).toBe('Rp 1.500.001')
  })
})

describe('formatCurrencyCompact', () => {
  it('folds millions to "jt"', () => {
    expect(formatCurrencyCompact(6_000_000)).toBe('Rp 6 jt')
    expect(formatCurrencyCompact(5_500_000)).toBe('Rp 6 jt')
    expect(formatCurrencyCompact(50_000_000)).toBe('Rp 50 jt')
  })

  /**
   * A miliar keeps folding to juta rather than gaining an "M" suffix. The
   * admin panel used to render "Rp 2.5M" and the web app never did, so
   * unifying on M would have introduced it on pages showing somebody their own
   * cumulative earnings, where M read as million instead of miliar is a 1000x
   * misread. "jt" only ever means juta.
   */
  it('keeps folding to "jt" past a miliar rather than switching suffix', () => {
    expect(formatCurrencyCompact(2_500_000_000)).toBe('Rp 2.500 jt')
    expect(formatCurrencyCompact(1_000_000_000)).toBe('Rp 1.000 jt')
    expect(formatCurrencyCompact(12_300_000_000)).toBe('Rp 12.300 jt')
  })

  it('never emits an M suffix', () => {
    for (const n of [1_000_000, 999_000_000, 1_000_000_000, 5_000_000_000]) {
      expect(formatCurrencyCompact(n)).not.toMatch(/M/)
    }
  })

  it('falls back to the exact amount below one million', () => {
    expect(formatCurrencyCompact(999_999)).toBe(formatCurrency(999_999))
    expect(formatCurrencyCompact(0)).toBe(formatCurrency(0))
  })

  // Only one boundary left now that juta runs the whole way up.
  it('switches unit exactly at one million', () => {
    expect(formatCurrencyCompact(999_999)).toBe(formatCurrency(999_999))
    expect(formatCurrencyCompact(1_000_000)).toBe('Rp 1 jt')
    expect(formatCurrencyCompact(999_999_999)).toBe('Rp 1.000 jt')
  })
})

describe('date formatters', () => {
  it('renders each width in Indonesian', () => {
    expect(formatDate(MOMENT)).toBe('13 Agustus 2026')
    expect(formatDateShort(MOMENT)).toBe('13 Agu 2026')
    expect(formatDateTime(MOMENT)).toBe('13 Agu 2026, 14.30')
  })

  it('accepts an ISO string as well as a Date', () => {
    expect(formatDate(MOMENT.toISOString())).toBe(formatDate(MOMENT))
    expect(formatDateShort(MOMENT.toISOString())).toBe(formatDateShort(MOMENT))
    expect(formatDateTime(MOMENT.toISOString())).toBe(formatDateTime(MOMENT))
  })
})
