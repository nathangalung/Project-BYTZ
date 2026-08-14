import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const readSource = (rel: string) => readFileSync(path.resolve(__dirname, rel), 'utf8')

const dataTableSource = readSource('./data-table.tsx')
const slideOverSource = readSource('./slide-over.tsx')
const statusBadgeSource = readSource('./status-badge.tsx')

/**
 * The admin app has no DOM test environment (vitest runs in node and the repo
 * pulls in no jsdom), so these follow the house pattern of asserting against
 * source text. They pin behaviour that was missing before the component layer
 * existed and that nothing else would catch.
 */

describe('SlideOver accessibility', () => {
  // Every detail panel used to put the Escape handler on a tabIndex={-1}
  // backdrop button, which can never receive a keydown.
  it('listens for Escape on the document, not on the backdrop', () => {
    expect(slideOverSource).toContain("document.addEventListener('keydown'")
    expect(slideOverSource).toContain("e.key === 'Escape'")
    expect(slideOverSource).toContain("document.removeEventListener('keydown'")
  })

  it('restores focus to the element that opened it', () => {
    expect(slideOverSource).toContain('document.activeElement')
    expect(slideOverSource).toContain('previous?.focus()')
  })

  // Inline arrow onClose props would re-run the effect and steal focus on every
  // render, so the listener effect must not depend on the callback.
  it('keeps the listener effect keyed on open alone', () => {
    expect(slideOverSource).toContain('closeRef.current()')
    expect(slideOverSource).toMatch(/}, \[open\]\)/)
  })

  it('announces itself as a modal dialog', () => {
    expect(slideOverSource).toContain('role="dialog"')
    expect(slideOverSource).toContain('aria-modal="true"')
  })
})

describe('StatusBadge', () => {
  // These badges carry financial meaning, so colour alone is not enough.
  it('requires a label and always renders it', () => {
    expect(statusBadgeSource).toMatch(/^\s+label: string$/m)
    expect(statusBadgeSource).toContain('{label}')
  })
})

describe('DataTable', () => {
  it('handles the four data states a list can be in', () => {
    for (const state of ['isError', 'isLoading', 'emptyMessage', 'sortedRows.map']) {
      expect(dataTableSource, state).toContain(state)
    }
  })

  // Rows were click-only, so the whole table was unreachable by keyboard.
  it('makes clickable rows keyboard operable', () => {
    expect(dataTableSource).toContain('tabIndex={onRowSelect ? 0 : undefined}')
    expect(dataTableSource).toContain("e.key === 'Enter' || e.key === ' '")
  })

  it('reports sort direction to assistive tech', () => {
    expect(dataTableSource).toContain('aria-sort')
  })
})
