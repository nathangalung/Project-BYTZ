import { describe, expect, it } from 'vitest'
import { formatDuration, formatShortDate, formatTimerDisplay } from './format'

describe('formatDuration', () => {
  it('drops the hour when there is none', () => {
    expect(formatDuration(45)).toBe('45m')
  })

  it('drops the minutes when the hour is whole', () => {
    expect(formatDuration(120)).toBe('2h')
  })

  it('shows both parts otherwise', () => {
    expect(formatDuration(150)).toBe('2h 30m')
  })

  /**
   * Zero is what a freshly created log reads, and "0m" is the honest render.
   * Falling through to an empty string would leave the row blank.
   */
  it('renders zero as zero minutes', () => {
    expect(formatDuration(0)).toBe('0m')
  })

  it('does not fold sixty minutes into a stray zero', () => {
    expect(formatDuration(60)).toBe('1h')
  })

  it('keeps counting past a day rather than wrapping', () => {
    expect(formatDuration(1500)).toBe('25h')
  })
})

describe('formatTimerDisplay', () => {
  it('starts at zero, zero-padded', () => {
    expect(formatTimerDisplay(0)).toBe('00:00:00')
  })

  it('pads single digits so the display does not jump width', () => {
    expect(formatTimerDisplay(5)).toBe('00:00:05')
    expect(formatTimerDisplay(65)).toBe('00:01:05')
  })

  it('rolls minutes into hours', () => {
    expect(formatTimerDisplay(3600)).toBe('01:00:00')
    expect(formatTimerDisplay(3661)).toBe('01:01:01')
  })

  /**
   * The hour field is not clamped to two digits by the format, only padded to
   * them, so a timer left running overnight reads 25 rather than 01.
   */
  it('lets the hour grow past two digits rather than wrapping to zero', () => {
    expect(formatTimerDisplay(90_061)).toBe('25:01:01')
  })
})

describe('formatShortDate', () => {
  /**
   * The log groups entries by day, so the label carries the weekday. Pinned to
   * id-ID by the formatter rather than the host locale, which is what keeps a
   * CI runner in another locale from rendering a different string.
   */
  it('renders an Indonesian weekday and month', () => {
    expect(formatShortDate('2026-08-13T09:00:00.000Z')).toBe('Kam, 13 Agu')
  })

  it('reads the date part rather than the offset from midnight UTC', () => {
    expect(formatShortDate('2026-01-01T12:00:00.000Z')).toBe('Kam, 1 Jan')
  })
})
