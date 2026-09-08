// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { beforeAll, describe, expect, it } from 'vitest'
import i18n from '@/lib/i18n'
import { TIMELINE_BRACKETS, timelineBracketKey } from '@/lib/timeline-range'
import { TimelineRange } from './timeline-range'

/**
 * The complaint: an owner picked "2-4 bulan" and every screen afterwards said
 * "90 hari" - a precision they never gave, and a number that reads like a
 * commitment rather than the range they actually chose.
 */

beforeAll(async () => {
  await i18n.changeLanguage('id')
})

describe('the timeline an owner is shown', () => {
  it('shows the range the owner picked, not the integer behind it', () => {
    const { container } = render(<TimelineRange days={90} />)

    expect(container.textContent).toBe('2-4 Bulan')
    expect(container.textContent).not.toContain('90')
  })

  it.each(TIMELINE_BRACKETS.map((bracket) => [bracket.days, bracket.key]))(
    'maps %i days back to %s',
    (days, key) => {
      expect(timelineBracketKey(days as number)).toBe(key)
    },
  )

  /**
   * A project created before the wizard, or one the AI has re-estimated, has a
   * number that belongs to no bracket. Rounding it into the nearest range would
   * put words in the owner's mouth.
   */
  it('keeps the integer when the number matches no bracket', () => {
    const { container } = render(<TimelineRange days={73} />)

    expect(container.textContent).toBe('73 hari')
  })

  it('says nothing is set rather than rendering a bare unit', () => {
    const { container } = render(<TimelineRange days={null} />)

    expect(container.textContent).toBe('Belum ditentukan')
  })

  it('returns no bracket for a missing number', () => {
    expect(timelineBracketKey(undefined)).toBeNull()
    expect(timelineBracketKey(null)).toBeNull()
  })
})
