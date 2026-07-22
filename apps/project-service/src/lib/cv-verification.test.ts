import { describe, expect, it } from 'vitest'
import { CV_VERIFY_MIN_CONFIDENCE, verificationFromParse } from './cv-verification'

/**
 * Nothing ever moved a talent past 'unverified'.
 *
 * talent-profiles.ts writes 'unverified' on create and again on update, and no
 * other code in any service writes the column. Meanwhile talents.ts and
 * matching.repository.ts both filter on 'verified', so a real talent was
 * invisible to the directory and to matching forever. It only looked like it
 * worked because seed.ts inserts seven pre-verified profiles.
 *
 * CLAUDE.md is explicit that CV parsing is the only vetting stage and that a
 * talent is verified once the CV parses, so the transition belongs on the parse
 * result. A parse that recovered nothing must not verify anyone.
 */

describe('verificationFromParse', () => {
  it('verifies a confident parse', () => {
    expect(verificationFromParse(0.9)).toBe('verified')
  })

  it('verifies at the threshold', () => {
    expect(verificationFromParse(CV_VERIFY_MIN_CONFIDENCE)).toBe('verified')
  })

  // Below 50 characters of text the route returns 0.0 and empty fields.
  it('leaves an empty parse unverified', () => {
    expect(verificationFromParse(0)).toBe('unverified')
  })

  it('leaves a weak parse unverified', () => {
    expect(verificationFromParse(CV_VERIFY_MIN_CONFIDENCE - 0.01)).toBe('unverified')
  })

  // The regex fallback caps at 0.7, so a good fallback still verifies.
  it('accepts a strong regex fallback', () => {
    expect(verificationFromParse(0.7)).toBe('verified')
  })

  it('treats a missing score as unverified', () => {
    expect(verificationFromParse(undefined)).toBe('unverified')
    expect(verificationFromParse(Number.NaN)).toBe('unverified')
  })

  it('never verifies on an out-of-range score', () => {
    expect(verificationFromParse(-1)).toBe('unverified')
  })
})

describe('threshold', () => {
  it('sits between an empty parse and a usable one', () => {
    expect(CV_VERIFY_MIN_CONFIDENCE).toBeGreaterThan(0)
    expect(CV_VERIFY_MIN_CONFIDENCE).toBeLessThan(0.7)
  })
})
