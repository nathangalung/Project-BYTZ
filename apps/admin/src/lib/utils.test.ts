import { describe, expect, it } from 'vitest'
import { cn, formatCurrencyCompact, formatDateShort, initials } from './utils'

/**
 * The formatters are re-exported from @kerjacus/ui-kit and covered there; the
 * two assertions on them here are a wiring check, so a barrel that stops
 * exporting one, or is repointed at a local copy, fails in this app rather
 * than silently.
 *
 * initials is the admin-only helper: it renders the avatar fallback in the
 * user table and in every detail panel header.
 */

describe('initials', () => {
  it('takes the first letter of the first two words', () => {
    expect(initials('Budi Santoso')).toBe('BS')
  })

  it('uppercases a lowercase name', () => {
    expect(initials('budi santoso')).toBe('BS')
  })

  it('caps at two letters however many names there are', () => {
    expect(initials('Raden Mas Budi Santoso')).toBe('RM')
  })

  it('returns a single letter for a single name', () => {
    expect(initials('Budi')).toBe('B')
  })

  /** The panel header calls this with '' whenever no row is selected. */
  it('returns nothing for an empty name instead of throwing', () => {
    expect(initials('')).toBe('')
  })

  it('handles a non-Latin name without dropping the character', () => {
    expect(initials('Ïbu Ani')).toBe('ÏA')
  })
})

describe('re-exported formatters', () => {
  it('still folds a miliar to juta rather than switching suffix', () => {
    expect(formatCurrencyCompact(2_500_000_000)).toBe('Rp 2.500 jt')
  })

  it('still exposes the short date formatter', () => {
    expect(formatDateShort('2026-07-24T00:00:00.000Z')).toMatch(/\d/)
  })

  it('still merges conflicting Tailwind classes last-wins', () => {
    expect(cn('px-4', 'px-6')).toBe('px-6')
  })
})
