import { describe, expect, it } from 'vitest'
import { applyProjectVisibility } from '../lib/visibility'

// What non-owners may read per visibility.

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

  // Reaching this throw means SQL regressed
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
