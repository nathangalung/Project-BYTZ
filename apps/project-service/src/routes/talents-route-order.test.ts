import { describe, expect, it, vi } from 'vitest'

/**
 * GET /talents/ratings was registered after GET /talents/:id, so Hono matched
 * the parameter route first with id="ratings" and the ratings handler never
 * ran. The talent profile ratings panel was permanently empty, and nothing
 * errored: the caller got a 404 or an unrelated talent lookup.
 *
 * Every other route file here puts static paths first, so this was the one
 * exception rather than a house style.
 */

vi.mock('@kerjacus/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@kerjacus/db')>()),
  getDb: () => ({
    select: () => ({
      from: () => ({
        innerJoin: () => ({ where: () => ({ orderBy: async () => [] }) }),
        leftJoin: () => ({ where: () => ({ orderBy: async () => [] }) }),
        where: () => ({ orderBy: async () => [], limit: async () => [] }),
      }),
    }),
  }),
}))

vi.mock('../middleware/session', () => ({
  getAuthUser: () => ({ id: 'user-1', role: 'talent' }),
  getOptionalUser: () => ({ id: 'user-1', role: 'talent' }),
}))

const { talentRoute } = await import('./talents')

describe('GET /talents/ratings', () => {
  it('is not shadowed by /talents/:id', async () => {
    const res = await talentRoute.request('/ratings?userId=user-1')
    // The :id handler answers TALENT_NOT_FOUND for a bogus id.
    const body = await res.text()
    expect(body).not.toContain('TALENT_NOT_FOUND')
  })

  it('is registered before the parameter route', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(new URL('./talents.ts', import.meta.url), 'utf8')
    expect(source.indexOf("talentRoute.get('/ratings'")).toBeLessThan(
      source.indexOf("talentRoute.get('/:id'"),
    )
  })
})
