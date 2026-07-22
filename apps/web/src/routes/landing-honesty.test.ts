import { describe, expect, it } from 'vitest'
import indexSource from './index.tsx?raw'

/**
 * The landing page showed a 4.8/5 average rating as a string literal, sat
 * between two genuinely fetched counts and gated only on the stats request
 * having succeeded, so it read as measured. No rating aggregate exists in
 * /api/v1/projects/stats, and CLAUDE.md keeps ratings internal precisely so a
 * public score cannot compound into more work for whoever already has it.
 *
 * With no reviews in the database the testimonial section substituted a
 * five-star quote attributed to a named person with a job title, rendered
 * identically to a real one.
 */

describe('landing page statistics', () => {
  it('shows no invented rating', () => {
    expect(indexSource).not.toContain('4.8')
  })

  it('renders each stat from the fetched object', () => {
    const statBlock = indexSource.slice(
      indexSource.indexOf('<StatItem'),
      indexSource.lastIndexOf('<StatItem'),
    )
    for (const [, expr] of statBlock.matchAll(/value=\{([^}]+)\}/g)) {
      expect(expr).toMatch(/stats|t\(/)
    }
  })
})

describe('testimonials', () => {
  it('invents no person when there are no reviews', () => {
    expect(indexSource).not.toContain('testimonial_name')
    expect(indexSource).not.toContain('testimonial_role')
    expect(indexSource).not.toContain('testimonial_quote')
  })

  it('still renders real ones', () => {
    expect(indexSource).toContain('reviews')
  })
})
