// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ProgressBar } from './progress-bar'

describe('ProgressBar', () => {
  /**
   * Six bars were painted as a track div wrapping a fill div, so the value
   * existed only as pixels and a screen reader read nothing from the bar.
   */
  it('exposes the value through the progressbar role', () => {
    render(<ProgressBar value={45} label="Completeness" />)

    const bar = screen.getByRole('progressbar', { name: 'Completeness' })
    expect(bar.getAttribute('aria-valuenow')).toBe('45')
    expect(bar.getAttribute('aria-valuemin')).toBe('0')
    expect(bar.getAttribute('aria-valuemax')).toBe('100')
  })

  it('paints the fill to the value', () => {
    const { container } = render(<ProgressBar value={45} label="Completeness" />)

    expect(container.querySelector('[role="progressbar"] > div')?.getAttribute('style')).toContain(
      'width: 45%',
    )
  })

  /**
   * The role belongs on the track. The fill is the part that is done, so
   * announcing it as the progressbar reports a range whose maximum moves.
   */
  it('puts the role on the track rather than the fill', () => {
    const { container } = render(<ProgressBar value={45} label="Completeness" />)

    expect(container.querySelectorAll('[role="progressbar"]')).toHaveLength(1)
    expect(screen.getByRole('progressbar').querySelector('div')).not.toBeNull()
  })

  /** The value arrives from the server, so it is not trusted to be in range. */
  it.each([
    [140, '100'],
    [-20, '0'],
  ])('clamps %i to %s', (value, expected) => {
    render(<ProgressBar value={value} label="Progress" />)

    const bar = screen.getByRole('progressbar')
    expect(bar.getAttribute('aria-valuenow')).toBe(expected)
    expect(bar.querySelector('div')?.getAttribute('style')).toContain(`width: ${expected}%`)
  })

  it('rounds a fractional value so the announced number matches the drawn one', () => {
    render(<ProgressBar value={45.6} label="Progress" />)

    const bar = screen.getByRole('progressbar')
    expect(bar.getAttribute('aria-valuenow')).toBe('46')
    expect(bar.querySelector('div')?.getAttribute('style')).toContain('width: 46%')
  })

  it('keeps the track and fill classes the call site asked for', () => {
    render(<ProgressBar value={10} label="Progress" trackClassName="h-2" barClassName="bg-brand" />)

    const bar = screen.getByRole('progressbar')
    expect(bar.className).toContain('h-2')
    expect(bar.querySelector('div')?.className).toContain('bg-brand')
  })
})
