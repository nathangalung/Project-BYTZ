import { describe, expect, it } from 'vitest'
import { applyProjectVisibility } from '../lib/visibility'

/**
 * GET /api/v1/projects returned `select()` over the whole projects table with no
 * visibility gate, so any signed-in user could page through every project on the
 * platform - including ones marked `private`, and with finalPrice, platformFee
 * and talentPayout attached. GET /projects/:id had the gate all along; the
 * listing beside it did not.
 *
 * The SQL half of the fix (excluding private rows so `total` stays honest) is
 * covered by the repository's own filter tests. This pins the response-shaping
 * half: what a non-owner is allowed to read off a row that survives the filter.
 */

const row = {
  id: 'p1',
  ownerId: 'owner-1',
  visibility: 'public_detail',
  description: 'a'.repeat(300),
  finalPrice: 50_000_000,
  platformFee: 7_500_000,
  talentPayout: 42_500_000,
  preferences: { minExperience: 3 },
}

describe('project listing visibility', () => {
  it('hides the money columns from a non-owner', () => {
    const seen = applyProjectVisibility(row, 'someone-else')
    expect(seen.finalPrice).toBeUndefined()
    expect(seen.platformFee).toBeUndefined()
    expect(seen.talentPayout).toBeUndefined()
  })

  it('keeps the money columns for the owner', () => {
    const seen = applyProjectVisibility(row, 'owner-1')
    expect(seen.finalPrice).toBe(50_000_000)
    expect(seen.platformFee).toBe(7_500_000)
  })

  it('truncates the description and drops preferences for public_summary', () => {
    const seen = applyProjectVisibility({ ...row, visibility: 'public_summary' }, 'someone-else')
    expect(seen.description?.length).toBeLessThan(row.description.length)
    expect(seen.preferences).toBeNull()
  })

  it('leaves public_detail descriptions intact', () => {
    const seen = applyProjectVisibility(row, 'someone-else')
    expect(seen.description).toBe(row.description)
  })

  // The listing must never surface a private project to a non-owner. The route
  // relies on SQL having already excluded these, so reaching this throw would
  // mean the filter regressed - which is exactly what should break the build.
  it('refuses a private project for a non-owner', () => {
    expect(() =>
      applyProjectVisibility({ ...row, visibility: 'private' }, 'someone-else'),
    ).toThrow()
  })

  it('allows the owner their own private project', () => {
    const seen = applyProjectVisibility({ ...row, visibility: 'private' }, 'owner-1')
    expect(seen.id).toBe('p1')
  })
})
