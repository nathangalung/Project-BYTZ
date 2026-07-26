import { describe, expect, it } from 'vitest'
import PREVIEW from './_authenticated/projects/$projectId/brd.tsx?raw'

/**
 * The BRD is normalised twice - once in the web preview, once in brd-pdf.ts
 * for the paid download - because the content column is model-authored and
 * uses snake_case while the app uses camelCase.
 *
 * The two agreed on every field but one. The AI emits estimated_team_size,
 * the PDF normaliser accepts it, and the preview looked only for
 * estimatedTeamSize and team_size - so it fell through to its `|| 1` default.
 * The owner read "1 person" on screen and got the real number in the PDF they
 * paid for, on the same document.
 *
 * Every price and timeline field already reads both spellings. This pins the
 * one that did not.
 */

const SNAKE_CASE_KEYS = [
  'estimated_team_size',
  'estimated_price_min',
  'estimated_price_max',
  'estimated_timeline_days',
] as const

describe('BRD preview normalisation', () => {
  for (const key of SNAKE_CASE_KEYS) {
    it(`reads ${key} as the AI emits it`, () => {
      expect(PREVIEW).toContain(key)
    })
  }

  /**
   * A default is right for a missing field and wrong for one that is present
   * under a name nobody looked up. Reading all three spellings is what makes
   * the fallback mean "absent" rather than "misspelled".
   */
  it('falls back to a team of one only when no spelling is present', () => {
    const at = PREVIEW.indexOf('estimatedTeamSize:')
    expect(at, 'estimatedTeamSize is not normalised').toBeGreaterThan(-1)
    // The assignment may wrap, so read the expression rather than the line.
    const expression = PREVIEW.slice(at, PREVIEW.indexOf('\n', PREVIEW.indexOf('|| 1', at)))
    expect(expression).toContain('estimated_team_size')
    expect(expression).toContain('estimatedTeamSize ??')
    expect(expression).toContain('team_size')
  })
})
