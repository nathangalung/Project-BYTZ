import { describe, expect, it } from 'vitest'
import SOURCE from './modal.tsx?raw'

/**
 * The modal declares `aria-modal="true"`, which tells assistive technology the
 * rest of the page is inert. It did not honour that: focus never moved into
 * the dialog on open, and Tab walked straight out of it into the page behind -
 * so for a keyboard or screen reader user the dialog announced itself as modal
 * and then silently was not.
 */

describe('modal focus handling', () => {
  it('claims to be modal', () => {
    expect(SOURCE).toContain('aria-modal="true"')
  })

  it('moves focus into the dialog on open', () => {
    expect(SOURCE).toContain('querySelector<HTMLElement>(FOCUSABLE)')
  })

  it('traps Tab inside the dialog', () => {
    expect(SOURCE).toContain("if (e.key !== 'Tab') return")
    expect(SOURCE).toContain('e.shiftKey')
    expect(SOURCE).toContain('last.focus()')
    expect(SOURCE).toContain('first.focus()')
  })

  it('still restores focus to the trigger on close', () => {
    expect(SOURCE).toContain('previousFocusRef.current?.focus()')
  })
})
