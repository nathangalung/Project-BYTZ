import { describe, expect, it } from 'vitest'
import { activeTabForPath } from './active-tab'
import { TAB_ROUTES, TABS } from './shared'

/**
 * The layout route reads the address to decide which tab is lit and whether to
 * draw the header at all, so every address under `/projects/$projectId` is
 * asserted here rather than through a render per page.
 */

describe('activeTabForPath', () => {
  it.each(TABS)('lights %s from its own route', (tab) => {
    expect(activeTabForPath(TAB_ROUTES[tab].replace('$projectId', 'p-1'))).toBe(tab)
  })

  it('reads a bare project address as the overview tab', () => {
    expect(activeTabForPath('/projects/p-1')).toBe('overview')
  })

  it('reads a trailing slash as the overview tab too', () => {
    expect(activeTabForPath('/projects/p-1/')).toBe('overview')
  })

  /**
   * The drill-ins are reached from the content and return to the project, not
   * to the list. They have no tab, so the layout leaves them exactly as they
   * were rather than hanging a strip with nothing lit over them.
   */
  it.each(['scoping', 'brd', 'prd', 'checkout', 'matching'])('claims no tab for %s', (page) => {
    expect(activeTabForPath(`/projects/p-1/${page}`)).toBeNull()
  })

  it.each(['/projects', '/projects/', '/talent', '/projects/p-1/documents/x', ''])(
    'claims no tab outside project detail: %s',
    (pathname) => {
      expect(activeTabForPath(pathname)).toBeNull()
    },
  )
})
