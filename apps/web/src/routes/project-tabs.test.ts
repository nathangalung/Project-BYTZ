import { describe, expect, it } from 'vitest'
import detailShared from '../components/project/detail/shared.tsx?raw'
import paymentsSource from './_authenticated/payments/index.tsx?raw'
import routeSource from './_authenticated/projects/$projectId/index.tsx?raw'
import settingsSource from './_authenticated/settings.tsx?raw'
import registerSource from './_public/register.tsx?raw'

/**
 * Four full pages under projects/$projectId had no inbound link anywhere:
 * milestones (812 lines, the only place a milestone can be submitted or
 * approved, so the only entry to escrow release), documents (contract
 * signing), time-tracking, and matching. Project detail rendered its own
 * read-only stubs in tabs of the same name instead, so the features looked
 * present and were not reachable.
 *
 * The tabs are links now. These tests fail if a tab goes back to local state,
 * and if a tab ever points at a route file that does not exist.
 */

// Vite resolves this at build time, so no node:fs in a browser app.
const projectRoutes = Object.keys(
  import.meta.glob('./_authenticated/projects/$projectId/*.tsx'),
).map((p) => p.split('/').pop())

/**
 * The tab map moved to components/project/detail/shared when the 880-line
 * route was split. The rule spans both files now, so both are read - the
 * route must still hold no tab state, and the map must still name real pages.
 */
const indexSource = routeSource + detailShared

describe('project detail tabs', () => {
  it('links out instead of holding tab state', () => {
    expect(indexSource).toContain('TAB_ROUTES')
    expect(indexSource).not.toContain('setActiveTab')
  })

  it.each(['milestones', 'documents', 'time-tracking'])('points %s at a real page', (tab) => {
    expect(indexSource).toContain(`/projects/$projectId/${tab}`)
    expect(projectRoutes).toContain(`${tab}.tsx`)
  })

  it('renders no stub in place of a real page', () => {
    for (const stub of ['function MilestonesTab', 'function DocumentsTab', 'function ChatTab']) {
      expect(indexSource).not.toContain(stub)
    }
  })
})

describe('controls with no backend are gone', () => {
  // No CSV export endpoint exists in any service.
  it('shows no export button on payment history', () => {
    expect(paymentsSource).not.toContain('export_csv')
  })

  // No account-deletion endpoint exists either, and the button had no handler.
  it('offers no account deletion it cannot perform', () => {
    expect(settingsSource).not.toContain('DangerZoneSection')
    expect(settingsSource).not.toContain('confirm_delete')
  })

  it('does not link the consent line to a route that does not exist', () => {
    expect(registerSource).not.toContain('href="/terms"')
  })
})
