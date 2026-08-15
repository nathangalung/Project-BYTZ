import * as uiKit from '@kerjacus/ui-kit'
import { describe, expect, it } from 'vitest'
import * as utils from './utils'

/**
 * The barrel roughly fifty call sites import their formatting from.
 *
 * Its own comment says it exists so apps/web and apps/admin cannot drift apart
 * again, which makes the assertion worth writing an identity one: every name
 * this file hands out has to BE the @kerjacus/ui-kit function, not a same-named
 * local copy. A web-only re-implementation of formatCurrency would still type
 * check, still render Rupiah, and still be exactly the drift the package was
 * created to end - so nothing but identity catches it.
 *
 * Output formats are pinned in the ui-kit package's own tests, not restated
 * here. What is restated is the one product decision CLAUDE.md calls out by
 * name, because it is the consumer side that gets it wrong: compact Rupiah
 * folds to juta all the way up, never to a "M" that reads as either million or
 * miliar on a page showing somebody their cumulative earnings.
 */

const REQUIRED = ['cn', 'formatCurrency', 'formatCurrencyCompact', 'formatDate', 'formatDateShort']

/**
 * Copied out of the namespaces once, because indexing a namespace import by a
 * computed key is what noDynamicNamespaceImportAccess forbids - it defeats
 * tree-shaking at the call site. Comparing whole surfaces needs the keys, so
 * the copy is the way to keep the check without the pattern.
 */
const exported: Record<string, unknown> = { ...utils }
const shared: Record<string, unknown> = { ...uiKit }

describe('the formatting barrel', () => {
  it.each(REQUIRED)('hands out a callable %s', (name) => {
    expect(typeof exported[name]).toBe('function')
  })

  /** Any export at all, not just the five, or a new one could shadow quietly. */
  it('re-exports the shared implementation rather than a local copy', () => {
    const names = Object.keys(exported)
    expect(names.length).toBeGreaterThan(0)
    for (const name of names) {
      expect(exported[name]).toBe(shared[name])
    }
  })

  it('exports nothing the shared package does not define', () => {
    expect(Object.keys(exported).filter((n) => !(n in shared))).toEqual([])
  })
})

describe('the class merger reached through the barrel', () => {
  it('keeps the later utility when two fight over the same property', () => {
    expect(utils.cn('px-2', 'px-4')).toBe('px-4')
  })

  it('drops a falsy branch instead of printing it', () => {
    expect(utils.cn('block', false && 'hidden')).toBe('block')
  })
})

describe('the compact Rupiah reached through the barrel', () => {
  it('folds a miliar to juta rather than to an ambiguous M', () => {
    const folded = utils.formatCurrencyCompact(2_500_000_000)

    expect(folded).toContain('jt')
    expect(folded).not.toMatch(/\bM\b/)
  })

  it('leaves an amount below a juta unfolded', () => {
    expect(utils.formatCurrencyCompact(750_000)).not.toContain('jt')
  })
})
