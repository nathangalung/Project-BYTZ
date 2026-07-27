import { describe, expect, it } from 'vitest'
import en from '../locales/en/admin.json'
import id from '../locales/id/admin.json'
import usersSource from './_authenticated/users.tsx?raw'

/**
 * The role tabs counted the rows already on screen. Those rows are one page of
 * an already role-filtered query, so selecting "Owners" showed Talents (0) and
 * the active tab never counted past the page size. Counts now read the
 * server-side total per role.
 */

const bundles = { id, en } as Record<string, Record<string, string>>

describe('user role tab counts', () => {
  it('reads the server total instead of the rendered rows', () => {
    expect(usersSource).toContain('results[0].data?.total')
    expect(usersSource).toContain('results[1].data?.total')
    expect(usersSource).toContain('results[2].data?.total')
    expect(usersSource).not.toMatch(/users\.filter\(\(u\)\s*=>\s*u\.role/)
  })

  // A count query only needs the total, never the page of rows.
  it('asks for a single row per count query', () => {
    expect(usersSource).toContain('pageSize: 1')
  })

  it('keeps the counts in step with the settled search term', () => {
    expect(usersSource).toContain('useRoleCounts(list.debouncedSearch)')
  })

  it('refreshes the counts after a suspend or reactivate', () => {
    expect(usersSource).toContain("queryKey: ['admin-users-count']")
  })
})

describe('users translations', () => {
  const usedKeys = [
    ...new Set(Array.from(usersSource.matchAll(/\bt\('([a-z0-9_]+)'/g), (m) => m[1])),
  ]

  it('extracts the keys it is meant to check', () => {
    expect(usedKeys.length).toBeGreaterThan(20)
    expect(usedKeys).toContain('close_panel')
  })

  it.each(['id', 'en'])('defines every key the users page renders in %s', (lang) => {
    const missing = usedKeys.filter((k) => !bundles[lang][k])
    expect(missing, `missing in ${lang}/admin.json`).toEqual([])
  })
})
