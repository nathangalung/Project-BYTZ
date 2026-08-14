import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import EN from '../locales/en/admin.json'
import ID from '../locales/id/admin.json'

const readSource = (rel: string) => readFileSync(path.resolve(__dirname, rel), 'utf8')

const ROOT = readSource('./__root.tsx')
const DASHBOARD = readSource('./_authenticated/dashboard.tsx')
const LAYOUT = readSource('./_authenticated.tsx')

/**
 * The admin panel had no error boundary anywhere. The root wrapped Outlet in
 * Suspense, which catches nothing a render throws, so one bad field in an API
 * response left an admin staring at a blank page with no way back.
 */

describe('admin error boundary', () => {
  it('guards the root, where a throw would otherwise blank the page', () => {
    expect(ROOT).toContain('<ErrorBoundary>')
    // Inside the shell div, so the fallback still paints on a full-height background.
    expect(ROOT.indexOf('min-h-screen bg-primary-600 text-neutral-100')).toBeLessThan(
      ROOT.indexOf('<ErrorBoundary>'),
    )
  })

  it('also guards the routes, so a route error keeps the shell', () => {
    expect(LAYOUT).toContain('<ErrorBoundary>')
    expect(LAYOUT).toContain('<Outlet />')
  })

  /** Admin ships a single `admin` namespace; a `common` lookup renders the key. */
  it('has both fallback strings in both locales', () => {
    for (const bundle of [ID, EN] as Record<string, string>[]) {
      expect(bundle.something_wrong).toBeTruthy()
      expect(bundle.retry).toBeTruthy()
    }
  })
})

/**
 * recharts is a third of the admin bundle and lives on one route. Loading it
 * lazily lets the dashboard paint its metric cards before the charts arrive.
 */
describe('admin dashboard chunk', () => {
  it('defers recharts to its own chunk', () => {
    expect(DASHBOARD).not.toContain("from 'recharts'")
    expect(DASHBOARD).toContain("import('@/components/dashboard/charts')")
    expect(DASHBOARD).toContain('<Suspense fallback={<ChartSkeleton />}>')
  })
})
