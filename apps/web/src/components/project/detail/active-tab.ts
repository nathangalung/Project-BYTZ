import { TABS, type Tab } from './shared'

/**
 * Which tab a project-detail address belongs to, if any.
 *
 * The header and the tab strip are rendered once by the `$projectId` layout
 * route, so the layout - not the page - has to know which tab is showing. It
 * only has the address, and `/projects/p-1/brd` is not a tab at all: BRD, PRD,
 * scoping, checkout and matching are drill-ins reached from the content, they
 * have no entry in `TABS`, and they keep the back link and header they already
 * had. `null` says "not a tabbed page", which is how the layout decides to
 * render nothing but the outlet.
 *
 * Kept pure and separate from the layout component so every address can be
 * asserted directly instead of through nine renders.
 */
export function activeTabForPath(pathname: string): Tab | null {
  const match = /^\/projects\/[^/]+(?:\/([^/]*))?\/?$/.exec(pathname)
  if (!match) return null
  // No trailing segment (or a bare trailing slash) is the overview tab.
  const segment = match[1] ?? ''
  if (segment === '') return 'overview'
  return TABS.find((tab) => tab === segment) ?? null
}
