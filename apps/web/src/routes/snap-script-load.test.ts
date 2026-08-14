import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const readSource = (rel: string) => readFileSync(path.resolve(__dirname, rel), 'utf8')

const SOURCE = readSource('./_authenticated/projects/$projectId/checkout.tsx')

/**
 * The hook tracked "we started loading" in a component ref. On a remount it
 * found the existing script tag and attached a `load` listener - which never
 * fires again once the script has finished - so `ready` stayed false and the
 * Pay button was permanently disabled. The listener was never removed either.
 *
 * Load state belongs to the document, not to a component instance.
 */

describe('Midtrans Snap script loading', () => {
  it('caches the load on the module, not on a component ref', () => {
    expect(SOURCE).toContain('let snapLoader: Promise<void> | null = null')
    expect(SOURCE).not.toContain('const loaded = useRef(false)')
  })

  it('does not wait on a load event that has already fired', () => {
    expect(SOURCE).not.toContain("addEventListener('load'")
    expect(SOURCE).toContain('if (window.snap)')
  })

  it('lets a failed load be retried', () => {
    expect(SOURCE).toContain('snapLoader = null')
  })
})
