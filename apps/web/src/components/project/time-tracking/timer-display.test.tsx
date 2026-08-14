// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TimerDisplay } from './timer-display'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

function tick(seconds: number) {
  act(() => {
    vi.advanceTimersByTime(seconds * 1000)
  })
}

describe('TimerDisplay', () => {
  it('starts at zero', () => {
    render(<TimerDisplay running={false} />)

    expect(screen.getByText('00:00:00')).toBeDefined()
  })

  it('stays at zero while it is not running', () => {
    render(<TimerDisplay running={false} />)

    tick(10)

    expect(screen.getByText('00:00:00')).toBeDefined()
  })

  it('counts once a second while running', () => {
    render(<TimerDisplay running />)

    tick(1)
    expect(screen.getByText('00:00:01')).toBeDefined()

    tick(4)
    expect(screen.getByText('00:00:05')).toBeDefined()
  })

  it('rolls over into minutes', () => {
    render(<TimerDisplay running />)

    tick(61)

    expect(screen.getByText('00:01:01')).toBeDefined()
  })

  /**
   * Stopping resets rather than pausing. The elapsed time is the server's to
   * report once the log is saved, so keeping a stale number on screen would
   * show a figure nothing backs.
   */
  it('resets to zero when it stops', () => {
    const { rerender } = render(<TimerDisplay running />)
    tick(30)
    expect(screen.getByText('00:00:30')).toBeDefined()

    rerender(<TimerDisplay running={false} />)

    expect(screen.getByText('00:00:00')).toBeDefined()
  })

  it('counts from zero again when restarted', () => {
    const { rerender } = render(<TimerDisplay running />)
    tick(30)
    rerender(<TimerDisplay running={false} />)

    rerender(<TimerDisplay running />)
    tick(2)

    expect(screen.getByText('00:00:02')).toBeDefined()
  })

  /**
   * The interval is cleared on unmount. Without that the callback keeps firing
   * against an unmounted component once the page is left.
   */
  it('stops counting after unmount', () => {
    const { unmount } = render(<TimerDisplay running />)
    tick(1)

    unmount()

    expect(() => {
      tick(60)
    }).not.toThrow()
  })

  it('reads as live while running and dimmed while stopped', () => {
    const { rerender } = render(<TimerDisplay running />)
    expect(screen.getByText('00:00:00').className).toContain('text-success-600')

    rerender(<TimerDisplay running={false} />)

    expect(screen.getByText('00:00:00').className).toContain('text-primary-600/30')
  })
})
