import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyProjectVisibility } from './visibility'

/**
 * Two authorisation models disagreed about who counts as a participant.
 *
 * assertProjectAccess admits the owner or an assigned talent, and time-logs and
 * work-packages use it. applyProjectVisibility admits the owner alone and
 * throws NOT_FOUND for everyone else on a private project, and the project
 * detail route uses that.
 *
 * A talent assigned to a private project could therefore read its milestones,
 * time logs and work packages, but got a 404 on the project itself. Visibility
 * is the owner's choice about strangers, not about the people under contract.
 *
 * Money columns stay hidden either way: the fee framing depends on the margin
 * and the total payout not being visible to talents.
 */

const row = {
  id: 'p1',
  ownerId: 'owner-1',
  visibility: 'private',
  description: 'a'.repeat(300),
  finalPrice: 50_000_000,
  platformFee: 7_500_000,
  talentPayout: 42_500_000,
  preferences: { minExperience: 3 },
}

describe('assigned talent on a private project', () => {
  it('can read the project', () => {
    expect(() => applyProjectVisibility(row, 'talent-1', true)).not.toThrow()
  })

  it('is still refused when not assigned', () => {
    expect(() => applyProjectVisibility(row, 'talent-1', false)).toThrow()
  })

  it('reads the full brief, not a truncated summary', () => {
    const seen = applyProjectVisibility({ ...row, visibility: 'public_summary' }, 'talent-1', true)
    expect(seen.description).toBe(row.description)
    expect(seen.preferences).toEqual(row.preferences)
  })

  it('still cannot see the money columns', () => {
    const seen = applyProjectVisibility(row, 'talent-1', true)
    expect(seen.finalPrice).toBeUndefined()
    expect(seen.platformFee).toBeUndefined()
    expect(seen.talentPayout).toBeUndefined()
  })

  it('does not turn an anonymous caller into a participant', () => {
    expect(() => applyProjectVisibility(row, null, false)).toThrow()
  })
})

describe('owner is unaffected', () => {
  it('still sees everything on a private project', () => {
    const seen = applyProjectVisibility(row, 'owner-1', false)
    expect(seen.finalPrice).toBe(50_000_000)
    expect(seen.description).toBe(row.description)
  })
})

describe('project list', () => {
  const source = readFileSync(
    path.resolve(__dirname, '../repositories/project.repository.ts'),
    'utf8',
  )

  // The list gate has to admit the same people the detail route does.
  it('admits a private project the viewer is assigned to', () => {
    const gate = source.slice(source.indexOf('filters.viewerId !== undefined'))
    expect(gate).toContain('projectAssignments')
  })
})
