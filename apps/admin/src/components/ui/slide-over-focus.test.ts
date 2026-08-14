import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const readSource = (rel: string) => readFileSync(path.resolve(__dirname, rel), 'utf8')

const SOURCE = readSource('./slide-over.tsx')

/**
 * The panel declares `aria-modal="true"`, which tells assistive technology the
 * rest of the page is inert. It focused the panel on open but never trapped
 * Tab, so the next Tab left the dialog for the table behind it while the
 * dialog was still announced as modal.
 */

describe('slide-over focus handling', () => {
  it('claims to be modal', () => {
    expect(SOURCE).toContain('aria-modal="true"')
  })

  it('moves focus to the first control rather than the bare panel', () => {
    expect(SOURCE).toContain('querySelector<HTMLElement>(FOCUSABLE)')
  })

  it('traps Tab inside the panel', () => {
    expect(SOURCE).toContain("if (e.key !== 'Tab') return")
    expect(SOURCE).toContain('e.shiftKey')
    expect(SOURCE).toContain('last.focus()')
    expect(SOURCE).toContain('first.focus()')
  })

  it('still restores focus to the trigger on close', () => {
    expect(SOURCE).toContain('previous?.focus()')
  })
})
