// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Toast } from './toast'

describe('Toast', () => {
  /**
   * A toast appears without the user asking, so it has to announce itself.
   * polite rather than assertive because it never interrupts what is being
   * read - the notification is not worth cutting someone off for.
   */
  it('announces itself politely', () => {
    render(<Toast type="success" message="Tersimpan" onClose={vi.fn()} />)

    const alert = screen.getByRole('alert')
    expect(alert.getAttribute('aria-live')).toBe('polite')
    expect(alert.textContent).toContain('Tersimpan')
  })

  it('closes when the dismiss control is pressed', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<Toast type="info" message="Halo" onClose={onClose} />)

    await user.click(screen.getByRole('button', { name: 'Dismiss notification' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['success', 'bg-success-500/10'],
    ['error', 'bg-error-500/10'],
    ['warning', 'bg-accent-cream-500/20'],
    ['info', 'bg-brand-accent/10'],
  ] as const)('tints the %s toast', (type, expectedClass) => {
    render(<Toast type={type} message="Halo" onClose={vi.fn()} />)

    expect(screen.getByRole('alert').className).toContain(expectedClass)
  })

  /** Alpha changes between themes, which no token expresses. See badge.test. */
  it('dims the warning tint in dark mode', () => {
    render(<Toast type="warning" message="Halo" onClose={vi.fn()} />)

    expect(screen.getByRole('alert').className).toContain('dark:bg-accent-cream-500/8')
  })

  /**
   * Colour cannot be the only carrier of the success/error distinction, so
   * each type also gets its own icon.
   */
  it.each(['success', 'error', 'warning', 'info'] as const)(
    'gives the %s toast an icon',
    (type) => {
      const { container } = render(<Toast type={type} message="Halo" onClose={vi.fn()} />)

      // The status icon plus the X on the dismiss button.
      expect(container.querySelectorAll('svg')).toHaveLength(2)
    },
  )

  it('uses a different icon for success than for error', () => {
    const { container: success } = render(<Toast type="success" message="Halo" onClose={vi.fn()} />)
    const successPath = success.querySelector('svg')?.innerHTML

    const { container: error } = render(<Toast type="error" message="Halo" onClose={vi.fn()} />)
    const errorPath = error.querySelector('svg')?.innerHTML

    expect(successPath).toBeTruthy()
    expect(successPath).not.toBe(errorPath)
  })

  /**
   * Fake timers are scoped to this block rather than the file. user-event
   * schedules its own delays on the same clock, so installing fakes around a
   * click leaves it waiting on a clock nothing advances, and it times out.
   */
  describe('auto-dismiss', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('closes after the default five seconds and not before', () => {
      const onClose = vi.fn()
      render(<Toast type="info" message="Halo" onClose={onClose} />)

      act(() => {
        vi.advanceTimersByTime(4999)
      })
      expect(onClose).not.toHaveBeenCalled()

      act(() => {
        vi.advanceTimersByTime(1)
      })
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('honours a caller-supplied duration', () => {
      const onClose = vi.fn()
      render(<Toast type="info" message="Halo" onClose={onClose} duration={1000} />)

      act(() => {
        vi.advanceTimersByTime(1000)
      })

      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('fires once, not once per interval', () => {
      const onClose = vi.fn()
      render(<Toast type="info" message="Halo" onClose={onClose} duration={100} />)

      act(() => {
        vi.advanceTimersByTime(1000)
      })

      expect(onClose).toHaveBeenCalledTimes(1)
    })

    /**
     * The timer is cleared on unmount. Without that a toast the container has
     * already dropped still fires onClose, which removes whichever toast now
     * holds that id.
     */
    it('does not fire after it has been unmounted', () => {
      const onClose = vi.fn()
      const { unmount } = render(<Toast type="info" message="Halo" onClose={onClose} />)

      unmount()
      act(() => {
        vi.advanceTimersByTime(10_000)
      })

      expect(onClose).not.toHaveBeenCalled()
    })

    /**
     * onClose is in the effect's dependency list, so a parent that rebuilds
     * the callback on every render restarts the countdown. Pinning it means a
     * toast that never disappears shows up here rather than in someone's face.
     */
    it('restarts the countdown when the handler identity changes', () => {
      const first = vi.fn()
      const second = vi.fn()
      const { rerender } = render(<Toast type="info" message="Halo" onClose={first} />)

      act(() => {
        vi.advanceTimersByTime(4000)
      })
      rerender(<Toast type="info" message="Halo" onClose={second} />)
      act(() => {
        vi.advanceTimersByTime(4000)
      })

      expect(first).not.toHaveBeenCalled()
      expect(second).not.toHaveBeenCalled()

      act(() => {
        vi.advanceTimersByTime(1000)
      })
      expect(second).toHaveBeenCalledTimes(1)
    })
  })
})
