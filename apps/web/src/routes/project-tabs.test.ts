import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Read from disk rather than `?raw`. A `?raw` import registers the file in
 * vitest's module graph carrying no executable code, and v8's uncovered-files
 * pass then treats it as already seen, so the file drops out of the coverage
 * denominator entirely and scores 100% on 0/0.
 */
const read = (rel: string) => readFileSync(path.resolve(__dirname, rel), 'utf8')

const detailShared = read('../components/project/detail/shared.tsx')
const paymentsSource = read('./_authenticated/payments/index.tsx')
const routeSource = read('./_authenticated/projects/$projectId/index.tsx')
const settingsSource = read('./_authenticated/settings.tsx')
const registerSource = read('./_public/register.tsx')

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
