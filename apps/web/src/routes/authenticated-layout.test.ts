import { describe, expect, it } from 'vitest'
import SOURCE from './_authenticated.tsx?raw'

/**
 * The shell is one viewport tall and scrolls inside main, so the sidebar is
 * meant to stay put. Two things broke that in practice: 100vh is larger than
 * the visible area on a mobile browser whose URL bar collapses, which leaves
 * a strip of background below the sidebar as you scroll, and the nav clipped
 * its own links with no way to reach them.
 */

function block(marker: string, chars = 400): string {
  const start = SOURCE.indexOf(marker)
  expect(start, `${marker} not found`).toBeGreaterThan(-1)
  return SOURCE.slice(start, start + chars)
}

describe('authenticated shell', () => {
  it('sizes itself to the visible viewport, not to 100vh', () => {
    expect(SOURCE).toContain('h-dvh')
    expect(SOURCE).not.toContain('flex h-screen')
  })

  /**
   * Five links, a header, a role label and a logout footer do not fit a phone
   * in landscape. overflow-hidden did not shrink them, it cut them off, and
   * nothing scrolled to reach what was cut.
   */
  it('lets the nav scroll instead of clipping links away', () => {
    const nav = block('<nav')
    expect(nav).toContain('overflow-y-auto')
    expect(nav).not.toContain('overflow-hidden')
  })

  it('keeps main as the scrolling region', () => {
    expect(block('id="main-content"')).toContain('overflow-y-auto')
  })
})
