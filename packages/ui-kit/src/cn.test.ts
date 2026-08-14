import { describe, expect, it } from 'vitest'
import { cn } from './cn'

/**
 * cn is two libraries in a trench coat, and the merge half is the reason it
 * exists. clsx alone would join "px-2" and "px-4" into a class list where the
 * loser depends on stylesheet order rather than call order, so a component that
 * accepts a className prop could not reliably override anything.
 */

describe('cn', () => {
  it('joins plain class names', () => {
    expect(cn('inline-flex', 'items-center')).toBe('inline-flex items-center')
  })

  it('drops falsy entries rather than printing them', () => {
    expect(cn('base', false, null, undefined, '')).toBe('base')
  })

  it('takes conditional shapes clsx accepts', () => {
    expect(cn('base', { active: true, disabled: false })).toBe('base active')
    expect(cn(['a', 'b'], 'c')).toBe('a b c')
  })

  /** The last conflicting utility wins, which is what makes overrides work. */
  it('lets a later utility beat an earlier one in the same group', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4')
    expect(cn('bg-red-500', 'bg-blue-500')).toBe('bg-blue-500')
  })

  it('keeps utilities that do not conflict', () => {
    expect(cn('px-2', 'py-4')).toBe('px-2 py-4')
  })

  /** A caller's className arrives last, so it has to be able to override. */
  it('gives the caller class the final say', () => {
    expect(cn('rounded-full px-2.5', 'px-6')).toBe('rounded-full px-6')
  })

  it('returns an empty string when given nothing', () => {
    expect(cn()).toBe('')
  })
})
